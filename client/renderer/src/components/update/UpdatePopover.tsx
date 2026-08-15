import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ClipboardCopy,
  Download,
  LoaderCircle,
  PackageOpen,
  RefreshCcw,
  X,
} from "lucide-react";
import type { UpdateState } from "@shared/types";
import { notify } from "@/lib/notifications";
import { STRINGS } from "@shared/strings.zh";
import { renderReleaseNotes } from "./release-notes";

interface UpdatePopoverProps {
  state: UpdateState;
  isChecking: boolean;
  isDownloading: boolean;
  hasRunningTasks: boolean;
  /** 弹层在外层 already mounted 时传入，用于定位 anchor */
  anchorRect: DOMRect | null;
  onClose: () => void;
  onCheck: () => void | Promise<void>;
  onDownload: () => void | Promise<void>;
  onInstallNow: () => void | Promise<void>;
  onCancelAutoInstall: () => void | Promise<void>;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let unitIndex = 0;
  let value = bytes;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unitIndex]}`;
}

function applyActionLabel(state: UpdateState): string {
  if (state.applyMode === "reload-ui") return "重载界面";
  return "安装并重启";
}

export function UpdatePopover({
  state,
  isChecking,
  isDownloading,
  hasRunningTasks,
  anchorRect,
  onClose,
  onCheck,
  onDownload,
  onInstallNow,
  onCancelAutoInstall,
}: UpdatePopoverProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [errorDetailOpen, setErrorDetailOpen] = useState(false);

  // 点击外部关闭
  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);

  // Esc 关闭
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  const popoverNode = (
    <div
      ref={containerRef}
      role="dialog"
      aria-label="更新详情"
      className={`sidebar-update-popover sidebar-update-popover-${state.status}`}
      style={anchorRect ? positionStyle(anchorRect) : undefined}
    >
      <header className="sidebar-update-popover-header">
        <span className="sidebar-update-popover-title">
          {state.status === "idle" && "检查更新"}
          {state.status === "available" && `新版本可用 · v${state.version}`}
          {state.status === "downloading" && `正在下载 v${state.version}`}
          {state.status === "ready" && `已下载 v${state.version}`}
          {state.status === "error" && "更新失败"}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="icon-button sidebar-update-popover-close"
          aria-label="关闭更新详情"
        >
          <X size={14} />
        </button>
      </header>

      {state.status === "available" ? (
        <div className="sidebar-update-popover-body">
          {state.releaseNotes ? (
            <div className="release-notes" data-testid="release-notes">
              {renderReleaseNotes(state.releaseNotes)}
            </div>
          ) : (
            <p className="sidebar-update-popover-hint">
              发布说明为空，但仍建议更新到最新版以获得 bug 修复。
            </p>
          )}
          <button
            type="button"
            className="primary"
            onClick={() => {
              void onDownload();
              onClose();
            }}
            data-testid="download-button"
          >
            <Download size={14} />
            立即下载
          </button>
        </div>
      ) : null}

      {state.status === "downloading" ? (
        <div className="sidebar-update-popover-body">
          <div className="sidebar-update-popover-progress">
            <span className="sidebar-update-popover-progress-percent">
              {state.progress?.percent ?? 0}%
            </span>
            <span className="sidebar-update-popover-progress-bytes">
              {formatBytes(state.progress?.transferred ?? 0)} /{" "}
              {formatBytes(state.progress?.total ?? 0)}
            </span>
          </div>
          <div
            className="sidebar-update-popover-progress-bar"
            role="progressbar"
            aria-valuenow={state.progress?.percent ?? 0}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="sidebar-update-popover-progress-bar-fill"
              style={{ width: `${state.progress?.percent ?? 0}%` }}
            />
          </div>
          <p className="sidebar-update-popover-hint">
            下载期间可继续使用 Marloues。
          </p>
        </div>
      ) : null}

      {state.status === "ready" ? (
        <div className="sidebar-update-popover-body">
          <p className="sidebar-update-popover-hint">
            {state.applyMode === "reload-ui"
              ? "界面包已就绪，应用后无需运行安装器。"
              : "客户端更新已就绪，将通过安装器完成更新。"}
          </p>
          <div className="sidebar-update-popover-actions">
            <button
              type="button"
              className="primary"
              data-testid="install-now-button"
              onClick={async () => {
                if (hasRunningTasks) {
                  const confirmed = window.confirm(
                    "仍有任务在执行，立即更新会退出 Marloues。确定现在更新吗？",
                  );
                  if (!confirmed) return;
                }
                await onInstallNow();
                onClose();
              }}
            >
              <RefreshCcw size={14} />
              {applyActionLabel(state)}
            </button>
            <button
              type="button"
              data-testid="cancel-auto-install-button"
              onClick={async () => {
                await onCancelAutoInstall();
                notify({
                  title: STRINGS.system.update.autoRestartPausedTitle,
                  description:
                    STRINGS.system.update.autoRestartPausedDescription,
                  tone: "info",
                });
                onClose();
              }}
            >
              稍后再说
            </button>
          </div>
        </div>
      ) : null}

      {state.status === "error" ? (
        <div className="sidebar-update-popover-body">
          <p className="sidebar-update-popover-error-msg">
            <AlertTriangle size={14} />
            {state.error ?? "更新失败"}
          </p>
          {state.errorCode ? (
            <p className="sidebar-update-popover-hint">
              错误类型：<code>{state.errorCode}</code>
            </p>
          ) : null}
          {state.errorDetail ? (
            <details
              className="sidebar-update-popover-error-detail"
              open={errorDetailOpen}
              onToggle={(e) =>
                setErrorDetailOpen((e.target as HTMLDetailsElement).open)
              }
            >
              <summary>
                <ChevronDown
                  size={12}
                  className={`sidebar-update-popover-chevron ${
                    errorDetailOpen ? "open" : ""
                  }`}
                />
                详细信息
              </summary>
              <pre data-testid="error-detail">{state.errorDetail}</pre>
              <button
                type="button"
                className="icon-button sidebar-update-popover-copy-error"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      state.errorDetail ?? "",
                    );
                    notify({
                      title: STRINGS.system.update.errorDetailsCopied,
                      tone: "success",
                    });
                  } catch {
                    notify({
                      title: STRINGS.system.update.copyFailed,
                      tone: "error",
                    });
                  }
                }}
              >
                <ClipboardCopy size={12} />
                复制
              </button>
            </details>
          ) : null}
          <div className="sidebar-update-popover-actions">
            <button
              type="button"
              className="primary"
              data-testid="retry-button"
              onClick={async () => {
                await onCheck();
                onClose();
              }}
            >
              <RefreshCcw size={14} />
              重试检查
            </button>
            <button
              type="button"
              onClick={async () => {
                await onCheck();
              }}
            >
              <LoaderCircle
                size={14}
                className={
                  isChecking || isDownloading
                    ? "sidebar-update-icon-spinning"
                    : ""
                }
              />
              检查更新
            </button>
          </div>
        </div>
      ) : null}

      {state.status === "idle" ? (
        <div className="sidebar-update-popover-body">
          <p className="sidebar-update-popover-hint">
            当前已是最新版本。可手动重新检查更新源。
          </p>
          <button
            type="button"
            className="primary"
            data-testid="manual-check-button"
            onClick={async () => {
              await onCheck();
            }}
          >
            <PackageOpen size={14} />
            {isChecking ? "正在检查…" : "检查更新"}
          </button>
        </div>
      ) : null}

      <footer className="sidebar-update-popover-footer">
        {state.packageVersion ? (
          <span>
            <Check size={12} /> 包版本：<code>{state.packageVersion}</code>
          </span>
        ) : null}
        <span>v{state.version ?? "未知"}</span>
      </footer>
    </div>
  );

  return createPortal(popoverNode, document.body);
}

function positionStyle(rect: DOMRect): CSSProperties {
  // 让 popover 出现在 anchor 的右侧外部（垂直对齐 anchor 中点），并预留 8px 间距；
  // 如果右侧空间不足则落到左侧。
  const POPOVER_WIDTH = 360;
  const MARGIN = 8;
  let left = rect.right + MARGIN;
  if (
    typeof window !== "undefined" &&
    left + POPOVER_WIDTH > window.innerWidth - 16
  ) {
    left = Math.max(16, rect.left - POPOVER_WIDTH - MARGIN);
  }
  const top = Math.max(
    16,
    Math.min(
      rect.top + rect.height / 2 - 80,
      // keep popover inside viewport
      typeof window !== "undefined" ? window.innerHeight - 320 : rect.top,
    ),
  );
  return {
    position: "fixed",
    left,
    top,
    width: POPOVER_WIDTH,
    zIndex: 100,
  };
}

// CSSProperties imported below to avoid a top-level type import order issue
import type { CSSProperties } from "react";
