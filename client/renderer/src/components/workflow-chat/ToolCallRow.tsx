import { useState } from 'react'
import type { WorkflowTurnItem as WorkflowStreamItem } from '../../../../shared/adapters/workflow-messages-to-read-thread'
import { itemInputText, itemOutputText } from './item-text'
import { WorkflowActivityRow, WorkflowActivityStatusBadge, WorkflowInlineDots } from './ActivityRow'
import { ToolDetail, ToolIcon, itemStatus, toolLabel } from './ToolCallRowDetails'
import { workflowStatusIsRunning } from './turn-collapse-rules'

type ToolCallRowItem = Extract<WorkflowStreamItem, {
  type: 'plan' | 'mcpToolCall' | 'dynamicToolCall' | 'webSearch' | 'imageGeneration'
}>
interface Props {
  item: ToolCallRowItem
}

export function WorkflowToolCallRow({ item }: Props) {
  const [open, setOpen] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const input = itemInputText(item)
  const output = itemOutputText(item)
  const status = itemStatus(item)
  const running = workflowStatusIsRunning(status)
  const cancellable = running
  const hasDetail = Boolean(input || output || cancellable)
  const failed = status === 'error' || status === 'failed'
  const handleCancelTool = async () => {
    if (isCancelling) return
    setIsCancelling(true)
    try {
      await window.marloues.chat.cancelTool(item.id)
    } catch (error) {
      console.error('Failed to cancel tool', error)
      setIsCancelling(false)
    }
  }

  return (
    <WorkflowActivityRow
      activityKind={item.type}
      icon={<ToolIcon item={item} />}
      label={(
        <>
          {toolLabel(item)}
          {running ? <WorkflowInlineDots /> : null}
          {running || failed ? <WorkflowActivityStatusBadge failed={failed} /> : null}
        </>
      )}
      detail={
        <div className="ml-[25px] mt-1">
          <ToolDetail
            item={item}
            failed={failed}
            cancellable={cancellable}
            isCancelling={isCancelling}
            onCancel={handleCancelTool}
          />
        </div>
      }
      hasDetail={hasDetail}
      open={open}
      onToggle={() => setOpen(value => !value)}
    />
  )
}

