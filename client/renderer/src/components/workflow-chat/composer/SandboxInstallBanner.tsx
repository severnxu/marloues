import { LoaderCircle, Shield, ShieldAlert, ShieldCheck } from "lucide-react";

export type SandboxGatePhase =
  "checking" | "prompt" | "installing" | "success" | "cancelled" | "error";

interface SandboxGatePromptProps {
  phase: SandboxGatePhase;
  message?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Contextual inline prompt shown inside the composer when the Windows sandbox
 * is not ready. Sandboxing is an always-on environment for command execution
 * (matching the macOS/Linux behavior), not a "full access" extra — the gate
 * here exists because "full access" leans on it the most.
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
  const confirmLabel = phase === "prompt" ? "同意安装" : "重试安装";

  const Icon =
    isError || isCancelled ? ShieldAlert : isSuccess ? ShieldCheck : Shield;

  const text = isSuccess
    ? "沙箱已就绪，命令将在隔离环境中执行"
    : isCancelled
      ? "已取消 UAC 授权，沙箱未安装，命令将不受隔离保护"
      : isError
        ? (message ?? "安装失败，请重试")
        : phase === "installing"
          ? "正在安装 Windows 沙箱，请在 UAC 弹窗中允许..."
          : phase === "checking"
            ? "正在检查沙箱状态..."
            : "沙箱是命令隔离的常驻环境。当前未就绪，建议立即安装以保护命令执行。";

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
