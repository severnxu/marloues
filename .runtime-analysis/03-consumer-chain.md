# 03 — UI → IPC → Runtime 消费链路分析（抽象层接通情况）

> 仓库：`C:\workspace\marloues-ui-r2`（代码在 `client/`）｜只读分析｜2026
> 范围：从渲染层到 `AgentRuntime` SPI（`client/shared/agent-runtime.ts`）的完整消费链。
> 背景文档：`docs/architecture/three-layer-contract.md`（Runtime/Protocol/UI 三层）、`docs/architecture/runtime-adapter-contract.md`（RuntimeEvent→UIEvent 适配契约）。
> 结论一句话：**SPI 与三个实现都建好了，但消费链只有“发送/事件流/权限”三段接通；runtime 切换无 UI、binary 走另一套配置、能力不齐的操作直接抛错——这就是“抽象层未接通”的具体含义。**

---

## 0. TL;DR（三个最关键发现）

1. **切换 runtime 的整条链路没有 UI 消费者**：`RUNTIME_GET_STATE` / `RUNTIME_SWITCH` 在 preload（`client/preload/index.ts:118-119`）和主进程 handler（`handlers.ts:1875-1881`）都齐全，但渲染层**零调用**（全仓 grep 只有 preload/types/handlers/manager 四处）。设置里的“运行时”tab 是“Python/Node 下载”占位，实际未渲染。用户**无法**从界面切换 runtime，“多内核”在 UI 上不存在。
2. **binary runtime 走的是另一套（legacy）配置，完全绕过 AgentSettings**：`codexService`（`client/main/codex/service.ts`）读 `store.ts` 的 legacy Provider（默认硬编码 MiniMax + `MiniMax-M2.7-highspeed` + 网关 + `MINIMAX_API_KEY`），设置 UI 里配的 `providers/defaultModel/runtimeConfigDir` 对它**全部无效**。
3. **能力矩阵不齐，未实现的直接抛错而不是降级**：`cancelTool` 只有 self-built 有（sdk/binary 的 `CHAT_CANCEL_TOOL` 抛错）；`truncateThread`（重发）只有 sdk/self-built 有（binary 抛错）；`readThread` 只有 sdk/binary 有（self-built 返回 null，UI 回退 legacy adapter）。

---

## 1. 三层结构与现有资产

| 层 | 落点 | 现状 |
|---|---|---|
| Runtime 层 | `client/shared/agent-runtime.ts`（SPI）+ `client/main/core/runtime/{claude-runtime,binary-runtime,self-built-runtime}.ts` | 三个实现齐全，`manager.ts` 管理生命周期 |
| Protocol 层 | `client/shared/runtime-event-adapter.ts`（RuntimeEvent→UIEvent）+ `shared/ui-protocol.ts` | 适配器已接通（handlers 流式调用 `translateRuntimeEventToUIEvent`，handlers.ts:1221） |
| UI 层 | `client/renderer/src/**`（unified-chat-store + chat-slices + workflow-chat 组件） | 只消费 `window.marloues.*`（preload） |

SPI 关键面（`agent-runtime.ts`）：`sendMessage` 返回 `AsyncIterable<RuntimeEvent>`；`RuntimeCapabilities`（forkThread/interruptTurn/setModel/setPermissionMode/registerTool/cancelTool/editMessage/sandbox）；可选方法 `forkThread/interruptTurn/setModel/getAvailableModels/setPermissionMode/registerTool/cancelTool/truncateThread/readThread/subscribeThread`；必选 `respondApproval`。

---

## 2. “UI → IPC → Runtime” 全链路接通状态表

### 2.1 会话 / 发送 / 事件流（主链路）

