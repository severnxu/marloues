import type { WorkflowReadThreadResponse } from '../../../../shared/workflow-read-thread-contract'
import { WorkflowReadThreadTurnList } from './ReadThreadTurnList'

interface Props {
  readThread: WorkflowReadThreadResponse
  isStreaming?: boolean
  stateScopeKey?: string
  onCopyMessage?: (text: string) => void | Promise<void>
  onRegenerate?: () => void
  onDeleteMessage?: (id: string) => void
}

export function WorkflowThreadView({
  readThread,
  isStreaming = false,
  stateScopeKey,
  onCopyMessage,
  onRegenerate,
  onDeleteMessage,
}: Props) {
  return (
    <WorkflowReadThreadTurnList
      readThread={readThread}
      isStreaming={isStreaming}
      stateScopeKey={stateScopeKey}
      onCopyMessage={onCopyMessage}
      onRegenerate={onRegenerate}
      onDeleteMessage={onDeleteMessage}
    />
  )
}
