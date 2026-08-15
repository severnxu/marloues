# 01 — AgentRuntime SPI 与三个 Runtime 实现完成度分析

> 仓库：`C:\workspace\marloues-ui-r2`（代码在 `client/`），只读分析。
> 分析对象：`client/shared/agent-runtime.ts`、`client/main/core/runtime/{claude-runtime,binary-runtime,self-built-runtime,manager}.ts`、`client/main/codex/`、`client/main/gateway/`。
> 结论速览：**抽象层本身已经接通（app 启动会 initRuntime、IPC 全部走 getRuntime()），但三个实现里只有 ClaudeRuntime 是"真·可用"形态；BinaryRuntime 代码完整但配置源断链；SelfBuiltRuntime 是纯模拟（无模型调用），且缺 readThread/subscribeThread。**

---

## 0. 一句话结论

- **SPI 定义完整**（18 种 RuntimeEvent + 12 个必选/可选方法 + 8 项 capabilities），且 UI 层有 `shared/runtime-event-adapter.ts` 把全部 18 种事件翻译成 UIEvent，事件契约是通的。
- **管理器已接通**：`index.ts` 在 app ready 时 `initRuntime()`、退出时 `destroyRuntime()`；`ipc/handlers.ts` 的 Chat/Settings 全部经 `getRuntime()` 走 SPI（sendMessage 事件流、interrupt、cancelTool、approval、readThread、truncate、fork、list/create/deleteThread、runtime switch）。
- **但默认配置让应用"看似可用实则不可用"**：`config-service.ts` 默认 `activeRuntimeId: "self-built"`、默认模型 `"local-loop"`（假模型）——即开箱跑的是 SelfBuiltRuntime 的**模拟 loop**，不发任何真实模型请求。
- **没有实现是 100% 完整**：三个 runtime 在"能力矩阵"上各有缺口（见 §6 对比表），且都存在"代码写了但没接通外部依赖"的点（见 §7）。

---

## 1. AgentRuntime SPI 全景（client/shared/agent-runtime.ts，223 行）

### 1.1 RuntimeEvent（18 种，`kind` 判别联合）

| kind | payload 要点 | 谁产生 |
|---|---|---|
| turn-start | turnId, timestamp | 三个 runtime 都发 |
| text-chunk / thinking-chunk | turnId, content | 三个 runtime 都发 |
| tool-start | turnId, toolId, toolName, input | 三个 runtime 都发 |
| tool-progress | turnId, toolId, partialInput, input, isReady | 仅 Claude / SelfBuilt |
| tool-complete | turnId, toolId, output, isError | 三个 runtime 都发 |
| turn-complete | turnId, result(success/error/aborted), content, error, sdkSessionId | 三个 runtime 都发 |
| approval-request | requestId, toolName, reason, timeout, allowSession | 三个 runtime 都发（路径不同） |
| context-usage | turnId, phase(turn_start/turn_end), percentage, limit, usage | 仅 Claude |
| context-warning | turnId, level(low/medium/high/critical), message | 仅 Claude |
| token-usage | turnId, usage | 仅 Claude / SelfBuilt（估计值） |
| runtime-status | turnId, id, label, detail, status | 三个 runtime 都发（Claude 最丰富） |
| session-info | turnId, skills, slashCommands, agents | 仅 Claude |
| mcp-status | turnId, servers, tools | 仅 Claude |
| memory-recall | turnId, mode, memories | 仅 Claude |
| prompt-suggestion | turnId, suggestion | 仅 Claude |
| error | code, message, recoverable | 三个 runtime 都发 |

- UI 侧 `shared/runtime-event-adapter.ts` 的 `translateRuntimeEventToUIEvent` **switch 覆盖全部 18 种**（default 返回 null），说明事件面已完整接入 renderer。

### 1.2 方法清单（必选 vs 可选）

**必选（接口非 `?`，实现必须提供）：**
`name`、`capabilities`、`initialize()`、`destroy()`、`listThreads()`、`createThread()`、`deleteThread()`、`sendMessage()`、`listTools()`、`respondApproval()`。

