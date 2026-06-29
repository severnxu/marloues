import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'

interface WorkflowActivityRowProps {
  activityKind: string
  icon: ReactNode
  label: ReactNode
  detail?: ReactNode
  hasDetail?: boolean
  open?: boolean
  onToggle?: () => void
  iconClassName?: string
}

export function WorkflowActivityRow({
  activityKind,
  icon,
  label,
  detail,
  hasDetail = Boolean(detail),
  open = false,
  onToggle,
  iconClassName = 'text-text-subtle',
}: WorkflowActivityRowProps) {
  const interactive = Boolean(hasDetail && onToggle)

  return (
    <div className="workflow-activity-row text-[12px] leading-5 text-text-muted" data-kind="activity-row" data-activity-kind={activityKind}>
      <button
        type="button"
        onClick={() => interactive && onToggle?.()}
        aria-expanded={interactive ? open : undefined}
        className={`workflow-activity-row-button flex min-h-6 w-full max-w-full items-center gap-2 rounded text-left transition ${
          interactive ? 'cursor-pointer hover:text-text-normal' : 'cursor-default'
        }`}
      >
        <span className={`grid h-4 w-4 place-items-center ${iconClassName}`}>
          {icon}
        </span>
        <WorkflowActivityRowContent label={label} interactive={interactive} open={open} />
      </button>
      {open && hasDetail ? detail : null}
    </div>
  )
}

export function WorkflowActivityRowContent({
  label,
  interactive,
  open,
}: {
  label: ReactNode
  interactive: boolean
  open: boolean
}) {
  return (
    <span className="workflow-activity-row-content">
      <span className="workflow-activity-row-label">{label}</span>
      <span className="workflow-activity-row-chevron" aria-hidden="true">
        <ChevronDown className={`h-3.5 w-3.5 text-text-subtle transition-transform ${interactive ? '' : 'opacity-0'} ${open ? '' : '-rotate-90'}`} />
      </span>
    </span>
  )
}

export function WorkflowActivityStatusBadge({ failed }: { failed?: boolean }) {
  if (!failed) return null
  return <span className="ml-2 text-[11px] text-danger">失败</span>
}

export function WorkflowInlineDots() {
  return (
    <span className="ml-0.5 inline-flex translate-y-[-1px] gap-[3px] align-middle">
      <span className="h-1 w-1 rounded-full bg-current opacity-40 animate-typing-dot-1" />
      <span className="h-1 w-1 rounded-full bg-current opacity-40 animate-typing-dot-2" />
      <span className="h-1 w-1 rounded-full bg-current opacity-40 animate-typing-dot-3" />
    </span>
  )
}
