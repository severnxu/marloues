# 02 · 事件适配链路与 gateway 协议层分析

> 目标：从"三个 runtime 各产生什么事件"到"UI 消费什么事件"，审计事件适配链路是否接通，
> 以及 gateway 协议网关的角色与接通状态。
> 范围：只读分析，未修改任何文件。仓库根：`C:\workspace\marloues-ui-r2`（代码在 `client/`）。

---

## 0. 结论速览（TL;DR）

1. **三 runtime 的事件形状已经统一**：`claude-sdk / binary(codex) / self-built` 的
   `sendMessage()` 全部返回 `AsyncIterable<RuntimeEvent>`（`client/shared/agent-runtime.ts` 的 SPI），
   没有"各自独立通道"（codex 的 item-event 只是内部中间形态，`binary-runtime.convertThreadEvent` 会把它转成 RuntimeEvent）。
2. **`translateRuntimeEventToUIEvent` 对 RuntimeEvent 的翻译是封闭完整的**（17 个 kind 全覆盖，无未翻译 kind）；
   但**主进程转发层存在真实缺口**：`session.info / mcp.status / memory.recall / prompt.suggestion /
   context-warning / runtime.status / turn.start` 被翻译成 UIEvent 后，在 `handlers.ts` 的事件循环里被**静默丢弃**，
   从未发到 `CHAT_EVENT` 通道——而 renderer 侧 `handleStatusEvents` 专门为它们写了处理（现在是死代码）。
3. **`AgentBackendAdapter`（`agent-backend-adapter.ts`）是全仓库零引用的死抽象**：接口 + 工厂函数已定义，
   没有任何消费者；当前实际承担"runtime 抽象层"职责的是 `AgentRuntime` SPI + `workflowThreadStore`。
4. **gateway（`main/gateway/`）是仅服务 codex 二进制的本地协议代理**：HTTP 8080 端口，把
   OpenAI/Anthropic 协议请求经内部 IR 转发到所选 provider，只被 `main/codex/service.ts` 启动；
   与 self-built runtime、与 RuntimeEvent/UIEvent 事件流**完全无关**。
5. **self-built runtime 未接入 read-thread 链路**：不实现 `readThread/subscribeThread`、不写
   `workflowThreadStore` → `CHAT_READ_THREAD_UPDATE` 对 self-built 是 null/空快照。

---

## 1. `client/shared/runtime-event-adapter.ts` — RuntimeEvent → UIEvent 翻译

### 1.1 翻译表（`translateRuntimeEventToUIEvent`，switch on `evt.kind`）

| RuntimeEvent kind | UIEvent type | 备注 |
|---|---|---|
| `turn-start` | `turn.start` | 同时重置该 (sessionId,turnId) 的 text-chunk 计数器 |
| `text-chunk` | `text.chunk` | 追加自增 `index`（模块级 Map 计数） |
| `thinking-chunk` | `thinking.chunk` | — |
| `tool-start` | `tool.start` | 透传 toolId/toolName/input |
| `tool-progress` | `tool.progress` | `partialInput ?? ""`、`input`、`isReady` |
| `tool-complete` | `tool.complete` | 透传 output/isError |
| `turn-complete` | `turn.complete` | 删计数器；`timestamp: Date.now()`；透传 result/content/error/sdkSessionId |
| `runtime-status` | `runtime.status` | — |
| `session-info` | `session.info` | skills/slashCommands/agents |
| `mcp-status` | `mcp.status` | servers/tools |
| `memory-recall` | `memory.recall` | mode/memories |
| `prompt-suggestion` | `prompt.suggestion` | — |
| `context-usage` | `context.usage` | phase/percentage/limit/usage |
| `context-warning` | `context.warning` | level/message/percentage |
| `token-usage` | `usage` | 注意：type 是 `usage` 而非 `token.usage` |
| `approval-request` | `approval.request` | 不带 sessionId/turnId（按 UIEvent 契约本就没有）；allowSession 默认 true |
| `error` | `error` | code/message/recoverable |
| **其它（default）** | **`null`（丢弃）** | 未知 kind 的安全网 |

### 1.2 有没有"adapter 不认识的 kind"？

