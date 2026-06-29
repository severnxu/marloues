import { useState } from 'react'
import { Wrench } from 'lucide-react'
import type { WorkflowTurnItem as WorkflowStreamItem } from '../../../../shared/adapters/workflow-messages-to-read-thread'
import { WorkflowActivityRow, WorkflowInlineDots } from './ActivityRow'
import { workflowStatusIsRunning } from './turn-collapse-rules'

type CollabAgentItemModel = Extract<WorkflowStreamItem, { type: 'collabAgentToolCall' }>

interface Props {
  item: CollabAgentItemModel
}

export function WorkflowCollabAgentToolRow({ item }: Props) {
  const [open, setOpen] = useState(false)
  const hasDetail = Boolean(item.prompt || item.model || item.reasoningEffort || item.receiverThreadIds?.length || item.senderThreadId)
  const running = workflowStatusIsRunning(item.status)

  return (
    <WorkflowActivityRow
      activityKind="collabAgentToolCall"
      icon={<Wrench className="h-3.5 w-3.5" />}
      label={(
        <>
          {running ? '正在使用协作代理' : '已使用协作代理'}
          {item.receiverThreadIds?.length ? <span className="ml-1.5 text-text-subtle">{item.receiverThreadIds.length} 个线程</span> : null}
          {running ? <WorkflowInlineDots /> : null}
        </>
      )}
      hasDetail={hasDetail}
      open={open}
      onToggle={() => setOpen(value => !value)}
      detail={(
        <div className="ml-[24px] mt-1">
          <CollabAgentDetail item={item} />
        </div>
      )}
    />
  )
}

function CollabAgentDetail({ item }: { item: CollabAgentItemModel }) {
  return (
    <div className="space-y-1">
      {item.tool || item.model ? (
        <div className="flex min-h-5 items-center gap-2 font-mono text-[10px] text-text-subtle">
          <span className="min-w-0 flex-1 truncate">{item.tool || 'collab_agent'}</span>
          {item.model ? <span>{item.model}</span> : null}
        </div>
      ) : null}
      {item.prompt ? <DetailBlock label="Prompt" value={item.prompt} muted /> : null}
      {item.senderThreadId ? <DetailPill label="Sender" value={item.senderThreadId} /> : null}
      {item.receiverThreadIds?.length ? <DetailPill label="Receivers" value={item.receiverThreadIds.join(', ')} /> : null}
      {item.reasoningEffort ? <DetailPill label="Reasoning" value={item.reasoningEffort} /> : null}
    </div>
  )
}

function DetailBlock({ label, value, muted, danger }: { label: string; value: string; muted?: boolean; danger?: boolean }) {
  return (
    <div className="border-b border-line last:border-b-0">
      <div className="px-0 pt-1 text-[10px] font-medium uppercase tracking-wide text-text-subtle">{label}</div>
      <pre className={`m-0 max-h-52 overflow-auto pb-2 pt-1 font-mono text-[11px] leading-5 whitespace-pre-wrap ${
        danger ? 'text-danger' : muted ? 'text-text-muted' : 'text-text-normal'
      }`}>
        {value}
      </pre>
    </div>
  )
}

function DetailPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-line pb-2 last:border-b-0">
      <div className="text-[10px] font-medium uppercase tracking-wide text-text-subtle">{label}</div>
      <div className="mt-1 break-words font-mono text-[11px] leading-5 text-text-muted">{value}</div>
    </div>
  )
}
