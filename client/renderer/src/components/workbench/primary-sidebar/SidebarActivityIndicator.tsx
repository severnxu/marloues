import { LoaderCircle } from "lucide-react";
import type { SidebarActivityStatus } from "./sidebar-activity";

export function SidebarActivityIndicator({
  status,
  className = "",
}: {
  status: SidebarActivityStatus;
  className?: string;
}) {
  if (!status) return null;

  const label =
    status === "unread" ? "有已完成但未查看的任务" : "有正在运行的任务";

  return (
    <span
      className={`sidebar-activity-indicator sidebar-activity--${status} ${className}`.trim()}
      role="status"
      aria-label={label}
      title={label}
    >
      {status === "unread" ? (
        <span className="sidebar-activity-dot" aria-hidden="true" />
      ) : (
        <LoaderCircle size={14} aria-hidden="true" />
      )}
    </span>
  );
}