**没有。** `RuntimeEvent` 是 `agent-runtime.ts` 里的封闭判别联合（17 个 kind），adapter 的 switch
恰好全覆盖；且三个 runtime 实际产出的 kind 均落在联合内（见 §6），所以当前不存在
"runtime 产生但 adapter 不认识"的 kind。`default → null` 只是对未来新增 kind 的静默丢弃兜底——
若未来 runtime 新增 kind 而忘记更新 adapter，事件会无声消失（无日志、无类型报错之外的表现）。

### 1.3 真正的"缺口"不在 adapter，而在 adapter 之后

adapter 是纯函数、翻译完整；问题在于**谁消费翻译结果**（见 §6.3）以及
**大量 UIEvent type 根本没有生产者**：

- `ui-protocol.ts` 声明了 24+ 种 UIEvent，但 adapter 只产出其中 17 种的映射；
  以下 type **在 main 进程全仓库无任何生产者**（renderer 侧却写了完整 handler，属死分支/未来预留）：
  - `plan.delta` / `plan.item`
  - `steer.message`（renderer `steer-event-handlers.ts` 有 handler，无 producer）
  - `approval.decision`
  - `execution.subagent.start / .event / .complete`、`execution.task.update`（renderer `event-handler-slice` + `workflow-message-builders` 有完整逻辑，无 producer）
  - `user.message`
  - `compact.boundary`
  - `session.titleUpdated`（renderer 有 handler，无 producer）
- 仅 `context.compaction` 例外：由 `handlers.ts` 在 preflight 阶段**手工合成**发送（不是 adapter 产物）。

---

## 2. `client/shared/agent-backend-adapter.ts`（70 行）— 角色与接通状态

### 2.1 接口内容

- `AgentBackendAdapterKind = 'workflow-app-server' | 'jsonl-replay' | 'static' | 'custom'`
- `AgentBackendAdapter`：
  - `kind`（必填）
  - `readThread(input): Promise<WorkflowReadThreadResponse>`（**唯一必填**）
  - 可选：`listThreads?`、`sendMessage?`、`subscribeThread?`、`forkThread?`、`resumeThread?`
  - `AgentThreadEvent = WorkflowReadThreadResponse | WorkflowThreadPatch`
- `createAgentBackendAdapterFromDataSource(dataSource)`：把 `WorkflowThreadDataSource` 包成
  `AgentBackendAdapter`（只透传 `readThread` + 可选 `subscribeThread`，kind 直接透传）。

### 2.2 被谁消费？——**零消费者，纯死代码**

grep `createAgentBackendAdapterFromDataSource|AgentBackendAdapter`（全仓库）：
命中 5 处**全部在本文件内部**（类型定义与工厂自身）。没有 handlers、runtime、renderer、
codex 任何一处 import 它。

### 2.3 判断

- 设计意图上它确实是"抽象层"的候选核心接口（把 thread 数据源抽象成 backend adapter），
  **但当前完全未接通**——不是"抽象层核心"，而是"定义未用"。
- 当前真正承担 runtime 抽象的是 `AgentRuntime` SPI（`agent-runtime.ts`，`readThread?/subscribeThread?`
  直接内嵌了 DataSource 契约，见 §3）＋ 主进程 `workflowThreadStore` 单例。
- 若要启用，至少需要：一个 `workflow-app-server` 后端实现（目前连 kind 字符串都无实现）、
  以及 handlers 侧从 `getRuntime()` 改走 adapter 的接线。

---

## 3. `client/shared/workflow-thread-data-source.ts` — 数据源契约

### 3.1 接口

- `WorkflowThreadDataSource`：`kind` + `readThread(input)`（必填）+ `subscribeThread?(input):
  AsyncIterable<WorkflowReadThreadResponse | WorkflowThreadPatch>`（可选）。
- `WorkflowThreadPatch = snapshot | turns | threadStatus` 三种补丁。
- 辅助工厂 `createStaticWorkflowThreadDataSource(loader)`（static 快照，无 subscribe）。

### 3.2 与 `AgentRuntime.readThread/subscribeThread` 的关系