**可选（带 `?`，可缺失）：**
`forkThread`、`interruptTurn`、`setModel`、`getAvailableModels`、`setPermissionMode`、`registerTool`、`cancelTool`、`truncateThread`、`readThread`、`subscribeThread`。

> 注意：`getAvailableModels`/`setPermissionMode` 虽为可选，但 manager 的 `listRuntimeModels`/`setRuntimeModel` 会直接调用 `runtime.getAvailableModels()` / `runtime.setModel?.()`——缺失/空实现会影响模型切换 UI。

### 1.3 RuntimeCapabilities 字段（全布尔）

`forkThread | interruptTurn | setModel | setPermissionMode | registerTool | cancelTool | editMessage | sandbox`

- 语义是"该 runtime 支持什么"，UI/IPC 用 `capabilities.xxx` 做门禁（如 `CHAT_CANCEL_TOOL` 先查 `capabilities.cancelTool`；`CHAT_RESEND_FROM_MESSAGE` 先查 `capabilities.editMessage`）。
- **capabilities 与实际实现存在不一致**：Claude 声明 `setModel: true`、`setPermissionMode: true`，但对应方法体是空 no-op；SelfBuilt 声明全 true，但 readThread/subscribeThread 根本没有方法实现。

### 1.4 线程数据契约

- `readThread` 输入 `WorkflowReadThreadInput { threadId?, cursor?, limit?, includeOutputs?, maxOutputCharsPerItem? }`，输出 `WorkflowReadThreadResponse`（schemaVersion + thread + page 分页 + turns）。
- `subscribeThread` 输入加 `signal?`，输出 `AsyncIterable<WorkflowReadThreadResponse | WorkflowThreadPatch>`，patch 类型：`snapshot` / `turns` / `threadStatus`。
- 实际实现（Claude/Binary）都委托给单例 `workflowThreadStore`（见 §2.4）。

---

## 2. 运行时管理器（client/main/core/runtime/manager.ts，159 行）

### 2.1 结构

```ts
type RuntimeKind = "sdk" | "binary" | "self-built";   // 定义在 client/shared/types.ts:386
```

`runtimeRegistry: Record<RuntimeKind, RuntimeDescriptor & { create?: RuntimeFactory }>`：

| kind | 名称 | 实现类 | capabilities 声明 |
|---|---|---|---|
| sdk | SDK Runtime | `new ClaudeRuntime()` | fork/interrupt/setModel/setPermissionMode/editMessage=true；registerTool/cancelTool/sandbox=false |
| binary | Binary Runtime | `new BinaryRuntime()` | fork/interrupt/setPermissionMode/sandbox=true；setModel/registerTool/cancelTool/editMessage=false |
| self-built | Self-built Runtime | `new SelfBuiltRuntime()` | 全 true |

- binary 描述符带 `statusReason`：未发现 bundled binary 时会提示"尝试使用 PATH 中的 codex 命令"（`resolveBundledCodexBinary()` 来自 `codex/transport/connection.ts`）。
- 三个 entry 的 `status` 恒为 `"available"`。

### 2.2 生命周期与切换

- `initRuntime()`：`activeRuntimeId = selectedRuntimeId()`（读 `settings.activeRuntimeId`，不存在或 status 不可用则回退 `"sdk"`）→ `createRuntime`（`entry.create()` 后 `await initialize()`）。
  - **但 settings 默认值就是 `"self-built"`**（config-service.ts:62），且 registry 三项都 available，所以**实际默认 runtime = SelfBuiltRuntime（模拟）**。
- `getRuntime()`：未初始化则 throw `"Runtime not initialized. Call initRuntime() first."`——所有 IPC 调用都依赖 `index.ts` 先 `initRuntime()`。
- `destroyRuntime()`：`await runtime.destroy()` 后置 null。
- `switchRuntime(id)`：先 `createRuntime(next)`（新实例 initialize 成功才替换）→ 换指针 → 旧实例 `destroy()`（失败不回滚，try/catch 吞掉）→ `saveAgentSettings({ activeRuntimeId })`。
  - 链路完整，IPC `RUNTIME_SWITCH`（handlers.ts:1877）已接。
