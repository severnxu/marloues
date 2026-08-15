import { CircleCheck, CircleX, LoaderCircle, Square } from "lucide-react";
import type { ReactNode } from "react";

export type ToolDetailStatusKind = "running" | "failed" | "stopped" | "success";

export function ToolDetailFrame({
  title,
  statusKind,
  statusText,
  cancellable = false,
  isCancelling = false,
  onCancel,
  children,
}: {
  title: string;
  statusKind: ToolDetailStatusKind;
  statusText: string;
  cancellable?: boolean;
  isCancelling?: boolean;
  onCancel?: () => void;
  children: ReactNode;
}) {
  return (
    <section
      className="workflow-tool-detail workflow-activity-detail-surface"
      aria-label={`${title} 工具详情`}
    >
      <header className="workflow-tool-detail-header">
        <span className="workflow-tool-detail-title">{title}</span>
        <span className="workflow-tool-detail-controls">
          <ToolStatus kind={statusKind} text={statusText} />
          {cancellable && onCancel ? (
            <button
              type="button"
              className="workflow-tool-detail-cancel"
              disabled={isCancelling}
              onClick={(event) => {
                event.stopPropagation();
                onCancel();
              }}
            >
              <Square />
              <span>{isCancelling ? "正在取消" : "取消"}</span>
            </button>
          ) : null}
        </span>
      </header>
      <div className="workflow-tool-detail-body">{children}</div>
    </section>
  );
}

function ToolStatus({
  kind,
  text,
}: {
  kind: ToolDetailStatusKind;
  text: string;
}) {
  return (
    <span className={`workflow-tool-detail-status is-${kind}`}>
      {kind === "running" ? (
        <LoaderCircle />
      ) : kind === "failed" ? (
        <CircleX />
      ) : kind === "stopped" ? (
        <Square />
      ) : (
        <CircleCheck />
      )}
      <span>{text}</span>
    </span>
  );
}