`AgentRuntime`（`agent-runtime.ts` L210-215）把同一组输入/输出类型内嵌为**可选方法**：
`readThread?(input: WorkflowReadThreadInput): Promise<WorkflowReadThreadResponse>`、
`subscribeThread?(input: WorkflowSubscribeThreadInput): AsyncIterable<WorkflowReadThreadResponse | WorkflowThreadPatch>`。
即：**AgentRuntime SPI 直接以 DataSource 契约为子集**，`AgentBackendAdapter` 只是同一契约的另一种包装。

### 3.3 谁实现它（真实实现 vs 死代码）

| 实现 | 位置 | 状态 |
|---|---|---|
| `workflowThreadStore`（类） | `client/main/core/runtime/workflow-thread-store.ts` | **唯一活实现**。`claude-runtime.readThread/subscribeThread` 与 `binary-runtime.readThread/subscribeThread` 都委托给它；`addListener` 驱动 `CHAT_READ_THREAD_UPDATE` 广播 |
| `createJsonlReplayWorkflowThreadDataSource` | `client/main/codex/jsonl-replay-data-source.ts` | 只读回放 codex session-log，**无消费者**（死代码/实验品） |
| `createStaticWorkflowThreadDataSource` | 本文件内 | 无消费者 |
| `self-built-runtime` | — | **不实现** readThread/subscribeThread（SPI 可选，直接缺席） |

---

## 4. `client/main/core/runtime/claude-normalizer.ts`（9KB）— normalizer 现状

### 4.1 它归一化成什么

`normalizeClaudeMessage` / `normalizeClaudeTurn`：把 Claude SDK 消息流（system init / stream_event
text_delta / thinking_delta / content_block_start tool_use / input_json_delta / user tool_result /
result）归一化成 **`MessageItem`**（`@shared/workflow-types`：`agent_message` / `reasoning` /
`mcp_tool_call` / `error`），带 phase/status 状态机、delta 聚合逻辑（`normalizeClaudeTurn` 用 Map 合并）。

**注意：它不是 RuntimeEvent、也不是 UIEvent**——它是面向 workflow-chat 渲染层的 MessageItem 模型。

### 4.2 服务哪个 runtime？——**当前无人使用（死代码）**

grep `normalizeClaudeMessage|normalizeClaudeTurn|claude-normalizer`：**除本文件外零引用**。
claude 实际运行的归一化是 `claude-runtime.ts` 内联的 `normalizeSdkMessage()`（L311-636），
它把 SDK 消息转成 **RuntimeEvent**（不是 MessageItem）。即：存在两套 Claude 归一化：
`claude-normalizer.ts`（→MessageItem，未接线）vs `claude-runtime.normalizeSdkMessage`（→RuntimeEvent，已接线）。
前者可视为被取代的旧方案或给 workflow-chat 直连预留的备选。

### 4.3 binary / self-built 有没有对应 normalizer？

| runtime | normalizer | 产出 | 状态 |
|---|---|---|---|
| claude (sdk) | `claude-runtime.normalizeSdkMessage` | RuntimeEvent | ✅ 已接线；另有 `claude-normalizer.ts`(→MessageItem) 未接线 |
| binary (codex) | 两级：`codex/normalize.ts`（raw JSONL/RPC → `NormalizedThreadItem`，被 `codex/service.ts`、`session-log.ts`、`adapter-lab.ts` 使用）→ `binary-runtime.convertThreadEvent`（ThreadEvent → RuntimeEvent） | ThreadItem → RuntimeEvent | ✅ 已接线 |
| self-built | 无外部 normalizer（直接合成 RuntimeEvent） | RuntimeEvent | ✅ 已接线 |
| 通用（shared） | `shared/adapters/runtime-event-to-turn-item.ts`（RuntimeItemEvent→WorkflowTurnItem，自称"唯一转换点"） | WorkflowTurnItem | ⚠️ 仅单测引用，未接入主进程（注释自述"替换目标：chat.ts 内联构造"，尚未落地） |

---

## 5. `client/main/gateway/`（协议网关）— 角色与接通状态

### 5.1 角色：本地 HTTP 协议代理（provider 路由），不是事件网关