| 环节 | UI 入口 | preload | IPC handler | runtime 方法 | 三个 runtime | 状态 |
|---|---|---|---|---|---|---|
| 列会话 | session-slice.load/loadAllSessions | chat.listSessions/listAllSessions | CHAT_LIST_SESSIONS/LIST_ALL（handlers:1559-1569） | `listThreads` | ✓✓✓ | ✅ 接通（与 store 合并展示） |
| 新建会话 | send-slice（首条消息兜底） | chat.createSession | CHAT_CREATE_SESSION（1605） | `createThread` | ✓✓✓ | ✅ 接通 |
| 删除会话 | session-slice.deleteSession | chat.deleteSession | CHAT_DELETE_SESSION（1627） | `deleteThread` | ✓✓✓ | ✅ 接通 |
| 发消息 | send-slice.sendMessage → WorkflowChatPage | chat.send | CHAT_SEND → `sendChatTurn`（940-1485） | `sendMessage` + 事件流 | ✓✓✓ | ✅ 接通（核心链路；见 2.5 steer 例外） |
| 中止 | send-slice.abort | chat.abort | CHAT_ABORT（1773） | `interruptTurn` | ✓✓✓（handler try/catch 静默忽略） | ✅ 接通（失败静默降级） |
| Fork | WorkflowChatPage.handleForkConversation → forkSession | chat.forkSession | CHAT_FORK_SESSION（1669-1693） | `forkThread` | ✓✓✓ | ⚠️ 半通（capability gate 返回 null 不抛错；且 sdk/binary 的 fork 只是**本地内存拷贝**，不调 SDK forkSession/codex fork，新线程在 runtime 侧无历史） |
| 会话标题/置顶 | session-slice | chat.updateSessionTitle/toggleSessionPinned | 对应 handler | 不调 runtime（store 本地） | — | ✅ 接通 |
| 会话搜索 | GlobalSearchOverlay | chat.searchSessions | CHAT_SEARCH_SESSIONS（1571） | `listThreads` | ✓✓✓ | ✅ 接通 |
| read-thread 详情 | readthread-slice → workflow-chat 渲染 | chat.readThread / onReadThread | CHAT_READ_THREAD（1782）+ 广播（164-175） | `readThread` | sdk✓ binary✓ **self-built✗** | ⚠️ 半通（self-built 返回 null，UI 回退 legacy workflowMessages 适配器，工具卡片/时间线保真度下降） |

### 2.2 运行时管理链路（RUNTIME_*）

| IPC | handler | runtime 方法 | 渲染层消费者 | 状态 |
|---|---|---|---|---|
| RUNTIME_GET_STATE（types.ts:1056） | handlers:1875 → `getRuntimeState()`（manager.ts:134） | —（读 registry 描述符） | **无**（renderer 全仓 grep 无 `runtime.getState`） | ❌ 未通（dead API） |
| RUNTIME_SWITCH（1057） | handlers:1877-1881 → `switchRuntime()`（manager.ts:142） | createRuntime→initialize / destroy / 写 settings.activeRuntimeId | **无**（无 `runtime.switch` 调用） | ❌ 未通（dead API；且 handler **未 return** `switchRuntime` 的结果，类型是 `Promise<RuntimeState>` 实际返回 undefined） |
| RUNTIME_LIST_MODELS（1058） | handlers:1883 → `listRuntimeModels()`（manager.ts:37） | `getAvailableModels`（sdk/binary→`configuredRuntimeModels()`，self-built→`[local-loop]`） | settings-store.load/listModels（settings-store.ts:29） | ✅ 接通（设置弹窗/onboarding 的“可用模型”提示 + 模型选择器） |
| RUNTIME_SET_MODEL（1059） | handlers:1884-1888 → `setRuntimeModel()`（manager.ts:43） | `setModel` + save `defaultModel` | WorkflowChatModelSelector → settings-store.setModel（:47） | ⚠️ 半通（见 5.1：sdk 的 setModel 是 no-op；binary 无该方法被跳过，只落 settings） |

### 2.3 权限（approval）链路