- `getRuntimeState()`：返回 `{ activeRuntimeId, activeRuntimeName, runtimes: descriptors[] }`；`RUNTIME_GET_STATE` IPC 已接。
- `listRuntimeModels()`：调 `runtime.getAvailableModels()`；`setRuntimeModel()`：调 `runtime.setModel?.(modelId)` 并把 `defaultModel` 写回 settings。

### 2.3 与旧 store 的双轨问题（重要）

- manager/config-service 走**新配置** `~/.marloues-dev/config/settings.json`（config-service.ts）。
- codex 链路（binary runtime）走**旧 SimpleStore**（`client/main/store.ts`，默认 `selectedProviderId: "minimax"`、providers.apiKey 为空）。
- `codexService.setApiKey()` 全仓库**无调用者** → 旧 store 的 provider 永远不会被新设置页填充 → binary runtime 实测会卡在 `"API key not configured"`。

### 2.4 workflowThreadStore 的角色

- 单例 `workflowThreadStore`（`core/runtime/workflow-thread-store.ts`，559 行）：内存线程/轮次/turn 项存储，`startTurn` / `applyRuntimeEvent`（把 RuntimeEvent 落成 workflow turn item）/ `readThread`（经 `read-thread-serializer.ts` 的 `serializeWorkflowThread` 分页序列化）/ `subscribeThread`（快照式 patch 流）。
- **Claude 与 Binary 把 readThread/subscribeThread 直接委托给它**；handlers 的读线程广播（`registerReadThreadBroadcast`）也是直接 `workflowThreadStore.addListener`，**没有走 runtime.subscribeThread**——即 SPI 的 subscribeThread 目前是"声明了但应用不消费"。

---

## 3. ClaudeRuntime（sdk runtime，claude-runtime.ts，1470 行）

### 3.1 形态

- `name = "Claude"`，桥接 `@anthropic-ai/claude-agent-sdk`（**已在 client/package.json dependencies：`^0.3.220`**），经 `core/sdk/claude-sdk.ts` 动态 import（`queryClaude`，支持测试 override）。
- 三个 runtime 中**唯一真实接模型、事件覆盖最全**的实现。

### 3.2 方法实现状态

| 方法 | 状态 | 说明 |
|---|---|---|
| initialize | ✅ | 仅尝试动态 import SDK，失败静默（首次 query 再报错） |
| destroy | ✅ | 关 activeQuery、resolve 全部 pending approval=false、清 sessionApprovedTools |
| listThreads / createThread / deleteThread | ✅ | 内存 Map + `workflowThreadStore.ensureThread/deleteThread` |
| forkThread | ✅（MVP 简化） | 本地复制消息 + `workflowThreadStore.cloneThread`；**未调用 SDK `forkSession`**（sdk-claude-sdk.ts 有 forkClaudeSession 包装但未用，注释 "MVP"） |
| truncateThread | ✅ | 本地裁消息 + `workflowThreadStore.truncateFromUserMessage` |
| sendMessage | ✅（最完整） | 见 §3.3 |
| interruptTurn | ✅ | `activeQuery.interrupt()` |
| setModel | ⚠️ **空 no-op**（capabilities 却声明 true） | 注释 "MVP: store runtime model preference in settings"，什么都没做 |
| getAvailableModels | ✅ | `configuredRuntimeModels()`（来自新 settings.providers） |
| setPermissionMode | ⚠️ **空 no-op**（capabilities 却声明 true） | 注释 "enforced by canUseTool callbacks"——权限确实在 canUseTool 里执行，但该方法本身不生效 |
| registerTool | ❌ **抛错** | `"ClaudeRuntime does not support dynamic tool registration..."`（与 capabilities.registerTool=false 一致） |
| listTools | ✅ | `configuredMcpTools()`（settings.mcpServers 静态列表，非实时 MCP 探测） |
| cancelTool | — 缺失 | capabilities.cancelTool=false，一致 |
| readThread / subscribeThread | ✅ | 委托 `workflowThreadStore` |
| respondApproval | ✅ | 查 pendingApprovals Map → resolve；scope=session 时加入 sessionApprovedTools |

### 3.3 sendMessage 事件流（重点）

