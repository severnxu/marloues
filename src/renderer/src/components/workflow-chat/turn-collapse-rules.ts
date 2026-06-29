import type {
  WorkflowMessageBlock as WorkflowMessageBlock,
  WorkflowTurnItem as WorkflowStreamItem,
} from '../../../../shared/adapters/workflow-messages-to-read-thread'

type AgentMessageItem = Extract<WorkflowStreamItem, { type: 'agentMessage' }>
export type WorkflowProcessItem = Exclude<WorkflowStreamItem, AgentMessageItem | { type: 'userMessage' }>

export type WorkflowActivityGroupViewState = {
  showSummary: boolean
  summaryExpanded: boolean
  showDetail: boolean
}

export type WorkflowTurnRuntimeState = {
  activity: WorkflowMessageBlock['activity']
  status: WorkflowMessageBlock['status']
  isLastStreaming: boolean
}

export function workflowTurnStateKey(scope: string, messageId: string): string {
  return `${scope}:${messageId}`
}

export function workflowTurnIsCompleted(message: Pick<WorkflowMessageBlock, 'activity' | 'status'>): boolean {
  return message.activity === 'done' || message.status === 'completed'
}

export function workflowTurnDefaultCollapsed(message: Pick<WorkflowMessageBlock, 'activity' | 'status'>): boolean {
  return workflowTurnIsCompleted(message)
}

export function workflowTurnShouldCollapseAfterRuntime(
  message: Pick<WorkflowMessageBlock, 'activity' | 'status'>,
  previous: WorkflowTurnRuntimeState | undefined,
  isLastStreaming: boolean,
): boolean {
  if (isLastStreaming) return false
  if (!workflowTurnIsCompleted(message)) return false
  const wasIncomplete = previous != null && !workflowTurnIsCompleted(previous)
  const streamingJustStopped = previous?.isLastStreaming === true && !isLastStreaming
  return wasIncomplete || streamingJustStopped
}

export function workflowActivityGroupViewState(parentExpanded: boolean, summaryExpanded: boolean): WorkflowActivityGroupViewState {
  if (parentExpanded) {
    return {
      showSummary: true,
      summaryExpanded,
      showDetail: summaryExpanded,
    }
  }

  return {
    showSummary: true,
    summaryExpanded,
    showDetail: summaryExpanded,
  }
}

export function workflowShouldShowProcessItem(item: WorkflowProcessItem): boolean {
  if (item.type === 'reasoning') return Boolean(item.encrypted || item.summary.trim() || item.content?.some(part => part.text.trim()))
  if (item.type === 'dynamicToolCall' || item.type === 'mcpToolCall') {
    const name = workflowLayoutToolName(item)
    if (name === 'token_count' || name.endsWith('.token_count')) return false
  }
  return true
}

export function workflowShouldShowActivityItem(item: WorkflowProcessItem): boolean {
  if (!workflowShouldShowProcessItem(item)) return false
  if (item.type === 'imageView') return false
  if (item.type === 'imageGeneration' && (item.result || item.savedPath)) return false
  return true
}

export function workflowIsCollapsibleActivityItem(item: WorkflowProcessItem): boolean {
  return item.type === 'commandExecution'
    || item.type === 'fileChange'
    || item.type === 'mcpToolCall'
    || item.type === 'dynamicToolCall'
    || item.type === 'collabAgentToolCall'
    || item.type === 'webSearch'
    || item.type === 'permissionRequest'
}

export function workflowShouldKeepSingleActivityItem(items: WorkflowProcessItem[]): boolean {
  if (items.length !== 1) return false
  const [item] = items
  if (workflowItemIsRunning(item) && item.type === 'commandExecution') return false
  return item.type === 'commandExecution' || item.type === 'mcpToolCall' || item.type === 'dynamicToolCall'
}

export function workflowIsResultCardSourceItem(item: WorkflowProcessItem): boolean {
  if (item.type === 'fileChange') return item.changes.length > 0
  if (item.type === 'imageView') return Boolean(item.path)
  if (item.type === 'imageGeneration') return Boolean(item.result || item.savedPath)
  if (item.type === 'webSearch') return true
  if (item.type === 'dynamicToolCall') return workflowLayoutToolName(item) === 'js'
  return false
}

export function workflowItemIsRunning(item: WorkflowProcessItem): boolean {
  if (!('status' in item)) return false
  return workflowStatusIsRunning(item.status)
}

export function workflowStatusIsRunning(statusValue: unknown): boolean {
  const status = String(statusValue).toLowerCase()
  return status === 'running' || status === 'pending' || status === 'in_progress' || status === 'inprogress'
}

export function workflowLayoutToolName(item: WorkflowProcessItem): string {
  if (item.type === 'mcpToolCall') return [item.server, item.tool].filter(Boolean).join('.') || item.tool
  if (item.type === 'dynamicToolCall') return item.tool.toLowerCase()
  return item.type
}
