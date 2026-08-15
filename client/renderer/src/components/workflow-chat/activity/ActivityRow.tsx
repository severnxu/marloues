import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

interface WorkflowActivityRowProps {
  activityKind: string;
  icon: ReactNode;
  label: ReactNode;
  meta?: ReactNode;
  detail?: ReactNode;
  hasDetail?: boolean;
  open?: boolean;
  onToggle?: () => void;
  iconTone?: "muted" | "danger";
}

export function WorkflowActivityRow({
  activityKind,
  icon,
  label,
  meta,
  detail,
  hasDetail = Boolean(detail),
  open = false,
  onToggle,
  iconTone = "muted",
}: WorkflowActivityRowProps) {
  const interactive = Boolean(hasDetail && onToggle);
  const content = (
    <>
      <span className={`workflow-activity-row-icon is-${iconTone}`}>
        {icon}
      </span>
      <WorkflowActivityRowContent
        label={label}
        meta={meta}
        interactive={interactive}
      />
    </>
  );

  return (
    <div
      className="workflow-activity-row"
      data-kind="activity-row"
      data-activity-kind={activityKind}
      data-open={open ? "true" : "false"}
    >
      {interactive ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="workflow-activity-row-button"
        >
          {content}
        </button>
      ) : (
        <div className="workflow-activity-row-button is-static">{content}</div>
      )}
      {open && hasDetail ? (
        <div className="workflow-activity-detail">{detail}</div>
      ) : null}
    </div>
  );
}

export function WorkflowActivityRowContent({
  label,
  meta,
  interactive,
}: {
  label: ReactNode;
  meta?: ReactNode;
  interactive: boolean;
}) {
  return (
    <span className="workflow-activity-row-content">
      <span className="workflow-activity-row-label">{label}</span>
      <span className="workflow-activity-row-meta">{meta}</span>
      <span
        className={`workflow-activity-row-chevron ${interactive ? "" : "is-hidden"}`}
        aria-hidden="true"
      >
        <ChevronRight />
      </span>
    </span>
  );
}

export function WorkflowActivityStatusBadge({ failed }: { failed?: boolean }) {
  if (!failed) return null;
  return <span className="workflow-activity-status is-error">失败</span>;
}

export function WorkflowInlineDots() {
  return (
    <span className="workflow-activity-inline-dots" aria-label="进行中">
      <span />
      <span />
      <span />
    </span>
  );
}
