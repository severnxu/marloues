import { useEffect, useRef, useState } from 'react'
import { WorkflowAssistantTurn } from './AssistantTurn'
import { WorkflowUserMessage } from './UserMessage'
import { workflowTurnDurationLabel, workflowTurnStatusLabel, workflowTurnStatusTone } from './turn-status'
import type { WorkflowMessageBlock as WorkflowMessageBlock } from '../../../../shared/adapters/workflow-messages-to-read-thread'
import { workflowTurnLayout } from './turn-layout'
import { workflowTurnPresentation } from './turn-presentation'

interface Props {
  message: WorkflowMessageBlock
  expanded: boolean
  isLastStreaming: boolean
  modelName?: string
  showFooterMetadata?: boolean
  onToggle: () => void
  onCopy?: (text: string) => void | Promise<void>
  onRegenerate?: () => void
  onRewind?: () => void
  onEdit?: () => void
  onDelete?: (id: string) => void
}

export function WorkflowTurnView({ message, expanded, isLastStreaming, modelName, showFooterMetadata, onToggle, onCopy, onRegenerate, onRewind, onEdit, onDelete }: Props) {
  const responseTimerRef = useRef<{ messageId: string; startedAt: number; stoppedAt?: number } | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const layout = workflowTurnLayout(message, { hideReasoning: isLastStreaming })
  const presentation = workflowTurnPresentation(message, layout, isLastStreaming)
  const hasActivityItems = layout.leadingActivityItems.length > 0 || layout.trailingActivityItems.length > 0
  const running = isLastStreaming || message.status === 'running' || message.activity === 'thinking' || message.activity === 'running' || message.activity === 'responding'
  const showDuration = !(isLastStreaming && !hasActivityItems)
  const responseTimerActive = running && showDuration && hasActivityItems

  if (responseTimerActive && responseTimerRef.current?.messageId !== message.id) {
    responseTimerRef.current = {
      messageId: message.id,
      startedAt: now,
    }
  }
  if (!running && responseTimerRef.current?.messageId === message.id && responseTimerRef.current.stoppedAt == null) {
    responseTimerRef.current = { ...responseTimerRef.current, stoppedAt: now }
  }
  if (running && responseTimerRef.current?.messageId === message.id && responseTimerRef.current.stoppedAt != null) {
    responseTimerRef.current = { messageId: message.id, startedAt: now }
  }

  const responseTimer = responseTimerRef.current?.messageId === message.id ? responseTimerRef.current : null
  const responseDurationMs = responseTimer ? Math.max(0, (responseTimer.stoppedAt ?? now) - responseTimer.startedAt) : null
  const durationMs = responseDurationMs ?? (running ? null : (message.durationMs ?? null))
  const label = workflowTurnStatusLabel(message, { hasActivityItems, isLastStreaming })
  const duration = showDuration ? workflowTurnDurationLabel(durationMs, { running }) : ''
  const turnModelName = message.modelName ?? message.modelId ?? modelName

  useEffect(() => {
    if (!responseTimerActive) return undefined
    const interval = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(interval)
  }, [responseTimerActive])

  return (
    <section className="mb-7 animate-fadeUp" data-kind="workflow-turn" data-turn-expanded={String(expanded)}>
      <WorkflowUserMessage text={message.user} content={message.userContent} onEdit={onEdit} onRegenerate={onRegenerate} onRewind={onRewind} />

      <WorkflowAssistantTurn
        activity={message.activity}
        duration={duration}
        expanded={expanded}
        hasActivityItems={hasActivityItems}
        isLastStreaming={isLastStreaming}
        isRunning={running}
        label={label}
        layout={layout}
        messageId={message.id}
        modelName={turnModelName}
        presentation={presentation}
        createdAt={message.completedAt ?? message.startedAt}
        showFooterMetadata={showFooterMetadata}
        tone={workflowTurnStatusTone(message)}
        usage={message.usage}
        onToggle={onToggle}
        onCopy={onCopy}
        onRegenerate={onRegenerate}
        onDelete={onDelete}
      />
    </section>
  )
}
