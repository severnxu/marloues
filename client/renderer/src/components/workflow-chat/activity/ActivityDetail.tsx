import type { ReactNode } from "react";

export function WorkflowActivityDetailStack({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="workflow-activity-detail-stack workflow-activity-detail-surface">
      {children}
    </div>
  );
}

export function WorkflowActivityDetailBlock({
  label,
  value,
  tone = "muted",
}: {
  label: string;
  value: string;
  tone?: "normal" | "muted" | "danger";
}) {
  return (
    <section className="workflow-activity-detail-block">
      <div className="workflow-activity-detail-label">{label}</div>
      <pre className={`workflow-activity-detail-value is-${tone}`}>{value}</pre>
    </section>
  );
}