- `gateway/index.ts`：`startGateway()` 用 store 配置起服务；`resolveRoute` 每请求重读
  `store.getSelectedProvider()`，**固定 `targetProtocol: 'openai-chat'`**；默认端口 8080（被占则 +1 直到可用）。
- `gateway/server.ts`：`http.createServer`，监听 `127.0.0.1`；路由：
  `/health`、`/` → `{status:"ok", proxy:"neo-runtime-gateway", version:"0.1.0"}`；
  `/v1/models` → store 里 enabled provider 的模型列表；POST + `detectProtocol(url)` → `pipeline.handleRequest`。
- `gateway/pipeline.ts`：`detect → decode(→IR) → resolveRoute → encode(IR→上游) → forward →
  [非流式] parse(上游响应→IR) → format(IR→客户端协议) / [流式] parse SSE → format SSE → reply`；
  含多 route 容错、`needsConversion` 同协议直通 relay。
- `gateway/types.ts`：`ProtocolId = 'anthropic'|'openai-chat'|'openai-responses'`、内部 IR
  （IrRequest/IrMessage/IrResponse/IrStreamDelta/IrUsage…）。

### 5.2 四个协议目录的职责

| 目录 | 职责 | 文件 |
|---|---|---|
| `protocol/to-internal/` | **入站解码**：客户端协议请求 → IR（anthropic / openai-chat / openai-responses 三种 decode） | `anthropic.ts` `openai-chat.ts` `responses.ts` |
| `protocol/from-internal/` | **出站编码**：IR → 上游 provider 请求（anthropic / openai-chat） | `anthropic.ts` `openai-chat.ts` |
| `protocol/response/to-internal/` | 上游**非流式响应** → IR | `anthropic.ts` `openai-chat.ts` `responses.ts` |
| `protocol/response/from-internal/` | IR → **客户端协议**非流式响应 | `anthropic.ts` `openai-chat.ts` `responses.ts` |
| `protocol/stream/` | SSE：上游解析器（anthropic / openai-chat）+ 客户端格式化器（anthropic / openai-chat / openai-responses）+ 类型 | `anthropic.ts` `openai-chat.ts` `anthropic-formatter.ts` `openai-chat-formatter.ts` `responses-formatter.ts` `types.ts` |

注：`protocol/index.ts` 里 `encodeRequest('openai-responses', …)` 实际落 `openai-chat` 路径
（`/v1/chat/completions`）——responses 作为**目标协议**编码未真正实现，只在流式输出格式化时用
`OpenAIResponsesSseFormatter`。

### 5.3 被谁启动/使用？——只被 codex 二进制使用

grep `startGateway|stopGateway|getGatewayPort|isGatewayStarted`：唯一消费者是
`client/main/codex/service.ts`：
- `createSession()`：`getGatewayPort()` 为空则 `startGateway()`，然后把
  `CODEX_API_BASE_URL=http://127.0.0.1:{port}`、`model_providers.codex-web-gateway.base_url=.../v1`、
  `wire_api=responses` 注入 codex CLI 环境与 `-c` 配置（`buildCodexConfigArgs`），让 codex 二进制的
  OpenAI Responses 协议请求打到本地 gateway，再由 gateway 转发到 store 里选的 provider（如 MiniMax）。
- 另外 `convertAndCallMiniMax` 直接复用 `protocol/index.ts` 的 decode/encode/parse 做
  Responses→Chat Completions 的内联转换（不进 HTTP 网关）。

**启动方**：`main/index.ts` / `handlers.ts` 都**没有**启动 gateway → 只有切到 binary runtime 才会拉起。
**与 self-built 的关系**：无。self-built 不经由 gateway 对外提供任何协议，gateway 也不消费
RuntimeEvent/UIEvent。**当前接通状态**：作为 codex 的 provider 代理是接通的（按需懒启动）；作为
"事件网关/统一协议出口"则**不是**——它跟事件适配链路完全正交。

---

## 6. 事件链路审计：从"runtime 产事件"到"UI 消费事件"

### 6.1 三个 runtime 各产生什么事件