| 环节 | 实现 | 状态 |
|---|---|---|
| runtime 发出 approval-request | sdk：canUseTool 回调 → `waitForApproval`（claude-runtime.ts:1049-1134）；binary：codex approval_requested → convertThreadEvent（binary-runtime.ts:277-289）；self-built：shouldRequestApproval → createApprovalRequest（self-built-runtime.ts:205-288） | ✅ |
| 主进程转发 | handlers.ts:1306-1346：item 事件 + `CHAT_PERMISSION_REQUEST` 广播 + `pendingApprovalItems` 登记 | ✅ |
| UI 弹窗 | App.tsx:186-193（onPermissionRequest 收集）+ respondToPermission（:234-249） | ✅ |
| 回传 | preload chat.respondToPermission → `CHAT_PERMISSION_RESPONSE`（ipcRenderer.send）→ handlers.ts:1816-1845 → `runtime.respondApproval(requestId, approved, scope, reason)` | ✅ 三个 runtime 都实现 |
| 细节问题 | ① binary 的 respondApproval 是**广播式**（遍历 `turnToThread` 全部值，binary-runtime.ts:259-263），多会话并发时会串扰；② adapter 对 approval-request 未传 allowSession 时默认 true，`PermissionDialogRequest.options` 永远不填充（types.ts:821-837 定义了但没人写），UI 无法按策略展示“本次/本次会话”选项 | ⚠️ |

### 2.4 编辑 / 重发 / 回滚链路

| IPC | handler | 依赖的 runtime capability | 三个 runtime 支持 | 状态 |
|---|---|---|---|---|
| CHAT_RESEND_FROM_MESSAGE | handlers:1739-1771：capability gate → `runtime.truncateThread` + `truncateStoredSession` + 重发 | `editMessage` + `truncateThread` | sdk✓ self-built✓ **binary✗** | ⚠️ 半通（binary 走 gate 抛 `Error("Binary does not support editing or regeneration")`，IPC rejection → UI toast；且 **renderer 无任何调用者**——preload/types 暴露了 `resendFromMessage`，UI 里 grep 不到使用处，编辑/重发入口不存在） |
| CHAT_CANCEL_TOOL | handlers:1786-1792：capability gate → `runtime.cancelTool` | `cancelTool` | **self-built✓** sdk✗ binary✗ | ⚠️ 半通（ToolCallRow.tsx:69 有按钮；sdk/binary 抛 `does not support tool cancellation`） |
| CHAT_REWIND_FILES | handlers:1695-1725：**不调 runtime**，走 `workspace-checkpoint-service`（git checkpoint + state-db） | 无 | 全一致 | ⚠️ 半通（主进程逻辑完整，但 UI 无调用者——`rewindFiles` 也是 dead API；SDK 侧 ClaudeQuery.rewindFiles 声明了但 ClaudeRuntime 从不调用，回滚完全依赖 git） |

### 2.5 steer（追加投递）链路 — 断在主进程

- renderer：`WorkflowChatPage.tsx:467-468` 发 `deliveryMode: "steer"`；send-slice（send-slice.ts:48-143）期待回执 `status: "queued"`（继续追加）或 `"fallback"`（已原子转普通 turn）。
- 主进程：`sendChatTurn` **从不读取 `request.deliveryMode`**（handlers.ts:940-1485 只用到 `request.forceSend`），`ChatSendReceipt` 永远不会是 `queued/fallback`。
- 后果：steer 消息实际按普通 turn 发出并执行，但 renderer 收到 `status: "started"` → 走进 else 分支 → `notify(steer-rejected)` 并返回 `{ok:false, reason:"steer-rejected"}` → **UI 提示被拒，任务却在后台运行**（状态双轨）。
- 结论：❌ 未通（steer 是 UI 已实现的交互，主进程侧契约未实现）。

### 2.6 MCP 链路

