import type { CSSProperties } from "react";
import {
  ArrowLeft,
  Columns2,
  Minimize2,
  Minus,
  PanelLeft,
  PanelRight,
  Search,
  Square,
  SquarePen,
  X,
} from "lucide-react";
import {
  SidebarActivityIndicator,
  resolveCollapsedSidebarToggleActivity,
} from "./primary-sidebar";
import { useUnifiedChatStore } from "@/stores/unified-chat-store";
import type { ThemeMode } from "@/stores/theme-store";
import type { AuxiliaryMode } from "./layout-model";
import type { Page } from "./types";
import { PRODUCT_NAME } from "@/lib/product-brand";
import { MonkeyMark } from "@/components/brand/MonkeyMark";

export function WindowChrome({
  sidebarOpen,
  sidebarPeeking = false,
  page,
  isDark: _isDark,
  themeMode: _themeMode,
  onPage,
  globalSearchOpen,
  onOpenSearch,
  onToggleSidebar,
  onSidebarTogglePointerEnter,
  onSidebarTogglePointerLeave,
  onToggleTheme: _onToggleTheme,
  auxiliaryOpen = false,
  onToggleAuxiliary,
  onReturnToMain,
  auxiliaryMode = "closed",
  auxiliarySwitching = false,
  titleExtrasHidden = false,
  isMacOS = false,
  onDoubleClickTitleBar,
  style,
}: {
  sidebarOpen: boolean;
  sidebarPeeking?: boolean;
  page: Page;
  isDark: boolean;
  themeMode: ThemeMode;
  onPage: (page: Page) => void;
  globalSearchOpen: boolean;
  onOpenSearch: () => void;
  onToggleSidebar: () => void;
  onSidebarTogglePointerEnter?: () => void;
  onSidebarTogglePointerLeave?: () => void;
  onToggleTheme: () => void;
  auxiliaryOpen?: boolean;
  onToggleAuxiliary: () => void;
  /** Leave primary-overlay while keeping the standard auxiliary column open. */
  onReturnToMain?: () => void;
  /** Current auxiliary mode — needed to decide which trailing slot to
   *  populate on Windows. */
  auxiliaryMode?: AuxiliaryMode;
  auxiliarySwitching?: boolean;
  titleExtrasHidden?: boolean;
  isMacOS?: boolean;
  onDoubleClickTitleBar?: () => void;
  style?: CSSProperties;
}) {
  const createSession = useUnifiedChatStore((s) => s.createSession);
  const hasUnreadCompletion = useUnifiedChatStore(
    (s) => s.unreadCompletedSessionIds.size > 0,
  );
  const collapsedSidebarActivity =
    !sidebarOpen && !sidebarPeeking
      ? resolveCollapsedSidebarToggleActivity(hasUnreadCompletion)
      : null;
  const showCollapsedActions = !titleExtrasHidden && !sidebarOpen;
  const showProductLockup =
    !titleExtrasHidden && (sidebarOpen || sidebarPeeking);
  const auxiliaryPrimary = auxiliaryMode === "primary-overlay";
  const showReturnToMain = auxiliaryPrimary && !sidebarOpen && onReturnToMain;
  const auxiliaryToggleLabel = auxiliaryPrimary
    ? "关闭辅助区并返回主视图"
    : auxiliaryOpen
      ? "收起右侧辅助区"
      : "展开右侧辅助区";

  return (
    <header
      className="title-bar window-chrome"
      style={style}
      onDoubleClick={onDoubleClickTitleBar}
    >
      <div className="title-left window-chrome-leading">
        <button
          type="button"
          className="title-sidebar-toggle window-chrome-control"
          onClick={onToggleSidebar}
          onPointerEnter={onSidebarTogglePointerEnter}
          onPointerLeave={onSidebarTogglePointerLeave}
          title={sidebarOpen ? "收起左侧边栏" : "展开左侧边栏"}
          aria-label="切换左侧边栏"
        >
          {sidebarOpen ? <Columns2 size={16} /> : <PanelLeft size={16} />}
          <SidebarActivityIndicator
            status={collapsedSidebarActivity}
            className="title-sidebar-activity"
          />
        </button>
        {showReturnToMain ? (
          <button
            type="button"
            className="title-return-main window-chrome-control"
            onClick={onReturnToMain}
            disabled={auxiliarySwitching}
            title="返回主视图"
            aria-label="返回主视图"
          >
            <ArrowLeft size={16} />
          </button>
        ) : null}
        {showCollapsedActions ? (
          <button
            type="button"
            className="title-new-session window-chrome-control"
            onClick={() => {
              void createSession();
              onPage("chat");
            }}
            title="新建会话"
            aria-label="新建会话"
          >
            <SquarePen size={16} />
          </button>
        ) : null}
        {showProductLockup ? (
          <>
            <span
              className="title-product-lockup window-product-lockup"
              aria-hidden="true"
            >
              <span className="title-product-mark">
                <MonkeyMark size={18} />
              </span>
              <span className="title-product-name">{PRODUCT_NAME}</span>
            </span>
            <button
              type="button"
              className="title-global-search window-chrome-control"
              onClick={onOpenSearch}
              aria-haspopup="dialog"
              aria-expanded={globalSearchOpen}
              aria-label="全局搜索"
              title={`全局搜索 (${isMacOS ? "⌘K" : "Ctrl+K"})`}
            >
              <Search size={15} />
            </button>
          </>
        ) : null}
      </div>
      {isMacOS ? null : (
        <div className="title-right window-chrome-trailing">
          <div className="window-actions window-caption-controls">
            <button
              type="button"
              onClick={() => window.marloues.window.minimize()}
              aria-label="最小化"
            >
              <Minus size={14} />
            </button>
            <button
              type="button"
              onClick={() => window.marloues.window.maximize()}
              aria-label="最大化"
            >
              <Square size={12} />
            </button>
            <button
              type="button"
              className="is-close"
              onClick={() => window.marloues.window.close()}
              aria-label="关闭"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}
      {page === "chat" ? (
        <div className="titlebar-context-actions">
          {!isMacOS && auxiliaryPrimary && onReturnToMain ? (
            <button
              className="windows-auxiliary-primary-action window-chrome-control"
              type="button"
              onClick={onReturnToMain}
              disabled={auxiliarySwitching}
              title="收回辅助区至右栏"
              aria-label="收回辅助区至右栏"
              aria-pressed="true"
            >
              <Minimize2 size={15} />
            </button>
          ) : null}
          <div
            id="thread-summary-titlebar-slot"
            className="thread-summary-titlebar-slot"
          />
          <button
            className={`thread-inspector-toggle window-chrome-control${auxiliaryOpen ? " is-active" : ""}`}
            type="button"
            onClick={onToggleAuxiliary}
            disabled={auxiliarySwitching}
            title={auxiliaryToggleLabel}
            aria-label={auxiliaryToggleLabel}
            aria-pressed={auxiliaryOpen}
          >
            {auxiliaryOpen ? <Columns2 size={15} /> : <PanelRight size={15} />}
          </button>
        </div>
      ) : null}
    </header>
  );
}