- **claude-runtime**（`claude-runtime.ts`）：SDK 消息经 `normalizeSdkMessage` 逐条转 RuntimeEvent，
  产出：`turn-start / session-info / memory-recall / mcp-status / runtime-status / prompt-suggestion /
  text-chunk / thinking-chunk / tool-progress / tool-start / tool-complete / token-usage / error /
  turn-complete`，另在 wrapStream 里补 `context-usage`、`context-warning`（context 策略）与
  `approval-request`（canUseTool 回调，经 `RuntimeEventQueue` 与 SDK 流 race）。
- **binary-runtime**（`binary-runtime.ts`）：codex 二进制 JSON-RPC/JSONL → `codex/normalize.ts`
  → `ThreadEvent`（含 `item.started/updated/completed` 携带 ThreadItem、`turn.completed`、
  `approval_requested`…）→ `convertThreadEvent` 映射为 RuntimeEvent：`turn-start`（合成）、
  `runtime-status`、`text-chunk`、`thinking-chunk`、`tool-start`、`tool-complete`、`approval-request`、
  `error`、`turn-complete`。**未映射的 ThreadEvent 被丢弃**：`context_compacted`、`turn_step_failed`、
  `thread.started/resumed/forked`、`raw_event`、`turn.started`（后者可容忍，handlers 会合成 turn.start）。
- **self-built-runtime**（`self-built-runtime.ts`）：直接合成 RuntimeEvent：
  `turn-start / runtime-status / thinking-chunk / text-chunk / tool-start / tool-progress /
  tool-complete / token-usage / approval-request / error / turn-complete`。
  缺：`session-info / mcp-status / memory-recall / prompt-suggestion / context-usage / context-warning`。

三者产出全部落在 RuntimeEvent 封闭联合内 → adapter 无认知缺口（§1.2）。

### 6.2 事件流形状是否一致？是否都走 `translateRuntimeEventToUIEvent`？

- **形状一致**：三者的 `sendMessage` 都是 `Promise<AsyncIterable<RuntimeEvent>>`，`handlers.ts`
  `sendChatTurn` 统一 `for await (const evt of eventStream)` 消费（L1219）。
- **都走同一 adapter**：唯一的 `translateRuntimeEventToUIEvent` 调用点在 `handlers.ts` L1221；
  三 runtime 无任何旁路直达 renderer 的独立事件通道。
- **codex 的 item-event 不是独立通道**：`ThreadItem`/`ThreadEvent` 只存在于 main 进程内部
  （codex service → binary-runtime），到 renderer 前已被转成 RuntimeEvent→UIEvent→MessageItem。
  renderer 收到的 "item event"（`CHAT_ITEM_EVENT`）是 handlers 用 MessageItem 组装的，与 codex 的
  ThreadItem 不是同一对象（但语义对应）。

### 6.3 三条 IPC 通道分别承载什么（`main/ipc/handlers.ts` 为唯一发送方）

| 通道 | IPC 名 | 承载内容 | 发送点（handlers.ts） | renderer 消费 |
|---|---|---|---|---|
| `CHAT_EVENT` | `chat:event` | **UIEvent**（adapter 产物 + preflight 合成） | 实际只发 4 类：`usage`、`context.usage`（L1095/1224）、`context.warning`（L1112）、`context.compaction`（L1122/1146/1157） | `handleEvent`：context.compaction / context.usage / 状态类（session.info 等）/ 短路的 text.chunk、tool.*、usage；turn.complete(final) 分支存在但生产路径从不发 |
| `CHAT_ITEM_EVENT` | `chat:item-event` | **turn.start（合成）/ item.updated（MessageItem）/ turn.complete（合成，带 usage/completedAt/final）** | L991 / 1021 / 1048 / 1065 / 1179 / 1246 / 1269 / 1297 / 1328 / 1364 / 1419 / 1455 / 1837（审批回执） | `createItemEventBatcher` 批量后 `handleItemEvent`；**这是实时流式渲染主路径** |
| `CHAT_READ_THREAD_UPDATE` | `chat:read-thread-update` | **完整 `WorkflowReadThreadResponse` 快照**（或 null） | L168-174：`workflowThreadStore.addListener` 广播（`registerReadThreadBroadcast`）+ `CHAT_READ_THREAD` invoke（L1782） | `handleReadThread`：权威快照渲染；`loadReadThread` |

