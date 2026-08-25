import { LoaderCircle, ShieldAlert, ShieldCheck } from "lucide-react";

export type SandboxGatePhase =
  "checking" | "prompt" | "installing" | "success" | "cancelled" | "error";

interface SandboxGatePromptProps {
  phase: SandboxGatePhase;
  message?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Contextual confirmation shown before switching to an unsafe sandbox mode.
 */
export function SandboxGatePrompt({
  phase,
  message,
  onConfirm,
  onCancel,
}: SandboxGatePromptProps) {
  const isBusy = phase === "checking" || phase === "installing";
  const isCancelled = phase === "cancelled";
  const isError = phase === "error";
  const isSuccess = phase === "success";
  const showActions = !isBusy && !isSuccess;
  const confirmLabel = phase === "prompt" ? "确认关闭" : "重试";

  const Icon =
    isError || isCancelled
      ? ShieldAlert
      : isSuccess
        ? ShieldCheck
        : ShieldAlert;

  const text = isSuccess
    ? "沙箱模式已更新"
    : isCancelled
      ? "已取消切换"
      : isError
        ? (message ?? "切换失败，请重试")
        : phase === "installing"
          ? "正在切换沙箱模式..."
          : phase === "checking"
            ? "正在检查沙箱状态..."
            : (message ?? "关闭沙箱后，命令将不再受进程隔离保护。");

  return (
    <div className="sandbox-gate-prompt">
      <Icon size={15} className="sandbox-gate-icon" />
      <span className="sandbox-gate-text">{text}</span>
      {isBusy ? (
        <LoaderCircle size={14} className="sandbox-gate-spinner animate-spin" />
      ) : showActions ? (
        <div className="sandbox-gate-actions">
          <button
            type="button"
            className="sandbox-gate-confirm"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
          <button
            type="button"
            className="sandbox-gate-cancel"
            onClick={onCancel}
          >
            取消
          </button>
        </div>
      ) : null}
    </div>
  );
}
