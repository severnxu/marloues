import { useState } from 'react'
import { Brain } from 'lucide-react'
import type { WorkflowTurnItem as WorkflowStreamItem } from '../../../../shared/adapters/workflow-messages-to-read-thread'
import { WorkflowActivityRow } from './ActivityRow'

type ReasoningItemModel = Extract<WorkflowStreamItem, { type: 'reasoning' }>

interface Props {
  item: ReasoningItemModel
}

export function WorkflowReasoningRow({ item }: Props) {
  const [open, setOpen] = useState(false)
  const text = item.content?.map(part => part.text).filter(Boolean).join('\n\n') || item.summary
  const hasDetail = Boolean(text)
  const label = item.encrypted && !text ? '思考内容已隐藏' : item.summary?.trim() ? '思考' : '正在思考'

  return (
    <WorkflowActivityRow
      activityKind="reasoning"
      icon={<Brain className="h-3.5 w-3.5" />}
      label={label}
      hasDetail={hasDetail}
      open={open}
      onToggle={() => setOpen(value => !value)}
      detail={(
        <div className="workflow-reasoning-card ml-[24px] mt-1.5">
          <div className="workflow-reasoning-card-title">Reasoning</div>
          <pre className="workflow-reasoning-card-body">{text}</pre>
        </div>
      )}
    />
  )
}
