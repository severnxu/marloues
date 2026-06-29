# UI Consumption Model

> 目标：定义中性的 `workflow-chat` 组件在 marloues 中的唯一消费模型。

更新时间：2026-06-18

## 1. 核心对象

### 1.1 WorkflowMessageBlock

一条用户输入及其对应 agent 输出，作为一个 turn 的展示单元。

必备字段：

- `id`
- `user`
- `userContent`
- `status`
- `activity`
- `startedAt`
- `completedAt`
- `durationMs`
- `items`

### 1.2 WorkflowTurnItem

turn 内的原子展示项：

- `agentMessage`
- `reasoning`
- `commandExecution`
- `fileChange`
- `mcpToolCall`
- `dynamicToolCall`
- `collabAgentToolCall`
- `webSearch`
- `imageGeneration`
- `hookPrompt`
- `contextCompaction`
- `unknown`

## 2. 组件输入

### 2.1 MessageList

输入：

- `messages`
- `workflowMessages?`
- `isStreaming`

职责：

- 选择外部 workflow 数据或由消息推导出的 workflow 数据
- 将最终结果交给 `WorkflowTurnList`

### 2.2 WorkflowTurnList

输入：

- `workflowMessages`
- `isStreaming`
- `stateScopeKey`

职责：

- 逐条渲染 turn
- 维持折叠状态
- 将单条 turn 交给 `WorkflowTurnView`

### 2.3 WorkflowTurnView

输入：

- `message`
- `expanded`
- `isLastStreaming`

职责：

- 渲染 user message
- 渲染 assistant turn
- 展示 reasoning / tool / file / command / search 等内容

## 3. 数据流

```txt
UIEvent
  -> session / turn / timeline state
  -> Message[]
  -> WorkflowMessageBlock[]
  -> WorkflowTurnList
```

## 4. UI 规则

1. UI 不解析 runtime 原始事件。
2. UI 不关心 runtime 类型。
3. UI 只消费 workflow 数据。
4. workflow 数据可以来自实时流，也可以来自历史回放。
5. 组件行为继承逆向资产的交互范式，但输入必须是稳定模型。

## 5. 可开始写代码的入口

- `src/renderer/src/components/workflow-chat/workflow-message-adapter.ts`
- `src/renderer/src/components/workflow-chat/WorkflowTurnList.tsx`
- `src/renderer/src/components/workflow-chat/WorkflowTurnView.tsx`
