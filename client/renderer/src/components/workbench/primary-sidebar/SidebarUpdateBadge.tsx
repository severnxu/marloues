import { useCallback, useEffect } from "react";
import {
  AlertTriangle,
  Bell,
  Download,
  LoaderCircle,
  RefreshCcw,
} from "lucide-react";
import { useUpdateStore } from "@/stores/update-store";
import { notify } from "@/lib/notifications";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";
import { STRINGS } from "@shared/strings.zh";
import type { UpdateState } from "@shared/types";

interface SidebarUpdateBadgeProps {
  hasRunningTasks: boolean;
  onStopRunningTasks?: () => Promise<void>;
}

const promptedUpdateKeys = new Set<string>();

export function SidebarUpdateBadge({
  hasRunningTasks,
  onStopRunningTasks,
}: SidebarUpdateBadgeProps) {
  const state = useUpdateStore((s) => s.state);
  const isChecking = useUpdateStore((s) => s.isChecking);
  const isDownloading = useUpdateStore((s) => s.isDownloading);
  const download = useUpdateStore((s) => s.download);
  const installNow = useUpdateStore((s) => s.installNow);

  const status = state?.status ?? "idle";
  const { showConfirm, DialogComponent } = useConfirmDialog();

  const promptReadyUpdate = useCallback(async () => {
    if (state?.status !== "ready") return;

    const shouldStopTasks = hasRunningTasks;
    const confirmed = await showConfirm(
      readyUpdatePrompt(state.applyMode, shouldStopTasks),
    );
    if (!confirmed) return;

    if (shouldStopTasks) {
      if (!onStopRunningTasks) {
        notify({
          title: STRINGS.system.updateBadge.cannotStopTaskTitle,
          description: STRINGS.system.updateBadge.cannotStopTaskDescription,
          tone: "warning",
        });
        return;
      }
      await stopRunningTasksAndApplyUpdate(onStopRunningTasks, installNow);
      return;
    }

    await installNow();
  }, [hasRunningTasks, installNow, onStopRunningTasks, showConfirm, state]);

  useEffect(() => {
    if (state?.status !== "ready") return;

    const packageVersion = state.packageVersion ?? state.version;
    const promptKey = packageVersion
      ? `${state.applyMode ?? "unknown"}:${packageVersion}`
      : null;
    if (!promptKey || promptedUpdateKeys.has(promptKey)) return;

    promptedUpdateKeys.add(promptKey);
    void promptReadyUpdate();
  }, [promptReadyUpdate, state]);

  const handleBadgeClick = () => {
    if (status === "available") {
      void download();
      return;
    }

    if (status === "ready") {
      void promptReadyUpdate();
      return;
    }

    if (status === "error") {
      notify({
        title: STRINGS.system.updateBadge.updateFailedTitle,
        description: state?.error ?? STRINGS.mcp.errorUnknown,
        tone: "error",
      });
    }
  };

  const label = badgeLabel(status, isChecking, isDownloading, state?.applyMode);

  if (status === "idle") return null;

  return (
    <>
      <button
        type="button"
        className={`sidebar-update-badge sidebar-update-badge-${status}`}
        aria-label={label}
        title={label}
        data-testid={`sidebar-update-badge-${status}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          handleBadgeClick();
        }}
      >
        <BadgeContent
          status={status}
          isChecking={isChecking}
          isDownloading={isDownloading}
          percent={state?.progress?.percent ?? 0}
        />
      </button>
      {DialogComponent}
    </>
  );
}

export function readyUpdatePrompt(
  applyMode: UpdateState["applyMode"],
  hasRunningTasks: boolean,
): {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  variant: "warning" | "default";
} {
  if (hasRunningTasks) {
    return {
      title: "更新已准备好",
      message: `${updateActionDescription(applyMode)}已下载完成，但当前仍有任务运行。你可以稍后处理，或停止所有运行任务并立即更新。`,
      confirmLabel: "停止任务并更新",
      cancelLabel: "稍后",
      variant: "warning",
    };
  }

  if (applyMode === "reload-ui") {
    return {
      title: "更新已准备好",
      message: "界面更新已下载完成。立即更新会短暂刷新界面。",
      confirmLabel: "立即更新",
      cancelLabel: "稍后",
      variant: "default",
    };
  }
  return {
    title: "更新已准备好",
    message: "客户端更新已下载完成，将退出 Marloues 并启动安装程序。",
    confirmLabel: "立即安装",
    cancelLabel: "稍后",
    variant: "default",
  };
}

function updateActionDescription(applyMode: UpdateState["applyMode"]): string {
  if (applyMode === "reload-ui") return "界面更新";
  return "客户端更新";
}

interface BadgeContentProps {
  status: "idle" | "checking" | "available" | "downloading" | "ready" | "error";
  isChecking: boolean;
  isDownloading: boolean;
  percent: number;
}

export async function stopRunningTasksAndApplyUpdate(
  stopRunningTasks: () => Promise<void>,
  applyUpdate: () => Promise<void>,
): Promise<void> {
  await stopRunningTasks();
  await applyUpdate();
}

/** Compact progress ring used while an update package is downloading. */
function ProgressRing({ percent }: { percent: number }) {
  const SIZE = 20;
  const STROKE = 2;
  const RADIUS = (SIZE - STROKE) / 2;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  const safePercent = Math.max(0, Math.min(100, percent));
  const displayPercent = Math.min(99, Math.round(safePercent));
  const dashOffset = CIRCUMFERENCE * (1 - safePercent / 100);

  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="sidebar-update-progress-ring sidebar-update-progress-ring-download"
      aria-hidden="true"
    >
      <circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={RADIUS}
        stroke="currentColor"
        strokeOpacity={0.18}
        strokeWidth={STROKE}
        fill="none"
      />
      <circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={RADIUS}
        stroke="hsl(145 63% 55%)"
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeDasharray={CIRCUMFERENCE}
        strokeDashoffset={dashOffset}
        fill="none"
        transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        className="sidebar-update-progress-ring-fill"
      />
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        fontSize={7}
        fontWeight={600}
        fill="hsl(145 72% 40%)"
        className="sidebar-update-progress-ring-text"
        data-testid="ring-text"
      >
        {displayPercent}
      </text>
    </svg>
  );
}

function BadgeContent({
  status,
  isChecking,
  isDownloading,
  percent,
}: BadgeContentProps) {
  if (status === "downloading" || isDownloading || isChecking) {
    if (status === "downloading" || isDownloading) {
      return <ProgressRing percent={percent} />;
    }
    return (
      <LoaderCircle
        size={16}
        className="sidebar-update-icon-spinning"
        data-testid="spinner"
      />
    );
  }

  if (status === "ready") {
    return (
      <>
        <RefreshCcw size={14} />
        <span className="sidebar-update-ready-label">更新</span>
      </>
    );
  }

  if (status === "error") {
    return <AlertTriangle size={16} />;
  }

  if (status === "available") {
    return <Download size={16} />;
  }

  return <Bell size={16} aria-label="检查更新" />;
}

function badgeLabel(
  status: "idle" | "checking" | "available" | "downloading" | "ready" | "error",
  isChecking: boolean,
  isDownloading: boolean,
  applyMode: UpdateState["applyMode"],
): string {
  if (isChecking) return "正在检查更新";
  if (isDownloading || status === "downloading") return "正在下载更新";
  if (status === "available") return "下载可用更新";
  if (status === "ready") {
    if (applyMode === "reload-ui") return "应用界面更新";
    return "安装客户端更新";
  }
  if (status === "error") return "更新失败，点击查看原因";
  return "检查更新";
}