1. 推 user 消息、`workflowThreadStore.startTurn`（记 model snapshot/cwd）。
2. `buildClaudeRuntimeOptions(...)` 构造 SDK options，注入 `canUseTool` 回调：先 `ToolStormBreaker.check`（风暴防护）→ `evaluateToolPermission`（权限引擎 + settings.toolPermissionPolicy + sessionApprovedTools）→ 需要询问时把 `approval-request` 推入内部 `RuntimeEventQueue`，然后 `waitForApproval` 阻塞等用户（带 timeout，超时=deny）。
3. `queryClaude(opts.content, options)` 得到 `ClaudeQuery`；`opts.runtimeThreadId` 若是合法 sessionId 则 `options.resume`。
4. `wrapStream()` 生成器：`Promise.race(SDK 迭代器, 审批队列)` 双路取事件 → 每条 SDK 消息过 `normalizeSdkMessage()`（claude-runtime.ts 内置，**不是** claude-normalizer.ts）转 RuntimeEvent 数组 → 逐个 `workflowThreadStore.applyRuntimeEvent` + `yield`。
   - 事件覆盖：system/init → turn-start + session-info；memory_recall → memory-recall；mcp_servers → mcp-status；status/session_state_changed/notification/permission_denied → runtime-status；task_* → runtime-status；tool_progress/tool_use_summary → runtime-status；prompt_suggestion → prompt-suggestion；stream_event text_delta/thinking_delta/input_json_delta → text/thinking-chunk + tool-progress（含 partial JSON 解析）；content_block_start(tool_use) → tool-start；content_block_stop → tool-progress(isReady)；user tool_result → tool-complete；result → token-usage + turn-complete/error。
   - 特殊钩子：session-info 后拉一次 `context-usage(turn_start)`；turn-complete 后拉 `context-usage(turn_end)` + `buildContextPolicyWarningEvent`（evaluateContextPolicy 判 warning/compact/restart）→ context-warning；SDK 没发 turn-complete 时兜底补发；异常路径 yield error + turn-complete(error)。
5. 结束把 assistantText 推回本地 thread。

### 3.4 自包含性

- **代码自包含**：不依赖 gateway、不依赖 codex 二进制；依赖只有 SDK（已在 deps）+ 新配置 + 权限引擎 + workflowThreadStore，均存在。
- **运行前提**：需要有效 endpoint（apiKey/baseUrl/model）。默认配置是 `local-loop` 假模型 → 不开箱即用。
- 局限：`activeQuery`/`activeTurnId` 单实例，同一时刻只支持一个 turn；`setModel`/`setPermissionMode` 是空实现（模型/权限实际由 settings + canUseTool 决定）。

---

## 4. BinaryRuntime（binary runtime，binary-runtime.ts，329 行）

### 4.1 形态与依赖链

```
BinaryRuntime
  └─ codexService (codex/service.ts, 718 行, 单例)
       ├─ CodexAppServerSession (codex/session.ts, 396 行)   ← JSON-RPC over stdio
       │     └─ CodexTransportImpl (codex/transport/connection.ts) ← spawn codex CLI "app-server"
       │           └─ JsonRpcClient (codex/transport/jsonrpc-client.ts)
       └─ gateway/protocol {decodeRequest, encodeRequest, parseResponse} + startGateway/getGatewayPort
              └─ gateway/pipeline.ts: detect→decode→route→encode→forward→parse/stream→format/stream
```

- **binary-runtime 确实使用 codex/ 组件**（service/session/transport/event-log），且**协议转换依赖 gateway**：
  - `createSession` 时启动本地 HTTP gateway（默认 8080），把 codex CLI 的 model_provider 指向 `http://127.0.0.1:<port>/v1`（wire_api=responses），env 里 `CODEX_API_BASE_URL` 指 gateway。
  - gateway 把 **OpenAI Responses API（codex 线协议）→ IR → OpenAI Chat Completions（MiniMax 目标）** 转换后转发到 store 所选 provider。
- codex 二进制来源：`resolveBundledCodexBinary()` 找 `@openai/*` vendor 目录或 `codex.js`；**@openai/codex 不在 package.json dependencies** → 实际大概率回退 PATH `codex`。