| 环节 | 实现 | 状态 |
|---|---|---|
| MCP 配置/探测 | mcp-probe.ts（spawn stdio / HTTP-SSE probe，无 runtime 依赖）+ mcp-service.ts 持久化 | ✅ 接通 |
| MCP_LIST_TOOLS | handlers:2102 → `listRuntimeMcpTools()`（mcp-service.ts:74）→ **`getRuntime().listTools()`**（唯一直接依赖 runtime 的服务） | ✅ 接通（三 runtime 都实现，但内容不同：sdk/binary→`configuredMcpTools()` 只是设置里登记的**名字列表**；self-built→名字列表+内置注册工具） |
| MCP 真正注入 runtime | sdk：`buildClaudeRuntimeOptions.mcpServers = enabledMcpServerConfigs(settings)`（options-builder.ts:10-18,92）→ SDK 自建连接；binary：由 codex CLI 自身管理；self-built：**只列名，从不真正调用** | ⚠️ 半通（self-built 的 MCP 是摆设） |
| mcp-status 事件回写 | 仅 sdk（normalizeSdkMessage → `recordMcpRuntimeStatus`，claude-runtime.ts:1226-1231）→ mcp-service.ts:87 | ⚠️ 半通（binary/self-built 不发 mcp-status，设置页 MCP 面板状态不回流） |

### 2.7 服务层对 runtime 的依赖总表

| 服务 | 依赖 runtime？ | 说明 |
|---|---|---|
| session-store.ts | ❌ 否 | 纯 state-db（审计/checkpoint/artifact 存储），不感知 runtime |
| workspace-checkpoint-service.ts | ❌ 否 | git execFile + state-db |
| context-compaction-service.ts | ❌ 否 | 直接 fetch 模型 endpoint（Anthropic 风格，`buildMessagesUrl`），与 runtime 无关；由 sendChatTurn 预检和 CHAT_COMPACT 调用 |
| runtime-prewarm-service.ts | ❌ 否（名不副实） | 不预热 runtime 实例，只做：① `prepareSkillRuntimeCache` ② `diagnoseAnthropicCompatibleEndpoint`（对 resolveModelProvider 的端点 ping）③ `probeMcpServer`。均无 AgentRuntime 交互 |
| mcp-probe.ts / mcp-service.ts | mcp-service **是**（listRuntimeMcpTools→getRuntime().listTools；recordMcpRuntimeStatus 由 sdk 事件驱动） | 见 2.6 |

---

## 3. 三个 runtime 的 SPI 实现矩阵

| SPI 成员 | sdk（ClaudeRuntime） | binary（BinaryRuntime） | self-built（SelfBuiltRuntime） |
|---|---|---|---|
| capabilities（manager.ts:51-87 声明） | fork✓ int✓ setModel✓ setPerm✓ regTool✗ cancel✗ edit✓ sandbox✗ | fork✓ int✓ setModel✗ setPerm✓ regTool✗ cancel✗ edit✗ sandbox✓ | 全 ✓（含 regTool/cancelTool/edit/sandbox） |
| `forkThread` | ✓ 本地 clone + workflowThreadStore.cloneThread（960-976） | ✓ 本地 clone（108-124） | ✓ 本地 clone（106-121） |
| `truncateThread` | ✓（978-997，含 workflowThreadStore.truncateFromUserMessage） | **✗ 未实现**（capability editMessage=false） | ✓（123-131） |
| `readThread` / `subscribeThread` | ✓ workflowThreadStore（1389-1399） | ✓ workflowThreadStore（251-257） | **✗ 未实现**（也不接入 workflowThreadStore → 无 read-thread 广播） |
| `cancelTool` | **✗ 未实现**（capability false） | **✗ 未实现** | ✓（325-327） |
| `setModel` | ✓ 但 **no-op**（1361-1364，注释“MVP: store runtime model preference”）；真正生效靠 settings.defaultModel → 下次 query 的 options.model | ✗（无方法，manager 的 `if (runtime.setModel)` 跳过） | ✓ 设 this.modelId（329-331） |
| `getAvailableModels` | ✓ configuredRuntimeModels()（AgentSettings 全部 enabled 模型） | ✓ 同左 | ✓ 固定 `[local-loop]`（333-335） |
| `setPermissionMode` | ✓ 但 **no-op**（1370-1372，实际靠 canUseTool 回调按 settings 判定） | ✓ 存 this.permissionMode（239-241） | ✓（337-339） |
| `registerTool` | ✗ **抛错**（1380-1387） | ✗（capability false） | ✓ 内置 memory.echo + 注册表（341-344,361-376） |
| `respondApproval` | ✓ 精确匹配 pendingApprovals（1403-1415） | ✓ 但**广播**到所有 turn（259-263） | ✓ 精确匹配（353-359） |
| `sendMessage` | ✓ 走 Claude SDK query + RuntimeEventQueue 合并审批（1001-1346）；SDK 包缺失时每 turn 降级为 error 消息（loadSdk 抛错 → handler catch） | ✓ 走 codexService JSON-RPC（160-232） | ✓ 自建 plan/execute/verify loop（133-319，纯本地规则，无 LLM 调用） |
| `interruptTurn` | ✓ query.interrupt（1350-1357） | ✓ codexService.abortSession（234-237） | ✓ abortedTurns.add（321-323） |
| 线程模型 | 内存 Map（threads，重启即失）+ runtimeThreadIds.sdk 持久化 SDK session_id 供 resume | 内存 Map + codex 会话线程（codex thread id **从不写回** runtimeThreadIds.binary） | 内存 Map，以 marloues sessionId 为线程 id |

