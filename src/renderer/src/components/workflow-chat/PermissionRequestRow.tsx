import { useState } from 'react'
import { ShieldQuestion } from 'lucide-react'
import type { WorkflowTurnItem as WorkflowStreamItem } from '../../../../shared/adapters/workflow-messages-to-read-thread'
import { WorkflowActivityRow, WorkflowActivityStatusBadge, WorkflowInlineDots } from './ActivityRow'
import { workflowStatusIsRunning } from './turn-collapse-rules'

type PermissionRequestItem = Extract<WorkflowStreamItem, { type: 'permissionRequest' }>

export function WorkflowPermissionRequestRow({ item }: { item: PermissionRequestItem }) {
  const [open, setOpen] = useState(false)
  const pending = workflowStatusIsRunning(item.status)
  const failed = item.status === 'failed' || item.status === 'error' || item.status === 'denied'

  return (
    <WorkflowActivityRow
      activityKind="permissionRequest"
      icon={<ShieldQuestion className="h-3.5 w-3.5" />}
      iconClassName={failed ? 'text-danger' : 'text-text-subtle'}
      label={(
        <>
          {pending ? '等待批准' : failed ? '已拒绝权限' : '已处理权限'}
          <span className="ml-1.5 text-text-subtle">{item.toolName}</span>
          {pending ? <WorkflowInlineDots /> : null}
          {pending || failed ? <WorkflowActivityStatusBadge failed={failed} /> : null}
        </>
      )}
      hasDetail={Boolean(item.reason || item.timeoutMs)}
      open={open}
      onToggle={() => setOpen(value => !value)}
      detail={(
        <div className="workflow-permission-card ml-[24px] mt-1.5">
          <div className="workflow-permission-card-title">Awaiting approval</div>
          <div className="workflow-permission-card-body">
            <div className="workflow-permission-tool">{item.toolName}</div>
            {item.reason ? <pre className="workflow-permission-reason">{formatReason(item.reason)}</pre> : null}
            {item.timeoutMs ? <div className="workflow-permission-timeout">Timeout {Math.round(item.timeoutMs / 1000)}s</div> : null}
          </div>
        </div>
      )}
    />
  )
}

function formatReason(reason: string): string {
  try {
    return JSON.stringify(JSON.parse(reason), null, 2)
  } catch {
    return reason
  }
}