### 4.2 方法实现状态

| 方法 | 状态 | 说明 |
|---|---|---|
| initialize | ✅ | `codexService.refreshProvider()`（读**旧 SimpleStore** 的 provider） |
| destroy | ✅ | `codexService.removeAllListeners()` + `eventLog.destroy()` |
| listThreads / createThread / deleteThread | ✅ | 内存 Map + workflowThreadStore；deleteThread 还 `codexService.closeSession(threadId)` |
| forkThread | ✅（简化） | 本地复制 + `workflowThreadStore.cloneThread`；**未调用 codexService.forkThread**（codex RPC 的 thread/fork 存在但没用） |
| sendMessage | ✅（事件子集） | 见 §4.3 |
| interruptTurn | ✅ | turnToThread → `codexService.abortSession(threadId)` |
| setModel | — 缺失 | capabilities.setModel=false，一致 |
| getAvailableModels | ✅ | `configuredRuntimeModels()` |
| setPermissionMode | ⚠️ 局部生效 | 只存 `this.permissionMode`（用于 runtime-status detail）；**不传播给 codex**（codex 的 approvalPolicy/sandbox 在 createSession 时从旧 store settings 读） |
| registerTool | — 缺失 | capabilities.registerTool=false，一致 |
| listTools | ✅ | `configuredMcpTools()` |
| cancelTool | — 缺失 | capabilities.cancelTool=false，一致 |
| truncateThread | — 缺失 | capabilities.editMessage=false，一致 |
| readThread / subscribeThread | ✅ | 委托 `workflowThreadStore` |
| respondApproval | ⚠️ 有缺陷 | **遍历 turnToThread 所有线程**对每个调用 `codexService.respondToApproval(threadId, requestId, approve/deny)`——requestId 是 codex approval id，但会广播到所有会话而非目标线程 |

### 4.3 sendMessage 事件流

1. 推 user 消息 + `workflowThreadStore.startTurn`。
2. 返回 async generator：yield turn-start → runtime-status → 注册 `codexService.onEvent/onError` → `codexService.sendMessage(threadId, content)` → 用"队列 + wakeup"把 EventEmitter 桥成异步迭代（`while (!completed || queue.length)`）。
3. `convertThreadEvent`（binary-runtime.ts 内置）映射：
   - `turn.completed` → turn-complete(success)；`turn.failed` → error + turn-complete(error)
   - `approval_requested` → approval-request（timeout 固定 120s，reason 是 toolInput 的 JSON）
   - item `agent_message` → text-chunk；item `reasoning` → thinking-chunk
   - item.started `mcp_tool_call` → tool-start；item.completed `mcp_tool_call` → tool-complete
   - item `error` → error(recoverable)
4. 结束把 assistantText 推回本地 thread。

**事件覆盖缺口（相对 SPI 全 18 种）**：不产生 tool-progress、token-usage、context-usage、context-warning、session-info、mcp-status、memory-recall、prompt-suggestion。

### 4.4 未接通点

1. **provider/API key 断链**：codexService 读旧 SimpleStore（默认空 apiKey），新设置页写新 settings.json，`setApiKey` 无调用者 → 实际运行必报 `"API key not configured"`。
2. **codex 二进制依赖**：未打 bundle 时依赖 PATH `codex`；无此命令则 createSession 抛错。
3. respondApproval 广播所有线程（语义 bug）。
4. gateway 端口/生命期由 codexService 内部 `startGateway` 管理，无显式关闭路径（stopGateway 存在但无人调用）。
5. forkThread 未打通 codex thread/fork RPC（新 fork 线程是本地壳，不继承 codex 线程状态）。

---

## 5. SelfBuiltRuntime（self-built runtime，self-built-runtime.ts，691 行）

### 5.1 形态：这是"模拟器"，不是真 agent loop