---

## 4. 切换 runtime 的完整路径审计

### 4.1 代码路径

```
设置 UI 无入口（断点 ①）
  → window.marloues.runtime.switch(id)   // preload 已暴露，renderer 无调用（断点 ②）
    → IPC "runtime:switch"                // handlers.ts:1877
      → switchRuntime(id)                 // manager.ts:142
        → createRuntime(id)               // manager.ts:102：registry[id].create() + await initialize()
        → runtime = next; activeRuntimeId = id
        → previousRuntime.destroy()       // try/catch 吞错
        → saveAgentSettings({...settings, activeRuntimeId: id})   // 持久化
      → handler 未 return（类型 Promise<RuntimeState> 实际 undefined）（断点 ③）
```

### 4.2 各目标 runtime 的可达性

| 目标 | 启动可行性 | 卡点 |
|---|---|---|
| **self-built**（当前默认，见 §6） | 始终可行（initialize 只注册内置工具） | 无外部依赖；但会话详情（readThread）为空、无真实 LLM |
| **sdk**（ClaudeRuntime） | 可行：`@anthropic-ai/claude-agent-sdk@^0.3.220` 在依赖里（client/package.json:52） | 需 AgentSettings 配置好 provider（baseUrl+apiKey+model），且 `ANTHROPIC_BASE_URL` 兼容 Anthropic 风格；未配置/SDK 加载失败 → 每 turn 降级为失败消息 |
| **binary**（BinaryRuntime） | 本机可行：`resolveBundledCodexBinary()` 返回 null（node_modules 无 `@openai/codex`，resources 无 bundled binary）→ 回退 PATH 上的 `codex`（本机存在，npm 全局） | ① 必须走 legacy SimpleStore 的 Provider（默认 minimax，apiKey 为空 → `createSession` 抛 “API key not configured”）；② 需要启动本地 gateway（`startGateway()`，codex/service.ts:207-211）；③ 设置 UI 的 providers 对它无效（断点 ④，见 §5.3） |

### 4.3 切换后会话/线程映射（runtimeThreadIds 机制）

