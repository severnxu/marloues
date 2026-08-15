# 从单一 runtime 到多 runtime 抽象 — 工作清单

> 基于 `.runtime-analysis/01/02/03` 三份深度分析汇总（2026-08-16）。
> 结论先行：**抽象层骨架已存在且约 70% 接通**（SPI、管理器、事件适配、三条 IPC 通道都在），
> 卡点在三处——① 默认配置跑的是 self-built 模拟 loop（假模型）；② 三个 runtime 完成度差异大
> （Claude 完整 > Binary 配置断链 > SelfBuilt 模拟占位）；③ 主进程事件转发层只发一小撮事件。

---

## 0. 现状一句话

```
UI (chat-slices / workflow-chat)
   │  CHAT_EVENT / CHAT_ITEM_EVENT / CHAT_READ_THREAD_UPDATE
IPC handlers (main/ipc/handlers.ts, getRuntime())
   │  RuntimeEvent (18 种)  ← 三 runtime 统一输出
AgentRuntime SPI (shared/agent-runtime.ts)   ← 抽象层已存在
   ├─ ClaudeRuntime (sdk)     完整：真实接 Claude SDK，18 事件全覆盖
   ├─ BinaryRuntime (binary)  代码完整：codex CLI + gateway，但 provider/apiKey 断链
   └─ SelfBuiltRuntime        模拟占位：无模型调用，readThread/subscribeThread 缺失
默认激活：self-built + 假模型 local-loop  → 开箱"看似可用实则不可用"
```

---

## Phase 0 — 先让它"开箱能用"（半天空）

目标：默认激活真实内核，发消息能打通模型。

| # | 任务 | 文件 | 说明 |
|---|---|---|---|
| 0.1 | **默认 runtime 从 self-built 改为 sdk** | `main/services/config-service.ts:62`（`defaultAgentSettings().activeRuntimeId`） | 让开箱跑 ClaudeRuntime 而非模拟 loop |
| 0.2 | **默认模型从假模型 local-loop 改为真实占位** | 同上 `defaultModel` | 至少不叫 local-loop；配合 onboarding 让用户配 endpoint |
| 0.3 | **验证 sdk 全链路** | `claude-runtime.ts` + 一个真实 endpoint | 发消息 → SDK → RuntimeEvent → UIEvent → chat 渲染 + read-thread 快照 |
| 0.4 | 修复 `initRuntime` 失败白屏 | `main/index.ts:185-189` | 失败时 UI 显示明确错误态而非 `isReady` 永不置 true |

## Phase 1 — 三个内核各自接通（1-2 天）

### 1.1 ClaudeRuntime（sdk）— 最完整，补 3 个洞

| # | 任务 | 说明 |
|---|---|---|
| 1.1.1 | `setModel` 真正生效 | claude-runtime.ts:1361 空 no-op；改为更新 settings 并注入下一次 buildClaudeRuntimeOptions（或支持运行时切换） |
| 1.1.2 | `setPermissionMode` 真正生效 | claude-runtime.ts 空 no-op；确认 canUseTool 已覆盖即改声明，否则实现 |
| 1.1.3 | `forkThread` 走 SDK `forkSession` | claude-sdk.ts:98-105 已有包装未用；claude-runtime.ts:960 本地复制改为调用它，让 fork 线程继承 SDK 上下文 |

### 1.2 BinaryRuntime（binary）— 修配置断链 + 事件补全

| # | 任务 | 说明 |
|---|---|---|
| 1.2.1 | **配置单轨化**：codexService 从旧 SimpleStore 改为读 AgentSettings | codex/service.ts:181-251,429；移除对 store.ts provider 的依赖，用 `resolveModelProvider(settings)` 组装 env |
| 1.2.2 | **apiKey 接通**：`codexService.setApiKey` 找到调用者 | 或并入 1.2.1 的配置源切换，删除 setApiKey 死接口 |
| 1.2.3 | codex 二进制可获取 | package.json 加 `@openai/codex` 或确认 bundled vendor 路径；否则明确依赖 PATH 并给出状态提示 |
| 1.2.4 | `respondApproval` 只发目标线程 | binary-runtime.ts:259-263 遍历所有线程改为按 threadId 定位 |
| 1.2.5 | 事件补映射：`context_compacted → context.compaction`、`turn_step_failed → error` | binary-runtime.ts convertThreadEvent 丢弃清单（报告 §6.1） |
| 1.2.6 | forkThread 走 codex `thread/fork` RPC | 新线程继承 codex 线程状态（否则是本地壳） |
| 1.2.7 | gateway 生命周期 | `stopGateway` 接线到 binary destroy（当前无人调用） |

### 1.3 SelfBuiltRuntime — 决定"真实现"还是"演示占位"