- **不调用任何 LLM / 模型端点**：`modelId = "local-loop"`（假），`getAvailableModels()` 硬编码 `[{ id: "local-loop", label: "Local Loop" }]`，token-usage 是 `text.length/4` 的估计值。
- `sendMessage` 走确定性逻辑：`planTurn()` 解析斜杠命令（`/list` `/read` `/patch` `/undo`，其余 intent=respond）→ `executePlan()` 直接同步执行 fs 操作（list/read/patch/undo，含 `resolveSandboxPath` 工作区沙箱校验、undo 栈）→ 把结果按 24 字符切片 + 8ms 延时模拟打字 → 兜底 canned 文案 `"Self-built runtime is active."`。
- 是"**计划-执行-验证**"演示/占位实现，用于在没有真实内核时让 UI 链路能跑通。

### 5.2 与 personal-claw 的关系

- 代码中无 `personal-claw` 字样；但文档明确把它列为参考：
  - `docs/prd/README.md:37`："personal-claw | 自建 agent loop | 完全可控 | 维护成本高"。
  - `docs/architecture/README.md:513`："personal-claw | `C:/workspace/personal-claw` | Self-built 自建 loop 参考（**跑通**）"。
  - `docs/architecture/three-layer-contract.md`：personal-claw 提供"未来自建核心 runtime 的控制权 / future runtime core"。
- 结论：**self-built-runtime.ts 是 personal-claw 思路在本仓库内的"壳"，完成度远低于参考项目**（参考项目是跑通的真实 loop；本文件是模拟占位）。git 历史浅（squash），无法从提交追溯演进细节。

### 5.3 与 gateway 的关系

- **不依赖 gateway**：imports 只有 `node:fs/path`、`@shared/*`、`mcp-tools`、`config-service`、`tool-permission-engine`、`tool-storm-breaker`。无任何协议转换，因为它根本不发请求。

### 5.4 方法实现状态

| 方法 | 状态 | 说明 |
|---|---|---|
| initialize | ✅ | `registerBuiltinTools()`（注册 `memory.echo` 演示工具） |
| destroy | ✅ | 清状态 + resolve pending approvals |
| listThreads / createThread / deleteThread / forkThread / truncateThread | ✅ | **全部只操作本地内存 Map，完全不碰 workflowThreadStore** |
| sendMessage | ✅（模拟流） | 事件种类：turn-start、runtime-status、thinking-chunk（计划文本）、tool-start/progress/complete（fs 工具或模拟敏感写）、approval-request（正则 `/approval|敏感工具|审批/` 触发）、text-chunk、token-usage、error、turn-complete |
| interruptTurn | ✅ | abortedTurns 集合 |
| cancelTool | ✅ | cancelledTools 集合 |
| setModel | ✅（仅存字段） | `this.modelId`，只用于状态文案 |
| getAvailableModels | ✅（硬编码） | 只有 local-loop |
| setPermissionMode | ✅ | 存字段 + 传 evaluateToolPermission |
| registerTool | ✅ | 内存工具注册表（可用） |
| listTools | ✅ | configuredMcpTools() + 注册表合并 |
| respondApproval | ✅ | pendingApprovals Map |
| **readThread** | ❌ **未实现（方法缺失）** | 导致 `readRuntimeThreadSnapshot` 返回 null → workflow 渲染拿不到线程数据 |
| **subscribeThread** | ❌ **未实现（方法缺失）** | 同上 |

### 5.5 关键缺口

1. **不是真内核**：无模型调用，能力上限是本地 fs 演示 + canned 回复。
2. **readThread/subscribeThread 缺失**：即便它在 UI 上"能聊"，workflow 线程视图（read-thread 契约）完全空白——这是它和另两个 runtime 最大的结构差异。
3. 不写 workflowThreadStore：startTurn/applyRuntimeEvent 均未调用，线程状态只在本地 Map。
4. capabilities 声明全 true 与实现不符（readThread/subscribeThread、真实模型能力等）。

---

## 6. 三实现能力对比表（核心产出）

图例：✅ 完整实现 · 🟡 部分/简化实现 · ⚪ stub（空实现/仅存字段） · ❌ 显式抛错 · — 方法缺失（capabilities 声明不支持）