- 存储：`StoredSession.runtimeThreadIds: Partial<Record<RuntimeKind, string>>`（store.ts:97），落盘 userData/config.json；renderer 侧 `ChatSessionRecord.kernelSessionId / runtimeThreadIds`（handlers.ts:535-536）。
- 写入点：只有 `appendStoredMessage(..., uiEvent.sdkSessionId, activeRuntimeId)`（handlers.ts:748-751,1391）——**只有 sdk runtime 的 turn-complete 携带 sdkSessionId**（claude-runtime.ts:625-626，来自 SDK `msg.session_id`）。
- 读取点：`sendChatTurn` 计算 `nativeRuntimeThreadId = savedSession.runtimeThreadIds[activeRuntimeId] ?? (activeRuntimeId==="sdk" ? savedSession.runtimeThreadId : undefined)`（handlers.ts:966-968）→ sdk 用它 `options.resume`（需 `isLikelyClaudeSessionId`，UUID 校验 claude-runtime.ts:136-140）；binary 的 resume 由 codexService 自己从 SimpleStore 读（codex/service.ts:429-439）。
- 断点：**binary 的 codex thread id 从不写回**（其 turn-complete 无 sdkSessionId），`runtimeThreadIds.binary` 只可能来自 legacy `codexThreadId` 迁移（store.ts:192-201）→ 新会话切到 binary、或 binary 会话重启后，线程关联丢失。self-built 无外部线程概念（sessionId 即线程 id），切换后旧 runtime 的线程历史不会延续（UI 显示 store 里的历史消息，但新 runtime 侧上下文为空）。
- 结论：跨 runtime 的“同一会话延续”只对 sdk 真实成立；binary 半通；self-built 是伪延续。**切换即断上下文**。

---

## 5. 配置链路审计

### 5.1 providers + defaultModel → runtime 模型选择

- `resolveModelProvider(settings)`（core/config/model-provider.ts:11-37）：按 `defaultModel.providerId/modelId` 找 enabled provider/model，逐级 fallback；返回 `{provider, selection, model, baseUrl, apiKey}`。
- 消费方：① handlers 的 `modelSnapshotFromProvider`（显示用，handlers.ts:767-778）；② sdk runtime 的 `buildClaudeRuntimeOptions({model: settings.defaultModel.modelId, env: sdkEnv})`（options-builder.ts:76,84；claude-runtime.ts:1041-1048）；③ context-compaction 直连 endpoint；④ prewarm endpoint 诊断。
- 断点：sdk 的 `setModel` 是 no-op，模型切换只靠落盘 `defaultModel` 在**下一次** sendMessage 生效（当前 turn 内切模型不生效）；`RUNTIME_SET_MODEL` 的 `providerId` 参数被 runtime 层忽略（只传 modelId 给 `runtime.setModel`）。

### 5.2 buildSdkEnv / 环境变量组装

- 生效版本在 `config-service.ts:681-703`（claude-runtime.ts:25 从此 import）：清空全部 `ANTHROPIC_/OPENAI_/CLAUDE_*`，注入 `ANTHROPIC_API_KEY/AUTH_TOKEN/BASE_URL/MODEL` + `CLAUDE_CONFIG_DIR = settings.runtimeConfigDir || getRuntimeConfigDir()` + 禁遥测。
- **断点 ⑤**：`core/config/env-builder.ts` 里有一份**逻辑相同但无人引用**的 `buildSdkEnv` 副本（grep 无任何 import）——双份实现，容易漂移。
- **断点 ⑥**：binary 完全不使用 buildSdkEnv；其 env 由 codexService 手工拼 `MINIMAX_API_KEY/BASE_URL/MODEL/OPENAI_*/CODEX_*`（codex/service.ts:236-249），与 AgentSettings 无关。

### 5.3 activeRuntimeId / runtimeConfigDir 如何驱动 runtime

- `settings.activeRuntimeId`（types.ts:455）→ `manager.selectedRuntimeId()`（manager.ts:96-100）：仅当 registry 中该 id `status==="available"` 才接受，否则回落 `"sdk"`。但**默认值**是 `"self-built"`（config-service.ts:62 `defaultAgentSettings().activeRuntimeId`，且 normalize 用 `{...defaults, ...settings}` 兜底）→ 首启/无该字段时实际激活 self-built，不是 sdk。
- `runtimeConfigDir`（types.ts:456）只影响两处：SDK 的 `CLAUDE_CONFIG_DIR`（config-service.ts:700）与 memory-service 的 CLAUDE.md 目录（memory-service.ts:99,127）。binary/self-built 完全无视。
- 企业配置可覆盖 `activeRuntimeId/runtimeConfigDir/defaultModel`（config-service.ts:223-224,647-648），保存时本地值受控。

---

## 6. 启动链路审计（client/main/index.ts）