另有审批专用 `CHAT_PERMISSION_REQUEST`（L1334）/ `CHAT_PERMISSION_RESPONSE`（L1816），不属三条主通道。

### 6.4 逐 runtime 链路完整性

| 链路 | claude | binary(codex) | self-built |
|---|---|---|---|
| RuntimeEvent 产出 | ✅ | ✅（ThreadEvent→convertThreadEvent） | ✅ |
| 走 `translateRuntimeEventToUIEvent` | ✅ | ✅ | ✅ |
| `workflowThreadStore.startTurn/applyRuntimeEvent`（喂 read-thread） | ✅ | ✅ | ❌ **完全不写 store** |
| `readThread/subscribeThread`（供 CHAT_READ_THREAD_UPDATE） | ✅ 委托 store | ✅ 委托 store | ❌ 未实现 → `readRuntimeThreadSnapshot` 返回 null |
| 状态类事件（session.info/mcp.status/memory.recall/prompt.suggestion/context-warning/runtime.status/turn.start）→ renderer | ⚠️ 翻译了但**主进程不转发**（handlers 循环无对应分支，静默丢弃） | ⚠️ 同左（且 binary 本就不产出多数状态类） | ⚠️ 同左（且 self-built 本就不产出多数状态类） |
| 实时消息/工具/审批渲染（CHAT_ITEM_EVENT） | ✅ | ✅ | ✅ |
| 权威快照渲染（CHAT_READ_THREAD_UPDATE） | ✅ | ✅ | ❌（self-built 回合期间/结束后无快照） |

---

## 7. 事件适配缺口清单（按严重度）

| # | 缺口 | 位置 | 影响 | 建议方向 |
|---|---|---|---|---|
| G1 | **主进程事件循环不转发状态类 UIEvent**：adapter 已把 `session.info/mcp.status/memory.recall/prompt.suggestion/context-warning/runtime.status/turn.start` 翻译出来，但 `sendChatTurn` 的 if 链只处理 usage/context.usage/text/thinking/tool/approval/turn.complete/error，其余静默丢弃 | `handlers.ts` L1219-1443 | renderer `handleStatusEvents`（sessionInitInfo 的 skills/slashCommands/mcp 状态）**成为死代码**；Claude SDK 的 skills/命令/MCP/记忆召回信息永远到不了 UI | 在事件循环里补 `CHAT_EVENT` 转发分支（或按 type 白名单直发） |
| G2 | **self-built 不接入 read-thread 链路**：不实现 `readThread/subscribeThread`，也不写 `workflowThreadStore` | `self-built-runtime.ts` | `CHAT_READ_THREAD_UPDATE` 对 self-built 恒 null；回合内/后无权威快照，仅靠 item 流；fork/truncate 等基于 store 的能力对 self-built 失效 | self-built 补 `workflowThreadStore.startTurn/applyRuntimeEvent` 与 readThread 委托 |
| G3 | **大量 UIEvent type 无生产者**：`plan.delta/plan.item/steer.message/approval.decision/execution.*/user.message/compact.boundary/session.titleUpdated` 在 main 全仓无发送点 | `ui-protocol.ts` + renderer 各 handler | renderer 相关分支（execution 面板、steer、标题更新等）当前永远不会触发；若未来 runtime 直接产这些，需同时补 adapter 映射与主进程转发 | 明确这些是"预留协议"还是删掉；若保留，标注生产者计划 |
| G4 | **codex 事件丢失**：`context_compacted / turn_step_failed / raw_event / thread.*` 在 `convertThreadEvent` 被丢弃 | `binary-runtime.ts` L266-328 | codex 中途 context 压缩、step 失败对 UI 不可见（UI 的 `context.compaction` 只有 preflight 合成来源） | 为 `context_compacted` 补 `context.compaction` 事件映射 |
| G5 | **adapter `default → null` 静默丢弃**：未来新增 RuntimeEvent kind 若未同步 adapter 会无声消失 | `runtime-event-adapter.ts` L154 | 可观测性差 | 未知 kind 至少 log/warn |
| G6 | **两套 Claude 归一化并存**：`claude-normalizer.ts`（→MessageItem）未接线，实际走 `claude-runtime.normalizeSdkMessage`（→RuntimeEvent） | `claude-normalizer.ts` | 重复维护、误导（读代码容易以为 MessageItem 是现行模型） | 删除或并入现行链路 |
| G7 | **死抽象**：`agent-backend-adapter.ts`、`jsonl-replay-data-source.ts`、`runtime-event-to-turn-item.ts`、`adapter-lab.ts` 均零生产引用 | shared/main/codex | 维护成本与误导（"抽象层核心接口"实际未接通） | 要么接线，要么标注 Phase-2 预留 |