| AgentRuntime 方法 | ClaudeRuntime (sdk) | BinaryRuntime (binary) | SelfBuiltRuntime (self-built) |
|---|---|---|---|
| name / capabilities | ✅ | ✅ | ✅ |
| initialize | 🟡 仅 import 探测 | ✅ refreshProvider（旧 store） | ✅ 注册内置工具 |
| destroy | ✅ | ✅ | ✅ |
| listThreads | ✅ 内存 Map | ✅ 内存 Map | ✅ 内存 Map |
| createThread | ✅ + workflowStore | ✅ + workflowStore | ✅ 仅本地 |
| deleteThread | ✅ + workflowStore | ✅ + workflowStore + closeSession | ✅ 仅本地 |
| forkThread | 🟡 本地复制（SDK forkSession 未用） | 🟡 本地复制（codex thread/fork RPC 未用） | ✅ 本地复制 |
| sendMessage | ✅ 18 种事件全覆盖 | 🟡 9 种事件子集 | 🟡 模拟流（无模型） |
| interruptTurn | ✅ activeQuery.interrupt | ✅ abortSession | ✅ abortedTurns |
| setModel | ⚪ 空 no-op（cap=true） | —（cap=false） | 🟡 仅存字段 |
| getAvailableModels | ✅ 配置模型列表 | ✅ 配置模型列表 | 🟡 硬编码 [local-loop] |
| setPermissionMode | ⚪ 空 no-op（cap=true） | 🟡 存字段，不传 codex | 🟡 存字段 + 权限引擎 |
| registerTool | ❌ 抛错（cap=false） | —（cap=false） | ✅ 内存注册表 |
| listTools | ✅ 配置 MCP 静态列表 | ✅ 配置 MCP 静态列表 | ✅ 配置 + 注册表 |
| cancelTool | —（cap=false） | —（cap=false） | ✅ cancelledTools |
| truncateThread | ✅ + workflowStore | —（cap editMessage=false） | 🟡 仅本地 Map |
| readThread | ✅ → workflowThreadStore | ✅ → workflowThreadStore | ❌ 缺失 |
| subscribeThread | ✅ → workflowThreadStore | ✅ → workflowThreadStore | ❌ 缺失 |
| respondApproval | ✅ pending Map | 🟡 广播所有线程 | ✅ pending Map |

**capabilities 声明一致性核查**：
- Claude：声明 setModel/setPermissionMode=true 但实现是空 no-op → **声明高于实现**。
- Binary：声明与实现基本一致（setModel/registerTool/cancelTool/editMessage 均 false 且无方法）。
- SelfBuilt：声明全 true 但 readThread/subscribeThread 缺失、模型能力是假的 → **声明远高于实现**。

---

## 7. 各 runtime"未接通点"清单

### ClaudeRuntime（sdk）
1. `setModel` / `setPermissionMode` 空实现——模型选择只改 settings，SDK 选项每次从 settings 重建（`buildClaudeRuntimeOptions`），所以"改 settings 后再发消息"间接生效，但运行时即时切换无效。
2. `forkThread` 未走 SDK `forkSession`——fork 出的线程是 UI 壳，不继承 SDK 会话/上下文。
3. 默认配置是假模型 `local-loop` + 无 apiKey → 开箱 query 必失败，需用户配置 endpoint。
4. 单 turn 并发限制：`activeQuery`/`activeTurnId` 单实例。
5. `listTools` 是 settings.mcpServers 静态列表，不反映实时 MCP 工具。

### BinaryRuntime（binary）
1. **provider/API key 双轨断链**：codexService 读旧 SimpleStore（默认空 apiKey），新设置页写新 settings.json，`setApiKey` 无调用者 → 实际运行报 `API key not configured`。
2. codex 二进制：package.json 无 `@openai/codex`，依赖 bundled vendor 或 PATH `codex`，缺失即失败。
3. `respondApproval` 广播到所有 turnToThread 会话（应只发目标线程）。
4. `forkThread` 未打通 codex `thread/fork` RPC。
5. `setPermissionMode` 不传给 codex（approvalPolicy/sandbox 在 createSession 时从旧 store 读）。
6. 事件覆盖子集：无 context/token/memory/session-info 等事件。
7. gateway 生命周期：startGateway 由 codexService 内部拉起，`stopGateway` 无人调用（binary destroy 只 removeAllListeners + eventLog.destroy）。