| # | 任务 | 说明 |
|---|---|---|
| 1.3.1 | 补齐 `readThread/subscribeThread` + 写 `workflowThreadStore` | 至少让它与另两个 runtime 的结构一致（startTurn/applyRuntimeEvent/委托 store），否则会话详情/时间线/MCP 状态全缺 |
| 1.3.2 | capabilities 声明与实现对齐 | 当前全 true 但模型是假的；要么降级声明，要么接真实模型 |
| 1.3.3 | 决策：接 personal-claw 参考实现 | docs 确认 personal-claw 是"跑通"的参考；如果要真 self-built，移植它的 loop；否则明确它是 demo |

## Phase 2 — 统一事件转发层（0.5-1 天）

| # | 任务 | 说明 |
|---|---|---|
| 2.1 | **主进程事件循环补全转发（G1）** | handlers.ts sendChatTurn 的 if 链只发 usage/context.*；补发 `session.info / mcp.status / memory.recall / prompt.suggestion / context.warning / runtime.status / turn.start` 到 CHAT_EVENT——renderer `handleStatusEvents` 现在是死代码 |
| 2.2 | 明确无生产者的 UIEvent（G3） | `plan.* / execution.* / steer.message / approval.decision / user.message / compact.boundary / session.titleUpdated`：保留则补生产者计划，否则从协议删除 |
| 2.3 | adapter 未知 kind 打 warn | runtime-event-adapter.ts default → null 加 log，避免新事件静默消失 |
| 2.4 | self-built 回合中也推 read-thread 快照（G2） | 与 1.3.1 合并 |

## Phase 3 — UI 切换入口 + 配置统一（1 天）

| # | 任务 | 说明 |
|---|---|---|
| 3.1 | **runtime 切换 UI**：RUNTIME_GET_STATE/RUNTIME_SWITCH 是 dead API（renderer 零调用） | 在设置页加"运行时"入口（当前 SettingsWorkbench 无 runtimes 分支、RuntimeSettings 是权限设置）；选内核 → switchRuntime → 显示状态/能力 |
| 3.2 | `RUNTIME_SWITCH` handler 返回结果 | handlers.ts:1877 未 return `switchRuntime` 的结果（类型 Promise<RuntimeState> vs undefined） |
| 3.3 | **配置单轨**：合并旧 SimpleStore 与 AgentSettings | store.ts（providers/apiKey）与 config-service.ts 双轨；binary 走旧、sdk 走新。统一后一处配置多处生效 |
| 3.4 | `runtimeThreadIds` 跨内核会话延续（B5） | binary 的 codex thread id 写回；切换 runtime 后 resume 原线程（sdk 已支持 resume，binary 补） |
| 3.5 | steer 追加投递接主进程（B4） | sendChatTurn 读 `deliveryMode`，返回 queued/fallback；否则 UI 提示被拒但任务照跑 |

## Phase 4 — 健壮性与清理（0.5-1 天）

| # | 任务 | 说明 |
|---|---|---|
| 4.1 | 能力缺失改"降级提示"而非抛错（B3） | cancelTool/truncateThread 的 capability gate 抛 Error → IPC rejection → UI toast；改为 UI 层按 capabilities 隐藏/禁用按钮 |
| 4.2 | 删除死代码 | claude-normalizer.ts（9KB）、codex/adapter-lab.ts（24KB）、session-log.ts（50KB）、replay.ts、tool-runtime.ts、agent-backend-adapter.ts、env-builder.ts 双份 buildSdkEnv |
| 4.3 | 补 `allowSession` 到 approval（B13） | PermissionDialogRequest.options 永不填充 |
| 4.4 | binary descriptor statusReason 动态化（B14） | 切换后重新检测 bundled binary |
| 4.5 | 会话详情在 binary 下可用 | binary 的 readThread 已接 workflowThreadStore，验证快照广播正常 |

---

## 建议执行顺序

1. **Phase 0 先行**（半天）：改默认 sdk + 真模型 → 验证 Claude 全链路 → 立即可用
2. **Phase 1.2 Binary 配置断链**（关键）：binary 是"代码完整但不可用"最可惜的，修完配置即第二可用内核
3. **Phase 3.1 切换 UI**：让"多内核"在 UI 上可见可切
4. **Phase 1.1/1.3/2**：补三内核实现缺口 + 事件转发
5. **Phase 4**：清理

## 参与文件索引

| 文件 | 角色 |
|---|---|
| shared/agent-runtime.ts | SPI（勿改，稳定契约） |
| main/core/runtime/manager.ts | 三内核注册/切换 |
| main/core/runtime/{claude,binary,self-built}-runtime.ts | 三实现 |
| main/core/runtime/workflow-thread-store.ts | read-thread 唯一活实现 |
| main/ipc/handlers.ts | 全部 runtime IPC + 事件转发（G1 主战场） |
| main/services/config-service.ts | 新配置（默认值在此改） |
| main/store.ts | 旧 SimpleStore（binary 断链源头） |
| main/codex/service.ts | codex 会话 + gateway 接线 |
| main/gateway/* | codex 的 provider 协议代理（已接通） |
| renderer/src/stores/chat-slices/* | UI 事件消费 |