```
app.whenReady
  ├─ await initRuntime()                      // :185，先于窗口
  │    → selectedRuntimeId()                  // settings.activeRuntimeId，默认 "self-built"
  │    → createRuntime → initialize()         // self-built：注册内置工具，永不抛错
  │    失败仅 logError("runtime.init.failed")  // :187-189，不阻塞窗口 —— 但之后所有 getRuntime() 抛错
  ├─ installMainConsoleCapture / logInitialConfig
  ├─ registerHandlers()                       // :202
  ├─ createWindow()                           // :203（preload 注入 window.marloues）
  ├─ initAutoUpdateService()
  └─ startRuntimePrewarm()                    // :205
app.on("window-all-closed") → destroyRuntime() // :220
```

- **当前启动后实际激活：`settings.activeRuntimeId`（默认 “self-built”**，见 §5.3）。这也是为什么开箱就能发消息（demo loop），但会话详情 readThread 为空、MCP 只是摆设。
- **切换到 binary/self-built 的路径“通不通”**：IPC 层面通（switchRuntime 实现完整），但 ① 无 UI 触发；② binary 需要 legacy store apiKey + codex 二进制 + gateway；③ binary 配置链与 AgentSettings 脱节；④ 切换后旧 runtime 的线程上下文不延续（§4.3）。
- **startRuntimePrewarm 做什么**（runtime-prewarm-service.ts）：250ms 后异步 ① skill 缓存预热 ② 对 `resolveModelProvider` 的端点跑 3s 诊断（endpoint-diagnostics）③ 对所有 enabled MCP server 跑 probe。**不创建/不预热任何 AgentRuntime 实例**——名称有误导性。

---

## 7. 未接通的断点清单（按优先级）

### P0 — 阻塞“多 runtime”目标本身的断点

| # | 断点 | 证据 | 影响 |
|---|---|---|---|
| B1 | **runtime 切换无 UI / 无调用者**：`RUNTIME_GET_STATE`、`RUNTIME_SWITCH` 是 dead API（renderer 零消费）；设置“运行时”tab 是 Python/Node 下载占位且未渲染（SettingsDialog.tsx:46-50 定义了 nav，SettingsWorkbench.tsx 无 `section==="runtimes"` 分支；`RuntimeSettings.tsx` 实际是权限/轮次设置） | preload/index.ts:117-123；handlers.ts:1875-1888；grep 无 `runtime.switch`/`runtime.getState` | 用户无法切换 runtime，“多内核”在 UI 层面不存在 |
| B2 | **binary 配置链路断裂**：codexService 读 legacy SimpleStore（默认 MiniMax + 硬编码 env + 网关），绕过 AgentSettings.providers/defaultModel/runtimeConfigDir；且无 `@openai/codex` 依赖/无 bundled binary，只能靠 PATH | codex/service.ts:181-251,429；store.ts:116-158；client/package.json | 设置里配的端点对 binary 无效；binary 开箱不可用（apiKey 空） |
| B3 | **能力不齐直接抛错**：`cancelTool`（sdk/binary）、`truncateThread`（binary）capability gate 抛 `Error` → IPC rejection → UI toast；`readThread`（self-built）返回 null → 会话详情降级 | handlers.ts:1743-1747,1788-1790；binary-runtime.ts（无 truncateThread/cancelTool）；self-built-runtime.ts（无 readThread） | 用户在 sdk/binary 下点“取消工具”必错；binary 下重发必错；self-built 下无工作流详情 |

### P1 — 半通链路（功能在但语义残缺）

