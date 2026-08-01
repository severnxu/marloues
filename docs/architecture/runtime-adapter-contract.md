# Runtime Adapter Contract

> 目标：把 `RuntimeEvent` 稳定转换为 renderer 可消费的 `UIEvent`，再进入 `workflow-chat` 风格组件。

更新时间：2026-06-18

## 1. 职责

Adapter 只做三件事：

1. 接收 runtime 原始事件。
2. 转成稳定的 `UIEvent`。
3. 供 renderer 进一步映射成 `WorkflowMessageBlock`。

## 2. 输入 / 输出

### 输入

- `RuntimeEvent`
- `sessionId`
- `turnId`

### 输出

- `UIEvent`

## 3. 最小映射表

| RuntimeEvent | UIEvent |
|---|---|
| `turn-start` | `turn.start` |
| `text-chunk` | `text.chunk` |
| `thinking-chunk` | `thinking.chunk` |
| `tool-start` | `tool.start` |
| `tool-progress` | `tool.progress` |
| `tool-complete` | `tool.complete` |
| `turn-complete` | `turn.complete` |
| `approval-request` | `approval.request` |
| `context-usage` | `context.usage` |
| `runtime-status` | `runtime.status` |
| `error` | `error` |

## 4. 转换规则

1. `turn-start` 必须先于该 turn 的任何内容事件。
2. `tool-progress` 要保留 partial input，用于渐进式展示。
3. `turn-complete` 必须携带最终状态。
4. `approval-request` 不直接渲染为消息流，单独走审批通道。
5. 任何未知事件都应被丢弃或记录，不得破坏流。

## 5. Renderer 侧职责

Renderer 只认 `UIEvent`，再将其整理为：

- session state
- turn state
- message items
- timeline items

最后交给 `workflow-chat` 组件族渲染。

## 6. 约束

- 不允许 UI 直接消费 `RuntimeEvent`
- 不允许 runtime 直接输出组件可见结构
- 不允许 adapter 里做业务状态决策

## 7. 下一步代码入口

- `client/main/ipc/handlers.ts`：接入统一 adapter
- `client/shared/ui-protocol.ts`：作为 renderer 稳定协议
- `client/renderer/src/components/workflow-chat/*`：消费统一消息模型
