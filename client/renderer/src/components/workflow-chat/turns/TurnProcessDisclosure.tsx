import { ChevronRight, ListChecks } from "lucide-react";
import type { ReactNode } from "react";

export function WorkflowTurnProcessDisclosure({
  duration,
  expanded,
  hasActivityItems,
  stepCount,
  onToggle,
}: {
  duration: ReactNode;
  expanded: boolean;
  hasActivityItems: boolean;
  stepCount: number;
  onToggle: () => void;
}) {
  const content = (
    <>
      <ListChecks size={14} aria-hidden="true" />
      <span>{stepCount > 0 ? `已处理 ${stepCount} 个步骤` : "已完成"}</span>
      {duration ? <small>{duration}</small> : null}
      {hasActivityItems ? (
        <ChevronRight
          className="workflow-process-disclosure-chevron"
          size={14}
          aria-hidden="true"
        />
      ) : null}
    </>
  );

  return hasActivityItems ? (
    <button
      type="button"
      className="workflow-process-disclosure"
      aria-expanded={expanded}
      onClick={onToggle}
    >
      {content}
    </button>
  ) : (
    <div className="workflow-process-disclosure is-static">{content}</div>
  );
}
