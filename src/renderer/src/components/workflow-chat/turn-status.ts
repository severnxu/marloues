import type { WorkflowMessageBlock } from '../../../../shared/adapters/workflow-messages-to-read-thread'

export function workflowTurnStatusTone(message: WorkflowMessageBlock): string {
  if (message.activity === 'failed') return 'text-danger'
  return 'text-text-muted'
}

export function workflowTurnStatusLabel(
  message: WorkflowMessageBlock,
  options: { hasActivityItems?: boolean; isLastStreaming?: boolean } = {},
): string {
  if (message.activity === 'failed' || message.status === 'failed') return '任务失败'
  if (message.activity === 'done' || message.status === 'completed') return '已处理'
  if (options.isLastStreaming && options.hasActivityItems) return '已处理'
  return '处理中'
}

export function workflowTurnDurationLabel(durationMs: number | null, options: { running?: boolean } = {}): string {
  if (!durationMs) return ''
  const seconds = Math.max(1, options.running ? Math.ceil(durationMs / 1000) : Math.floor(durationMs / 1000))
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}