### SelfBuiltRuntime（self-built）
1. **无真实模型**：模拟 loop，无任何外部推理请求；`modelId=local-loop` 是假模型。
2. **readThread/subscribeThread 缺失**：workflow 线程视图（read-thread 契约）完全空白。
3. 完全不写 workflowThreadStore：startTurn/applyRuntimeEvent/cloneThread 均未接入，线程/轮次状态只存在本地 Map，切换 runtime 后全部丢失。
4. capabilities 声明全 true 与实现不符（误导上层 UI 显示能力）。
5. 仅提供 4 个 fs 斜杠命令 + canned 回复，能力上限极低（相对 docs 中 personal-claw 参考项目的"跑通"形态，属于占位）。

---

## 8. 附录：死代码 / 未接线模块（本次分析顺带确认）

| 文件 | 大小 | 状态 | 说明 |
|---|---|---|---|
| `core/runtime/claude-normalizer.ts` | 9KB | **死代码** | 把 SDK 消息归一化成旧 `MessageItem`（`@shared/workflow-types`）；全仓库无 import 者；claude-runtime 用的是自己内置的 `normalizeSdkMessage`。 |
| `codex/adapter-lab.ts` | 24KB | **死代码（实验诊断）** | "适配器实验室"：读旧 store 的 rawEvents + `~/.codex/sessions/*.jsonl`，对 8 个参考用例（basic_qa/shell_success/multi_tool/reasoning/file_patch/custom_tool/mcp_tool/failure_or_interrupt）做覆盖度/parity 报告（`readAdapterLabReport`）。**不是 runtime、不是适配器**，是验证 binary 适配器覆盖率的分析工具，未接 UI/IPC。 |
| `codex/session-log.ts` | 50KB | 死代码 | JSONL 会话日志解析；仅被 jsonl-replay-data-source 引用。 |
| `codex/jsonl-replay-data-source.ts` / `codex/replay.ts` / `codex/tool-runtime.ts` | ~12KB | 死代码 | replay 管理器与 jsonl 回放数据源，无人 import。 |

**codex/ 存活子集**：`service.ts`、`session.ts`、`normalize.ts`、`transport/{connection,jsonrpc-client,types}.ts`、`event-log.ts`（binary runtime 链路使用）。

---

## 9. 附：关键文件索引

| 文件 | 行数 | 角色 |
|---|---|---|
| client/shared/agent-runtime.ts | 223 | SPI：18 事件 + 12 方法 + capabilities |
| client/shared/runtime-event-adapter.ts | 157 | RuntimeEvent → UIEvent（全覆盖） |
| client/main/core/runtime/manager.ts | 159 | 注册表/生命周期/切换/getRuntimeState |
| client/main/core/runtime/claude-runtime.ts | 1470 | SDK runtime（最完整） |
| client/main/core/runtime/binary-runtime.ts | 329 | 二进制 runtime（codex CLI + gateway） |
| client/main/core/runtime/self-built-runtime.ts | 691 | 自建 runtime（模拟占位） |
| client/main/core/runtime/workflow-thread-store.ts | 559 | 线程/turn 内存存储 + read/subscribe |
| client/main/core/runtime/read-thread-serializer.ts | 100 | workflow read-thread 分页序列化 |
| client/main/codex/service.ts | 718 | codex CLI 会话管理（含 gateway 接入） |
| client/main/codex/session.ts | 396 | codex app-server JSON-RPC 会话 |
| client/main/codex/transport/connection.ts | 267 | spawn codex 二进制 + 解析二进制位置 |
| client/main/gateway/index.ts + pipeline.ts | 85/513 | 本地 HTTP gateway：Responses→Chat 协议转换 |
| client/main/services/config-service.ts | 704 | 新配置（默认 activeRuntimeId=self-built，默认模型 local-loop） |
| client/main/store.ts | 374 | 旧 SimpleStore（codex 链路的 provider 来源，断链） |
| client/main/index.ts | 296 | initRuntime/destroyRuntime 接线点 |
| client/main/ipc/handlers.ts | 2230 | 全部 runtime IPC（CHAT_*/RUNTIME_*） |