---

## 8. AgentBackendAdapter / gateway 角色与接通状态（汇总）

| 组件 | 设计角色 | 当前接通状态 |
|---|---|---|
| `AgentBackendAdapter`（shared） | 把 thread 数据源抽象成 backend 适配器（kind 可插拔：workflow-app-server/jsonl-replay/static/custom） | ❌ **零消费者**。实际抽象由 `AgentRuntime` SPI + `workflowThreadStore` 承担 |
| `WorkflowThreadDataSource`（shared） | read-thread 数据源契约 | ✅ 作为 `AgentRuntime.readThread?/subscribeThread?` 内嵌契约活用于 claude/binary；`workflowThreadStore` 为唯一活实现 |
| `gateway/`（main） | 本地 HTTP 协议代理（OpenAI/Anthropic ↔ 内部 IR ↔ 上游 provider），服务 codex 二进制接任意 provider | ✅ 接通但**仅限 binary runtime**（`codex/service.ts` 懒启动）；与事件链路正交 |
| `claude-normalizer.ts` | Claude SDK → MessageItem | ❌ 死代码；现行是 `claude-runtime.normalizeSdkMessage` → RuntimeEvent |

---

## 9. 三 runtime 事件通道对比表

| 维度 | claude (sdk) | binary (codex) | self-built |
|---|---|---|---|
| 事件来源 | Claude SDK 消息流 | codex 二进制 JSON-RPC/JSONL → `normalize.ts` → ThreadEvent | 本地合成（plan→execute→verify 循环） |
| 到 RuntimeEvent 的转换 | `normalizeSdkMessage`（inline） | `convertThreadEvent` | 直接 yield |
| 事件类型覆盖 | 最全（含 session-info/mcp-status/memory-recall/prompt-suggestion/context-usage/context-warning） | 中（缺 memory/prompt/context-usage；context_compacted 被丢） | 少（缺 session-info/mcp/memory/prompt/context 系列） |
| 写 `workflowThreadStore`（read-thread 快照） | ✅ startTurn + applyRuntimeEvent | ✅ startTurn + applyRuntimeEvent | ❌ |
| `readThread/subscribeThread` | ✅ 委托 store | ✅ 委托 store | ❌ |
| 走 `translateRuntimeEventToUIEvent` | ✅（唯一调用点 handlers L1221） | ✅ | ✅ |
| 主进程→renderer 通道 | CHAT_EVENT(usage/context.*) + CHAT_ITEM_EVENT + CHAT_READ_THREAD_UPDATE | 同左 | CHAT_EVENT + CHAT_ITEM_EVENT（**READ_THREAD 为 null**） |
| 状态类事件到 UI | ⚠️ 翻译但主进程不转发（G1） | ⚠️ 同左（且产出少） | ⚠️ 同左（且产出少） |
| gateway 依赖 | 无 | ✅ 依赖（provider 代理） | 无 |

---

## 10. 一句话总结

事件侧"三归一"已做到 RuntimeEvent 层面并全量翻译，但**主进程转发层（handlers）只把翻译结果的
一小撮发到 renderer**（G1），self-built 又缺 read-thread 接入（G2），外加一批无生产者的 UIEvent
（G3）——因此"事件适配链路"在 adapter 处是完整的，在 IPC 通道处是**部分接通**；
gateway 则是与事件流无关、只服务 codex 二进制的本地协议代理，且当前**接通可用**。