| # | 断点 | 证据 | 影响 |
|---|---|---|---|
| B4 | **steer 追加投递断在主进程**：`sendChatTurn` 不读 `deliveryMode`，永不返回 `queued/fallback` | send-slice.ts:48-143；handlers.ts:940-1485 | UI 提示 steer 被拒但任务照常执行，状态双轨 |
| B5 | **runtimeThreadIds 只对 sdk 真实生效**：binary 的 codex thread id 从不写回；跨 runtime 切换即断上下文 | handlers.ts:966-968,1391；claude-runtime.ts:625；binary convertThreadEvent（binary-runtime.ts:266-275 无 sdkSessionId） | binary 会话重启/切换后无法 resume 原 codex 线程 |
| B6 | **resendFromMessage / rewindFiles 是 dead API**：preload+types+主进程齐全，renderer 无调用者（编辑/重发/回滚 UI 不存在） | preload/index.ts:168,174；grep renderer 无使用 | 主进程能力空转，产品功能缺失 |
| B7 | **sdk 的 setModel/setPermissionMode 是 no-op**（capability 标 true 但实现为空） | claude-runtime.ts:1361-1372 | 切模型本 turn 不生效；权限模式只能靠 canUseTool 回调 |
| B8 | **RUNTIME_SWITCH handler 未 return 结果**（类型 `Promise<RuntimeState>` vs 实际 undefined） | handlers.ts:1877-1881 | 一旦有 UI 接入，调用方拿不到新状态 |
| B9 | **binary respondApproval 广播式**（对所有 turn 调用） | binary-runtime.ts:259-263 | 多会话并发时审批串扰 |
| B10 | **self-built 不接 workflowThreadStore**：无 read-thread 广播、无 mcp-status、无线程持久化（重启全丢） | self-built-runtime.ts（无 workflowThreadStore import） | 详情页/工具时间线/MCP 状态在 self-built 下全部缺失 |

### P2 — 一致性与健壮性

| # | 断点 | 证据 |
|---|---|---|
| B11 | `buildSdkEnv` 双份实现，`core/config/env-builder.ts` 无人引用 | env-builder.ts vs config-service.ts:681-703 |
| B12 | `initRuntime` 失败只记日志 → 所有 runtime IPC 抛 “Runtime not initialized”，App `isReady` 永不置 true → 白屏（无显式失败态） | index.ts:185-189；App.tsx:122-134,251；settings-store.ts:18-22 |
| B13 | approval-request 未携带 allowSession；`PermissionDialogRequest.options` 永不填充 | runtime-event-adapter.ts:141-144；types.ts:821-837 |
| B14 | binary descriptor 的 statusReason 在 registry 构造时一次性计算，切换后不会更新（“未发现 bundled binary”信息可能过时） | manager.ts:15-35 |
| B15 | `CHAT_FORK_SESSION` 对 sdk/binary 是本地拷贝而非 runtime 级 fork（SDK `forkSession`、codex `forkThread` 从未被调用），fork 出的新线程在 runtime 侧无历史 | claude-runtime.ts:960-976；binary-runtime.ts:108-124；claude-sdk.ts:98-105 声明但未用 |

---

## 8. 附：关键证据文件索引

- SPI：`client/shared/agent-runtime.ts`
- 运行时管理器：`client/main/core/runtime/manager.ts`
- 三个实现：`client/main/core/runtime/{claude-runtime,binary-runtime,self-built-runtime}.ts`
- IPC 面：`client/main/ipc/handlers.ts`、`client/main/ipc/channels.ts`（转发 `@shared/types` IPC）
- preload：`client/preload/index.ts`；类型契约：`client/shared/types.ts`（MarlouesAPI:863-1013，IPC:1015-1104）
- 渲染层消费：`client/renderer/src/stores/chat-slices/*`、`unified-chat-store.ts`、`App.tsx`、`pages/WorkflowChatPage.tsx`、`components/settings/*`
- 配置：`client/main/core/config/model-provider.ts`、`client/main/services/config-service.ts`（buildSdkEnv）、`client/main/core/config/{env-builder,options-builder}.ts`
- 服务层：`client/main/services/{session-store,workspace-checkpoint-service,context-compaction-service,runtime-prewarm-service,mcp-probe,mcp-service}.ts`
- 启动：`client/main/index.ts`
- binary 后端：`client/main/codex/{service,session,event-log}.ts`、`client/main/codex/transport/connection.ts`、`client/main/gateway/*`
- 双 store 并存的证据：`client/main/store.ts`（legacy SimpleStore） vs `client/main/services/config-service.ts`（AgentSettings）
