import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Columns2,
  Copy,
  Minimize2,
  Minus,
  PanelLeft,
  PanelRight,
  Square,
  SquarePen,
  X,
} from "lucide-react";
import { GlobalSearchOverlay } from "@/components/layout/GlobalSearchOverlay";
import type { Page, SettingsSection } from "@/components/layout/types";
import type { AuxiliaryMode, WorkbenchPlatform } from "./layout-model";
import { RuntimeStatus } from "./RuntimeStatus";

export function WindowChrome({
  platform,
  primaryOpen,
  primaryPeeking,
  auxiliaryMode,
  isRunning,
  searchOpen,
  page,
  onPage,
  onOpenSettings,
  onTogglePrimary,
  onNewThread,
  onToggleAuxiliary,
  onReturnToMain,
  onToggleAuxiliaryPrimary,
  onCloseSearch,
  onPrimaryPointerEnter,
  onPrimaryPointerLeave,
}: {
  platform: WorkbenchPlatform;
  primaryOpen: boolean;
  primaryPeeking: boolean;
  auxiliaryMode: AuxiliaryMode;
  isRunning: boolean;
  searchOpen: boolean;
  page: Page;
  onPage: (page: Page) => void;
  onOpenSettings: (section?: SettingsSection) => void;
  onTogglePrimary: () => void;
  onNewThread: () => void;
  onToggleAuxiliary: () => void;
  onReturnToMain: () => void;
  onToggleAuxiliaryPrimary: () => void;
  onCloseSearch: () => void;
  onPrimaryPointerEnter: () => void;
  onPrimaryPointerLeave: () => void;
}) {
  const [isMaximized, setIsMaximized] = useState(false);
  const auxiliaryOpen = auxiliaryMode !== "closed";
  const auxiliaryPrimary = auxiliaryMode === "primary-overlay";

  useEffect(() => {
    if (platform !== "windows") return;

    let active = true;
    void window.marloues.window.isMaximized().then((value) => {
      if (active) setIsMaximized(value);
    });
    const unsubscribe =
      window.marloues.window.onMaximizedChanged(setIsMaximized);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [platform]);

  return (
    <header
      className="title-bar window-chrome"
      data-platform={platform}
      data-auxiliary-open={auxiliaryOpen}
      data-current-view={auxiliaryPrimary ? "auxiliary" : "main"}
    >
      <div className="window-chrome-leading">
        <button
          type="button"
          className="window-chrome-control"
          onClick={onTogglePrimary}
          onPointerEnter={onPrimaryPointerEnter}
          onPointerLeave={onPrimaryPointerLeave}
          aria-label={primaryOpen ? "收起左侧边栏" : "展开左侧边栏"}
        >
          {primaryOpen ? <Columns2 size={16} /> : <PanelLeft size={16} />}
        </button>
        {!primaryOpen && !primaryPeeking && auxiliaryPrimary ? (
          <button
            type="button"
            className="window-chrome-control"
            onClick={onReturnToMain}
            aria-label="返回主视图"
          >
            <ArrowLeft size={16} />
          </button>
        ) : !primaryOpen && !primaryPeeking && page === "chat" ? (
          <button
            type="button"
            className="window-chrome-control"
            onClick={onNewThread}
            aria-label="新建会话"
          >
            <SquarePen size={16} />
          </button>
        ) : null}
        {primaryOpen || primaryPeeking ? (
          <span className="window-product-lockup" aria-hidden="true">
            <span>M</span>
            <strong>Marloues</strong>
          </span>
        ) : null}
      </div>

      <div className="window-chrome-trailing">
        <div className="window-chrome-actions">
          {platform === "windows" && !auxiliaryPrimary ? (
            <RuntimeStatus isRunning={isRunning} />
          ) : null}
          {platform === "windows" && auxiliaryPrimary ? (
            <button
              type="button"
              className="window-chrome-control auxiliary-primary-contract"
              onClick={onToggleAuxiliaryPrimary}
              aria-label="收回辅助区至右栏"
              title="收回辅助区至右栏"
            >
              <Minimize2 size={15} />
            </button>
          ) : null}
          <button
            type="button"
            className={`window-chrome-control ${auxiliaryOpen ? "is-active" : ""}`}
            onClick={onToggleAuxiliary}
            aria-label={
              auxiliaryPrimary
                ? "关闭辅助区并返回主视图"
                : auxiliaryOpen
                  ? "收起右侧辅助区"
                  : "展开右侧辅助区"
            }
          >
            <PanelRight size={16} />
          </button>
        </div>
        {platform === "windows" ? (
          <div className="window-caption-controls">
            <button
              type="button"
              onClick={() => window.marloues.window.minimize()}
              aria-label="最小化窗口"
            >
              <Minus size={14} />
            </button>
            <button
              type="button"
              onClick={() => window.marloues.window.maximize()}
              aria-label={isMaximized ? "还原窗口" : "最大化窗口"}
              title={isMaximized ? "还原" : "最大化"}
            >
              {isMaximized ? <Copy size={12} /> : <Square size={12} />}
            </button>
            <button
              type="button"
              className="is-close"
              onClick={() => window.marloues.window.close()}
              aria-label="关闭窗口"
            >
              <X size={14} />
            </button>
          </div>
        ) : null}
      </div>

      <GlobalSearchOverlay
        open={searchOpen}
        onClose={onCloseSearch}
        onPage={onPage}
        onOpenSettings={onOpenSettings}
      />
    </header>
  );
}
