# hello-halo 多 Runtime / 多引擎抽象架构分析

> 目标项目：`C:\workspace\hello-halo`（Halo，AI Workstation，pluggable engine 架构，30 万行，生产验证）
> 对比基准：marloues（Electron 多内核 Agent 桌面应用）—— `client/shared/agent-runtime.ts`（18 种 RuntimeEvent + 12 方法 + RuntimeCapabilities）
> 分析方式：只读静态分析（源码 + DESIGN.md + 跨层 grep）
> 报告日期：本次会话

---

## 0. 一句话结论

hello-halo 的多引擎抽象不是"一个接口 + 多实现"，而是**四个独立契约层（Provider / Engine / Stream / Config）各司其职、逐层收敛**：
- **Provider 层**把"连哪个模型服务商"统一成一份 `AISource` 数据（配置统一）；
- **Engine 层**把"用哪个 Agent 内核"收敛到 `resolved-sdk.ts` 单一入口 + 声明式 `EngineCapabilities`（能力映射）；
- **Stream 层**把"每种内核的原生事件"强制归一化为一份五帧输出契约（事件归一化）；
- **Runtime 层**把"一次执行"建模为有并发上限、可注入、可观察的 run（执行编排）。

marloues 已有 AgentRuntime SPI + 三实现 + 8 项布尔 capabilities，骨架方向一致，但**配置未统一、能力映射未闭环（renderer 根本不消费 capabilities）、事件契约无强制归一化**——halo 恰好在这三处给出了生产级答案。

---

## 1. 多引擎架构分层图

