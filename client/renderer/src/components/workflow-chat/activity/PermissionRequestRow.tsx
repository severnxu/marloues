import { useState } from "react";
import { ShieldQuestion } from "lucide-react";
import type { WorkflowTurnItem } from "../../../../../shared/adapters/workflow-messages-to-read-thread";
import {
  WorkflowActivityRow,
  WorkflowActivityStatusBadge,
  WorkflowInlineDots,
} from "./ActivityRow";
import { workflowStatusIsRunning } from "../";

type PermissionRequestItem = Extract<
  WorkflowTurnItem,
  { type: "permissionRequest" }
>;

export function WorkflowPermissionRequestRow({
  item,
}: {
  item: PermissionRequestItem;
}) {
  const [open, setOpen] = useState(false);
  const pending = workflowStatusIsRunning(item.status);
  const timedOut = item.status === "timed_out";
  const cancelled = item.status === "cancelled";
  const failed =
    item.status === "failed" ||
    item.status === "error" ||
    item.status === "denied";
  const statusLabel = pending
    ? "等待批准"
    : timedOut
      ? "审批超时"
      : cancelled
        ? "已取消"
        : failed
          ? "已拒绝权限"
          : "已处理权限";
  const detailTitle = pending
    ? "Awaiting approval"
    : timedOut
      ? "Approval timed out"
      : cancelled
        ? "Approval cancelled"
        : failed
          ? "Permission denied"
          : "Permission resolved";

  return (
    <WorkflowActivityRow
      activityKind="permissionRequest"
      icon={<ShieldQuestion />}
      iconTone={failed || timedOut ? "danger" : "muted"}
      label={
        <>
          {statusLabel}
          {pending ? <WorkflowInlineDots /> : null}
          {pending || failed || timedOut || cancelled ? (
            <WorkflowActivityStatusBadge failed={failed || timedOut} />
          ) : null}
        </>
      }
      meta={item.toolName}
      hasDetail={Boolean(item.reason || item.timeoutMs)}
      open={open}
      onToggle={() => setOpen((value) => !value)}
      detail={
        <div className="workflow-permission-card workflow-activity-detail-surface">
          <div className="workflow-permission-card-title">{detailTitle}</div>
          <div className="workflow-permission-card-body">
            <div className="workflow-permission-tool">{item.toolName}</div>
            {item.reason ? (
              <pre className="workflow-permission-reason">
                {formatReason(item.reason)}
              </pre>
            ) : null}
            {item.timeoutMs ? (
              <div className="workflow-permission-timeout">
                Timeout {Math.round(item.timeoutMs / 1000)}s
              </div>
            ) : null}
          </div>
        </div>
      }
    />
  );
}

function formatReason(reason: string): string {
  try {
    return JSON.stringify(JSON.parse(reason), null, 2);
  } catch {
    return reason;
  }
}