```
┌─────────────────────────────────────────────────────────────────────────┐
│ renderer（React）                                                        │
│  • engine.store.ts    —— 缓存 engineId 的能力描述符，UI 一律按 flag 分支  │
│  • AdvancedSection    —— 引擎选择器（按 engine-availability 禁用/降级提示）│
│  • ImChatView         —— 按 capabilities.features.sessionFork 显示 fork  │
│  • chat.store / MessageList —— 消费 agent:* 事件（思想气泡、工具卡片）     │
└──────────────┬──────────────────────────────────────────────────────────┘
               │ IPC (agent:*, agent:get-engine-capabilities,
               │     agent:get-engine-availability) + WebSocket
┌──────────────▼──────────────────────────────────────────────────────────┐
│ main process                                                             │
│                                                                          │
│  ┌─ services/ai-sources（Provider 层：连哪个模型商）────────────────────┐ │
│  │  AISourceManager（注册表 Map<type, provider>）                       │ │
│  │   ├─ providers/claude.provider.ts        OAuth PKCE（Claude Pro/Max）│ │
│  │   ├─ providers/custom.provider.ts        API-Key（Anthropic/OpenAI） │ │
│  │   ├─ providers/github-copilot.provider.ts OAuth Device Code           │ │
│  │   ├─ providers/zhipu-coding-oauth.provider.ts 智谱 coding plan OAuth │ │
│  │   └─ auth-loader.ts  按 product.json authProviders[] 动态 import      │ │
│  │  输出：BackendRequestConfig { url, key, model, apiType, headers }     │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                              │ getBackendConfig()                         │
│  ┌─ services/agent（Engine 层：用哪个 Agent 内核）───────────────────────┐ │
│  │  resolved-sdk.ts —— 唯一允许 import 三个 SDK 的文件（零静态依赖）      │ │
│  │   ├─ @anthropic-ai/claude-agent-sdk   （canonical 协议）               │ │
│  │   ├─ @hello-halo/agent-sdk            （同协议第二实现）               │ │
│  │   └─ codex/ 适配器（JSON-RPC→CC 协议，event-normalizer.ts）            │ │
│  │  capabilities.ts —— EngineCapabilities 声明式描述（CC 为基准）          │ │
│  │  engine-availability.ts —— 探测构建内实际携带的引擎（不 import）       │ │
│  │  session-manager / stream-processor / session-consumer / control       │ │
│  │  events.ts —— Emitter<AgentEvent>（服务层与传输解耦）                   │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                              │ createSession() / 事件流                    │
│  ┌─ apps/runtime（Runtime 层：一次自动化执行）──────────────────────────┐ │
│  │  execute.ts（headless run，无 UI 事件，JSONL 转录）                    │ │
│  │  concurrency.ts（计数信号量，maxConcurrent 默认 2）                    │ │
│  │  active-runs.ts（run 级注入句柄）                                      │ │
│  │  event-router.ts + event-types.ts（AutomationEvent 归一化）            │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

**分层职责边界（本报告最值得记住的一句话）**：Provider 决定"用哪把钥匙开哪扇门"（配置 + 鉴权 + wire 格式）；Engine 决定"谁在门里干活"（SDK/二进制/自建 loop 的会话语义）；Stream 决定"干活过程怎么说话"（五帧输出契约）；Runtime 决定"一次活怎么排期、限流、可观察"（run 生命周期）。

---

## 2. Provider 抽象层（services/ai-sources/providers/）

### 2.1 接口定义（src/shared/interfaces/ai-source-provider.ts）

```ts
export interface AISourceProvider {
  readonly type: AISourceType          // 'claude' | 'custom' | 'github-copilot' | 'zhipu-coding-oauth' ...
  readonly displayName: string
  isConfigured(config: AISourcesConfig): boolean
  getBackendConfig(config: AISourcesConfig): BackendRequestConfig | null  // ← 核心
  getCurrentModel(config: AISourcesConfig): string | null
  getAvailableModels(config: AISourcesConfig): Promise<string[]>
  refreshConfig?(config): Promise<ProviderResult<Partial<AISourcesConfig>>>
}
export interface OAuthAISourceProvider extends AISourceProvider, OAuthProvider {
  getUserInfo(config): AISourceUserInfo | null
  getQuota?(config): Promise<ProviderResult<AuthQuotaSnapshot>>   // 可选能力，缺省则 UI 不显示
}
// OAuthProvider: startLogin / completeLogin / refreshToken / checkToken / logout
```

要点：
- **Provider 是无状态服务**，配置全部外置（config service），Provider 只是"读配置 → 产出 `BackendRequestConfig`"的纯函数。
- **`BackendRequestConfig` 是唯一的下游契约**：`{ url, key, model, apiType: 'chat_completions'|'responses'|'anthropic_passthrough'|'kiro', headers?, adapterId?, visionOverride? }`——OAuth 提供商在这里注入 Bearer token、anthropic-beta 头、每请求 UUID；API-Key 提供商由 manager 直接构造（不调用 provider 方法）。
- `isOAuthProvider()` 类型守卫：`'startLogin' in provider`——用能力存在性判断，而非引擎名判断。

### 2.2 各 Provider 实现方式

| Provider | 鉴权 | wire 格式 | 特有实现 |
|---|---|---|---|
| `claude` | OAuth 2.0 Auth Code + PKCE（自实现 RFC 7636，不依赖 openauthjs） | `anthropic_passthrough` | 按模型算 `anthropic-beta` 头；`[1m]` 后缀只给 SDK 上下文窗口提示、在 router 边界剥离；token 提前 5 分钟刷新 |
| `custom` | API-Key（最简单） | Anthropic 或 OpenAI 兼容（按 URL 推断） | `isConfigured` 只看 apiKey；可用模型静态表；**运行时 manager 直接读 AISource，不调用其方法**（保留接口仅为兼容） |
| `github-copilot` | OAuth Device Code Flow（镜像 VSCode copilot-chat/0.39.1 的请求行为） | OpenAI 兼容 | 持久化 vscode-machineid 身份；GitHub token→Copilot token→session token 三级换取 |
| `zhipu-coding-oauth` | OAuth + loopback HTTP 回调（智谱 coding plan） | `chat_completions`（编码计划只认 `/api/coding/paas/v4`） | 自动解析账户内带配额的计划 key；无 refresh token（有意不实现 refreshTokenWithConfig，让 manager 跳过刷新） |

### 2.3 注册 / 发现 / 选择

- **注册**：`AISourceManager` 构造时注册 4 个内置 provider（`Map<AISourceType, AISourceProvider>`）；`initializeAsync()` 通过 `auth-loader.ts` 按 `product.json` 的 `authProviders[]` 声明**动态 import 外部 provider 模块**（约定导出 `getXxxProvider()` 或 `XxxProvider` 类），加载失败仅 warn 不崩溃。
- **声明即注册**：`AuthProviderConfig`（shared/types/ai-sources.ts）是产品配置的单点事实源——`{ type, displayName(i18n), icon, enabled, builtin?|path?|preset? }`，三种形态互斥：`builtin:true`（代码在仓库内）/ `path`（动态模块）/ `preset`（固定 baseUrl 的 API-Key 表单，无需模块）。renderer 的登录选择器直接消费同一份声明，两层不会漂移。
- **选择**：`AISourcesConfig.currentId` 指向当前活跃 source；`getCurrentSource()` / `setCurrentSource()` 等纯函数操作；**provider 无优先级轮换**（ProviderRegistryEntry 里的 priority 字段已定义但实际是 currentId 单选）。

### 2.4 配置统一（回答"每个 provider 的 apiKey/baseUrl/model 怎么管理"）

v2 结构（`shared/types/ai-sources.ts`）把所有来源折叠成**同一张表**：

```ts
interface AISource {
  id: string; name: string; provider: ProviderId; authType: 'api-key' | 'oauth'
  apiUrl: string; apiType?: 'chat_completions'|'responses'|'anthropic_passthrough'|'kiro'
  apiKey? | accessToken? / refreshToken? / tokenExpires? / user?   // 按 authType 二选一
  model: string; availableModels: ModelOption[]
  modelOverrides?: Record<string, ModelCapabilityOverride>  // 每模型能力覆盖
  isPreset?: boolean
}
interface AISourcesConfig { version: 2; currentId: string | null; sources: AISource[] }
```

- 持久化在 `config.json` 的 `aiSources` 字段；**凭据加密存储**（decryptString / secure-storage.service）。
- 配套纯函数集（`createSource/addSource/updateSource/deleteSource/setCurrentModel/getModelDisplayName`……）——配置逻辑全部是可测的纯函数，UI 与主进程共用。
- **每模型能力覆盖**：`modelOverrides` 优先级 `用户覆盖 > model-capabilities.json 预设 > 内置默认`；`resolveModelVision(source, model)` 把"这个模型能不能看图"统一成一个布尔，随 `BackendRequestConfig.visionOverride` 贯穿请求管线，输入 UI 与图片剥离逻辑共用同一答案。
- v1→v2 迁移是硬迁移（version 字段），Provider 接口暂时保留 v1 legacy 格式访问（`buildLegacyOAuthConfig()` 桥接），并明确 TODO 未来直接传 AISource。

---

## 3. Agent 引擎层（services/agent/）

### 3.1 "一个引擎"怎么定义

**不是接口，是"必须通过 resolved-sdk.ts 暴露的统一函数面 + 必须产出的统一帧序列"**：

```ts
// resolved-sdk.ts —— 全进程唯一允许 import 三个 SDK 的文件（文件头有硬性规则横幅）
interface SdkModule {
  tool(...); createSdkMcpServer(...); createSession?(...); unstable_v2_createSession?(...)
  query(params): AsyncIterable<any>; capabilities?: EngineCapabilities
}
// 动态加载：loadCcSdk / loadHaloSdk（@vite-ignore 运行时 import）/ loadCodexSdk（codex/ 适配器）
// createSession 归一化 CC 的 unstable_v2_createSession 与 Halo 的 createSession 差异
```

- 引擎值：`config.agent.sdkEngine = 'anthropic' | 'halo' | 'codex'`。切换需要**重启进程**（`_sdk` 进程级缓存）。
- **"新增引擎 = 在 services/agent/<engine>/ 下实现适配器"**：Claude Code 是 canonical/default 协议，Codex 通过 `codex/event-normalizer.ts`（1075 行，JSON-RPC notification → CC 协议消息）接入；`codex/session-adapter.ts` 做会话生命周期桥接，`codex/mcp-bridge.ts` 做 MCP 桥。
- **硬规则（DESIGN.md §1）**：`@anthropic-ai/claude-agent-sdk` 是默认引擎并定义内部流/会话协议；`@hello-halo/agent-sdk`、`@openai/codex-sdk` 及未来引擎必须暴露同样的 `tool / createSdkMcpServer / createSession / query` 面；**原生引擎事件必须在到达 session-consumer / stream-processor 之前归一化**；消费端禁止出现引擎分支（"if consumer needs engine awareness, the adapter contract is wrong"）。

### 3.2 Per-turn 输出契约（事件归一化的核心，五帧）

DESIGN.md §2 定义了**每个引擎适配器必须产出**的帧序列，缺帧会让消费端静默坏掉：

| 帧 | 时机 | 携带 |
|---|---|---|
| `system.init` | turn 开始一次 | session_id, model, tools, mcp_servers |
| `stream_event`（message_start/content_block_*/message_delta/message_stop） | token 级 | UI 流式增量 |
| `assistant`（聚合） | 每个 block 边界 | 该 block 的最终形态；**tool_use 必须先于其 tool_result**（供 JSONL 回放按 id 关联） |
| `user`（tool_result） | 工具完成时 | tool_use_id, content, is_error |
| `result` | turn 结束一次 | stop_reason, 累计 usage |

**为什么这是关键**：execute.ts（自动化）、app-chat.ts 的 lastAssistantText、session-store 的 JSONL 回放都只认顶层 `assistant`/`result` 帧；只发 token 级 stream_event 的适配器会"静默破坏所有消费端"。Codex normalizer 为此专门补发聚合帧（`aggregateBlock`，还处理了"delta 与 completed 文本重复 → 双气泡"这个真实 bug）。

### 3.3 capabilities 怎么描述、UI 怎么消费

```ts
// capabilities.ts —— EngineCapabilities 是跨 main/preload/renderer 的可序列化类型
export type EngineId = 'anthropic' | 'halo' | 'codex'
interface EngineCapabilities {
  engineId; displayName
  streaming: { text; reasoning; toolInput; toolOutput }   // 'token'|'item'|'final-only'|'turn'|'none'
  tools: { native: ToolKind[]; synthetic: {kind; from; lossy}[]; shellHeuristics: boolean }
  todo: { states: TodoState[]; hasActiveForm: boolean }     // Codex 是 2 态，无 activeForm
  subAgent: { model: 'declarative'|'imperative'|'none'; visibleLifecycle: boolean }
  features: { skills; mcp; hooks; sessionResume; sessionFork; interrupt;
              multimodalImage; contextCompaction; askUserQuestion }
}
```

- **CC 是全量基准**（`ANTHROPIC_CAPABILITIES`），Codex 声明差异（`CODEX_CAPABILITIES`：toolInput=final-only、Edit/Write 由 file_change 合成且 lossy、todo 2 态、subAgent=imperative、sessionFork=false……）。
- **UI 消费链路**：renderer `engine.store.ts`（zustand）启动时经 `agent:get-engine-capabilities` 拉一次（进程级缓存，切引擎才变）→ `useEngineCapabilities()` hook → 组件按 flag 分支。**硬规则：renderer 不得按 engineId 分支，只能按 capability flag 分支**（EngineBadge 是唯一允许读原始引擎串的组件）。空值按"CC 默认"降级渲染，缺 flag 永不破坏 UI。
- 已见消费点：`ImChatView.tsx` 的 `canFork = capabilities?.features.sessionFork`（gate "continue in client" fork 入口）。

### 3.4 engine-availability：可用性检测 / 降级

- **探测绝不 import 引擎模块**：只查打包文件（node_modules 的 package.json + 入口文件），外加 entry 文件 sha256 前 12 位做 fingerprint（`@hello-halo/agent-sdk` 是本地 path 依赖、版本号不变，只能靠内容哈希识别构建）。Codex 特殊：包总是能 import（适配器打进主 bundle），真正的门槛是平台原生 `codex` 二进制，单独 `resolveBundledCodexBinary()` 探测。
- **降级不中止**：`initSdk()` 永不 reject（在窗口创建前执行，reject 会拖垮整个 bootstrap）。流程：`requested = config.agent.sdkEngine` → 按可用性构造尝试顺序（配置的引擎优先，其余按 `['anthropic','halo','codex']` 兜底）→ 逐个 `loadEngine`，失败继续下一个 → `_degradedFrom` 记录"配置想用但实际没跑上的引擎"，**保留用户配置不篡改**。
- **UI 消费**：`agent:get-engine-availability` 供 AdvancedSection 把不可用引擎的 radio 置灰（"Not included in this build"），`degradedFrom` 显示琥珀色警告横幅。

### 3.5 events：服务层事件归一化（与传输解耦）

```ts
// events.ts —— 服务层只发事件，不知道 BrowserWindow / WebSocket 存在
interface AgentEvent { channel; spaceId; conversationId; data }
interface AgentBroadcastEvent { channel; data }
export const onAgentEvent: Event<AgentEvent>   // IPC 层订阅转发
// ipc/agent.ts: onAgentEvent → mainWindow.webContents.send(channel, data)
//                              + broadcastToWebSocket(channel, data)   ← 同一事件双投递
```

会话状态（thoughts / tool calls / token usage）**只在主进程权威**，renderer 只消费事件、不持久化（DESIGN.md 硬规则 1）。

### 3.6 agents.ts / control.ts 的角色澄清

- `agents.ts` 是**子代理定义**（web-searcher 等，纯声明数据喂给 SDK 的 Task 工具），不是引擎抽象——别被文件名误导。
- `control.ts` 是**中断/停止编排**：`stopGeneration()` 对每个会话判定 team 模式（有活跃 team 任务 → `session.close()` 杀整个子进程；否则 `session.interrupt()` + AbortController.abort），并提供 `isGenerating / getActiveSessions / getSessionState`（远端断线重连恢复）。

---

## 4. 运行时执行层（apps/runtime/）

> 注意：这个 runtime 是"App 自动化执行"的编排层，不是引擎层。引擎事件归一化在 §3.2；这里的 event 是自动化触发事件（文件变化/webhook/定时）。

### 4.1 多执行并发与切换（concurrency.ts + active-runs.ts）

- **`Semaphore`（计数信号量）**：`acquire()/release()/tryAcquire()/rejectAll()`，FIFO 队列，`maxConcurrent` 默认 2（每个 run 是一个 CC 子进程，资源重）。无优先级。
- **`active-runs.ts`**：run 级注册表（`Map<runId, ActiveRunHandle>`），`executeRun` 建会话后注册、`finally` 注销；`injectIntoActiveRun(appId, runId, text)` 校验 runId 归属 → 先写 JSONL 再 `session.send()`（下一次 tool 边界吸收）——这是"多执行同时进行时如何定向注入"的答案。
- **执行单元隔离**：`executeRun()` 每 run 独立 V2 会话、无跨 run 复用（DESIGN.md §2.2）；升级/审批走"run 边界"而非会话驻留（§2.3：escalation 结束当前 run，用户回复触发新 run 带上下文）。

### 4.2 事件路由到 UI：两条刻意不同的通路

- **chat（交互）**：引擎流 → session-consumer → stream-processor → `emitAgentEvent('agent:thought', …)` → IPC/WS 推给 renderer（实时）。
- **自动化 run（headless）**：**不发任何 agent:* 事件**，`processStream` 只把聚合消息追加到 run JSONL（`session-store`），观察者通过轮询 `app:get-session`（仅视图打开且 run 存活时 2s 一次）读取；run 状态经 `app:status_changed` 广播。设计决策 §2.10 明确：**"shell 共享、传输按面性质可插拔"**——渲染与数据模型统一（同一 MessageList/Message[]），实时传输不强行统一。
- **自动化触发事件**（event-router.ts + event-types.ts）：`AutomationEvent { id, type: '{category}.{verb}', source, timestamp, payload, dedupKey? }`，source adapter 产出 → router 赋 id/timestamp → TTL 去重 → `EventFilter`（types glob + sources + 字段级 FilterRule）→ 顺序派发、错误隔离。

### 4.3 中断 / 审批 / 流式如何跨引擎统一

- 中断：chat 走 `control.ts`（interrupt/close 二选一）；run 走 `AbortSignal` + 会话 close。都是主进程权威、对 renderer 表现为统一 IPC。
- 审批：`permission-handler.ts`（AskUserQuestion / tool 审批 / permission mode 解析）挂在统一 Thought 流上；`requiresApproval` 工具调用**阻塞流**直到决议。
- 流式：一切最终落到 §3.2 五帧契约，engine 差异被 normalizer 吸收——消费端（execute/app-chat/session-store）不需要知道是 CC 还是 Codex。

---

## 5. 配置模型

### 5.1 三层配置并存（各管一段）

| 配置 | 位置 | 管什么 |
|---|---|---|
| `HaloConfig`（config.json） | `foundation/config.service.ts` | 全局：`api`、`aiSources`（v2 多源）、`agent.{sdkEngine, maxTurns, disabledTools, …}`、`permissions`、`mcpServers`…… |
| `AISourcesConfig` v2 | `shared/types/ai-sources.ts` | 模型源统一表（§2.4） |
| App 级 config_schema 默认值 | `apps/runtime/config-defaults.ts` | 自动化 App 的用户配置与 schema 默认值合并 |

### 5.2 config-defaults.ts 的合并模式

```ts
export function mergeConfigWithDefaults(userConfig, configSchema): Record<string, unknown> {
  // 1) 只保留 schema 里仍存在的 key（删除/改名不泄漏陈旧值）
  // 2) 用户未设的 key 用 schema 的 default 填充
  // 用户值永远优先于默认值
}
```

- `sdkEngine` 是 `HaloConfig.agent.sdkEngine`（renderer 类型同步镜像于 `renderer/types/index.ts`）；切换后 UI 提示"重启生效"（进程级缓存决定）。
- **每会话固定引擎/模型**：`conversation.service.ts createConversation()` 从当前全局配置打快照 `engineId / modelSourceId / modelId / toolsets / knowledgeBaseIds` 存入会话（Cursor 风格 pin）；`credentialsFingerprint` 让 pin 与全局不同的会话独立重建；全局模型变更 bump `credentialsGeneration` 批量失效所有会话。
- 模型能力元数据与渠道配置分离（`shared/types/model-capabilities.ts`）：预设 JSON + 用户覆盖 + 前缀兜底，`resolveModelVision` 统一解析。

---

## 6. 能力映射（UI 操作按引擎能力显示/禁用）

| 机制 | halo 做法 |
|---|---|
| 引擎能力描述 | `EngineCapabilities`（声明式、可序列化、IPC 直传 renderer） |
| 能力获取 | 启动时 `agent:get-engine-capabilities` 拉一次，`engine.store.ts` 缓存 |
| UI 分支规则 | **只按 flag 分支，禁止按 engineId 分支**（代码注释即规范） |
| 已实现映射 | `sessionFork` → fork 入口；`streaming.reasoning` → thinking 占位；`subAgent.model` → 子代理卡片折叠；`todo.states` → 2 态折叠；`tools.synthetic[lossy]` → 轻量渲染；`engine-availability` → 引擎 radio 置灰 + degraded 警告 |
| 兜底 | flag 缺失按 CC 默认渲染，绝不阻断 |

对照 marloues：`RuntimeDescriptor.capabilities`（8 个布尔）在 renderer 中**零消费**（grep 无 `capabilities.forkThread` 等；renderer 仅 settings-store 拿 runtimeState 用于切换），UI 的 `setModel`/interrupt 等操作无条件调用——这是"UI 操作与内核能力映射不完善"的实证。

---

## 7. 三个维度的具体做法（对比核心）

### 7.1 配置统一

| halo | marloues |
|---|---|
| 单一 `AISource` 表 + `currentId` 单选；凭据加密 | `AgentSettings.providers[]` + `defaultModel` + `activeRuntimeId`，但 runtime 专属配置散落（BinaryRuntime 走 codex transport、ClaudeRuntime 走 env-builder、runtimeConfigDir 语义不统一） |
| v1→v2 显式迁移 + legacy 桥接 | 无版本字段，演进即破坏 |
| 配置操作全部纯函数（shared 层，UI/主进程共用） | 配置读写散布在 config-service / settings-store |
| 每模型能力覆盖（modelOverrides）内嵌于源配置 | 无 per-model 能力覆盖 |

### 7.2 能力映射

| halo | marloues |
|---|---|
| `EngineCapabilities` 结构化（streaming 粒度 / tools 原生+合成+lossy / todo 状态机 / subAgent 模式 / 10 项 feature flag） | `RuntimeCapabilities` 8 个扁平布尔 |
| renderer 经 store 缓存、按 flag 分支（规范强制） | renderer 不消费 capabilities（实证） |
| 可用性单独探测（engine-availability）+ 降级提示 + 设置项置灰 | runtimeRegistry.status 硬编码 'available'，binary 仅检查 binary 是否存在，无 degraded 概念 |
| 缺 flag 按默认降级渲染 | 无降级路径 |

### 7.3 事件归一化

| halo | marloues |
|---|---|
| 五帧输出契约（system.init/stream_event/assistant/user/result）写进 DESIGN 并作为适配器验收标准 | 18 种 RuntimeEvent 类型定义良好（turn/text/tool/approval/context/memory…），但**无强制帧序/缺帧检测**（如 tool_use 必须先于 tool_result 的关联契约缺失） |
| Codex normalizer 1075 行专门吸收差异（含双气泡等真实 bug 修复） | BinaryRuntime 329 行 vs ClaudeRuntime 1470 行——事件语义一致性靠人工维护 |
| 服务层 Emitter → IPC+WS 双投递，传输解耦 | runtime-event-adapter 已把 RuntimeEvent→UIEvent 翻译，方向正确，但无"契约测试/回放"概念 |
| JSONL 转录可按顶层帧回放（id 关联工具） | 无转录回放机制 |

---

## 8. 与 marloues 现状对比表（总结）

| 维度 | halo 做法 | marloues 现状 | 差距 / 可迁移性 |
|---|---|---|---|
| 引擎接入点 | resolved-sdk.ts 单一入口 + 零静态 import + 动态加载 | manager.ts create() 工厂直接 new 三个实现 | 方向一致；halo 的"只允许一个文件 import SDK"可移植 |
| 引擎可用性 | 文件级探测（不 import）+ 降级链 + degraded 上报 | registry status 静态写死 | 高价值：移植 probe + degraded 概念 |
| 能力描述 | 结构化 EngineCapabilities + 双态/粒度/合成工具 | 8 个布尔 | 高价值：扩成 streaming/tools/features 分级 |
| UI 消费能力 | engine.store 缓存 + flag 分支 + 缺失降级 | renderer 零消费 | 高价值：先让 renderer 消费现有 8 布尔 |
| 配置统一 | AISource v2 单表 + 版本迁移 + 纯函数操作 + 加密 | AgentSettings 单对象但 runtime 专属配置分散 | 中等：为 runtime 专属配置引入子结构 + 版本字段 |
| 每模型能力 | modelOverrides 覆盖链（用户>预设>默认） | 无 | 中低：视 UI 需求 |
| 事件契约 | 五帧契约 + 适配器验收标准 + JSONL 回放 | 类型好但无帧序契约 | 中等：把五帧契约写进 marloues 的 SPI 文档并补测试 |
| 事件传输 | Emitter → IPC+WS 双投递 | runtime-event-adapter 单投递（IPC） | 低（已有适配层，扩展即可） |
| 执行编排 | run 级 Semaphore + active-runs 注入 + headless JSONL | 无 run 概念（turn 级） | 中低（marloues 是交互式应用，未必需要 headless run） |
| 多会话模型 pin | 会话打快照 + fingerprint 独立重建 | 无（会话即线程） | 中：marloues 有 thread 概念，可加 model pin |

---

## 9. 可借鉴的具体建议（按 ROI 排序）

1. **移植"能力描述分层 + renderer 消费闭环"（最高优先）**
   - 把 marloues 的 `RuntimeCapabilities` 从 8 个布尔扩展为分级结构（至少加 `streaming` 粒度与 `features` 组，可仿 halo 的 `EngineCapabilities` 但裁剪掉 todo/subAgent 不需要的字段）。
   - 在 renderer 加一个 `engine.store.ts` 式缓存 + `useRuntimeCapabilities()` hook；把所有无条件调用（`setModel`、interrupt、fork）改成按 flag gate——这一步直接修复"UI 操作与内核能力映射不完善"。

2. **移植"可用性探测 + 降级 + degraded 上报"**
   - 给 `binary` runtime 加文件级探测（Codex 二进制在不在、版本、fingerprint），`runtimeRegistry.status` 从静态改为 `engine-availability.ts` 式探测缓存；切换/启动时降级到可用 runtime，并把"配置想用但没跑上"的状态经 `getRuntimeState()` 暴露给设置页（halo 的 `degradedFrom` 警告横幅）。

3. **把"五帧输出契约"固化为 marloues 的 SPI 验收标准**
   - 在 `agent-runtime.ts` 头部写清每个 RuntimeEvent 的时序要求（尤其 tool-complete 与其 tool_use 的先后、turn-complete 必须携带终止原因），并给 BinaryRuntime/ClaudeRuntime 各补一组契约测试；把 `runtime-event-adapter.ts` 的翻译做成可回放（仿 halo 的 JSONL 转录按顶层帧回放）。

4. **配置统一：为 runtime 专属配置引入子结构 + 版本字段**
   - 仿 `AISourcesConfig`：把 `AgentSettings` 拆出 `runtimes: { version, activeRuntimeId, runtimes: { sdk: {...}, binary: {...}, 'self-built': {...} } }` 子表，配置读写收敛为纯函数（shared 层），并加 schema 版本字段以支持未来迁移——直接回应"配置未统一"。

5. **（可选）事件双投递**：仿 halo `ipc/agent.ts`，在 marloues 的事件桥接层同时推 IPC 与 WebSocket，为将来的远程/多客户端铺路（成本低）。

---

## 10. 关键文件索引（hello-halo）

| 主题 | 文件 |
|---|---|
| Provider 接口 | `src/shared/interfaces/ai-source-provider.ts` |
| AISource 统一配置 | `src/shared/types/ai-sources.ts` |
| Provider 注册/选择/凭据 | `src/main/services/ai-sources/manager.ts`、`auth-loader.ts` |
| 引擎唯一入口/动态加载/降级 | `src/main/services/agent/resolved-sdk.ts` |
| 引擎可用性探测 | `src/main/services/agent/engine-availability.ts` |
| 能力描述 | `src/main/services/agent/capabilities.ts`、`codex/capabilities.ts` |
| 事件归一化（Codex→CC） | `src/main/services/agent/codex/event-normalizer.ts` |
| 五帧输出契约 / 硬规则 | `src/main/services/agent/DESIGN.md`（§1–2） |
| 服务层事件 | `src/main/services/agent/events.ts`、`src/main/ipc/agent.ts` |
| 执行编排 | `src/main/apps/runtime/execute.ts`、`concurrency.ts`、`active-runs.ts`、`DESIGN.md` |
| renderer 能力缓存/消费 | `src/renderer/stores/engine.store.ts`、`components/apps/ImChatView.tsx` |
| 引擎选择 UI | `src/renderer/components/settings/AdvancedSection.tsx` |
| 配置模型 | `src/main/foundation/config.service.ts`、`src/main/apps/runtime/config-defaults.ts` |

---

## 附：marloues 现状关键文件（对比基准）

| 文件 | 作用 |
|---|---|
| `client/shared/agent-runtime.ts` | AgentRuntime SPI：18 种 RuntimeEvent + 12 方法（含可选 `?` 方法）+ RuntimeCapabilities |
| `client/shared/runtime-event-adapter.ts` | RuntimeEvent → UIEvent 翻译（已存在，可扩展） |
| `client/main/core/runtime/manager.ts` | runtimeRegistry（3 实现）+ switchRuntime + selectedRuntimeId 降级到 'sdk' |
| `client/main/core/runtime/{claude,binary,self-built}-runtime.ts` | 三个实现（ClaudeRuntime 1470 行完整；BinaryRuntime 329 行代码完整但配置断链；SelfBuilt 模拟占位） |
| `client/shared/types.ts` | RuntimeKind / RuntimeDescriptor / RuntimeState / AgentSettings |
