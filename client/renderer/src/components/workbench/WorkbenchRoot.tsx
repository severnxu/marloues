// WorkbenchRoot is the application-shell composition root. Its concerns are
// split across:
//   - layout-model.ts (state/types/reducer)
//   - use-workbench-layout.ts (reducer + pointer/resize)
//   - use-workbench-transitions.ts (region transitions)
//   - WindowChrome.tsx (title bar + window controls)
//   - WorkbenchRegions.tsx (3 structural shells)
//   - WorkbenchViewHost.tsx (page routing)

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { PluginsView, type PluginsTab } from "@/pages/PluginsPage";
import { SchedulePage } from "@/pages/SchedulePage";
import {
  getAuxiliarySessionScope,
  isAuxiliaryOpenForSession,
} from "./auxiliary-visibility";
import { GlobalSearchOverlay } from "./overlays/GlobalSearchOverlay";
import { PrimarySidebar } from "./primary-sidebar";
import type { Page } from "./types";
import { useInspectorStore } from "@/stores/inspector-store";
import { useSettingsPageStore } from "@/stores/settings-page-store";
import { useUnifiedChatStore } from "@/stores/unified-chat-store";
import type { ThemeMode } from "@/stores/theme-store";
import type { PermissionDialogRequest } from "@shared/types";
import { deriveAuxiliaryMode } from "./layout-model";
import {
  readPreviewPlatform,
  readReviewAcceptanceMode,
  resolveWorkbenchPlatform,
} from "./resolve-platform";
import { useWorkbenchLayout } from "./use-workbench-layout";
import { useWorkbenchTransitions } from "./use-workbench-transitions";
import { WindowChrome } from "./WindowChrome";
import { ResizeHandle } from "./ResizeHandle";
import {
  MainWorkspaceShell,
  PrimarySidebarShell,
  WorkbenchLayout,
  WorkbenchMainColumns,
  WorkbenchOverlayHost,
} from "./WorkbenchRegions";
import { PlatformWindow } from "./PlatformWindow";
import { WorkbenchAuxiliaryHost } from "./WorkbenchAuxiliaryHost";
import { KeepAliveWorkbenchView, WorkbenchViewHost } from "./WorkbenchViewHost";
import { CREATE_NEW_SESSION_EVENT, OPEN_GLOBAL_SEARCH_EVENT } from "./events";

export function WorkbenchRoot({
  page,
  onPage,
  isDark,
  themeMode,
  onToggleTheme,
  permissionRequest,
  pendingPermissionSessionIds,
  onPermissionRespond,
}: {
  page: Page;
  onPage: (page: Page) => void;
  isDark: boolean;
  themeMode: ThemeMode;
  onToggleTheme: () => void;
  permissionRequest?: PermissionDialogRequest;
  pendingPermissionSessionIds?: readonly string[];
  onPermissionRespond: (
    approved: boolean,
    scope?: "once" | "session",
    reason?: string,
  ) => void;
}) {
  const activeSessionId = useUnifiedChatStore((state) => state.activeSessionId);
  const layout = useWorkbenchLayout(activeSessionId);
  const {
    state,
    dispatch,
    setAuxiliaryOpen,
    showPrimaryPeek,
    schedulePrimaryPeekHide,
    startResize,
  } = layout;
  const {
    auxiliarySwitching,
    togglePrimary,
    toggleAuxiliary,
    toggleAuxiliaryPrimary,
  } = useWorkbenchTransitions(layout, activeSessionId);

  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [pluginsTab, setPluginsTab] = useState<PluginsTab>("skills");
  const [isMaximized, setIsMaximized] = useState(false);
  const createSession = useUnifiedChatStore((s) => s.createSession);
  const setActiveSession = useUnifiedChatStore((s) => s.setActiveSession);
  const openScheduledSession = (sessionId: string) => {
    setActiveSession(sessionId);
    onPage("chat");
  };

  // ---- OPEN_GLOBAL_SEARCH_EVENT (⌘K / Ctrl+K handler from anywhere) ----
  useEffect(() => {
    const handler = () => setGlobalSearchOpen(true);
    window.addEventListener(OPEN_GLOBAL_SEARCH_EVENT, handler);
    return () => window.removeEventListener(OPEN_GLOBAL_SEARCH_EVENT, handler);
  }, []);

  // ---- CREATE_NEW_SESSION_EVENT (⌘N / Ctrl+N handler from anywhere) -----
  useEffect(() => {
    const handler = () => {
      void createSession();
      onPage("chat");
    };
    window.addEventListener(CREATE_NEW_SESSION_EVENT, handler);
    return () => window.removeEventListener(CREATE_NEW_SESSION_EVENT, handler);
  }, [createSession, onPage]);

  // ---- Global ⌘K / ⌘N keyboard shortcuts (work even when no input has focus) -
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Skip when typing in an editable field — the field's own handler should
      // own the keystroke. Composer uses Cmd+Enter to send, Cmd+K to clear, so
      // we don't want to also pop the search overlay from there.
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isEditable =
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        target?.isContentEditable === true;
      if (isEditable) return;
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setGlobalSearchOpen(true);
        return;
      }
      if (event.key.toLowerCase() === "n" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void createSession();
        onPage("chat");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [createSession, onPage]);

  // ---- Window maximize/restore state --------------------------------------
  // The platform IPC exposes `setMaximized(boolean)` for true toggle. We track
  // the current state via a local hint that flips on every dblclick so the
  // next dblclick restores. main.ts owns the actual maximize state but the
  // IPC bridge is one-way, so this hint is the renderer-side source of truth
  // for the toggle.
  const handleDoubleClickTitleBar = () => {
    if (isMacOS) return; // macOS native frame handles this
    const next = !isMaximized;
    void window.marloues.window.setMaximized(next);
    setIsMaximized(next);
  };

  // ---- reviewTarget auto-expands the auxiliary region --------------------
  const reviewTarget = useInspectorStore((state) => state.reviewTarget);
  useEffect(() => {
    if (!reviewTarget) return;
    setAuxiliaryOpen(true);
    dispatch({ type: "auxiliary.width.ensureMin" });
  }, [reviewTarget, reviewTarget?.seq, setAuxiliaryOpen, dispatch]);

  // ---- setVisibleSession visibility sync ---------------------------------
  const setVisibleSession = useUnifiedChatStore(
    (store) => store.setVisibleSession,
  );
  useEffect(() => {
    const syncVisibleSession = () => {
      const chatIsVisible =
        page === "chat" &&
        document.visibilityState === "visible" &&
        document.hasFocus();
      setVisibleSession(chatIsVisible ? activeSessionId : null);
    };
    syncVisibleSession();
    document.addEventListener("visibilitychange", syncVisibleSession);
    window.addEventListener("focus", syncVisibleSession);
    window.addEventListener("blur", syncVisibleSession);
    return () => {
      document.removeEventListener("visibilitychange", syncVisibleSession);
      window.removeEventListener("focus", syncVisibleSession);
      window.removeEventListener("blur", syncVisibleSession);
      setVisibleSession(null);
    };
  }, [activeSessionId, page, setVisibleSession]);

  // ---- revealSubagentSeq auto-expands the auxiliary region ---------------
  const revealSubagentSeq = useUnifiedChatStore((store) =>
    activeSessionId
      ? store.executionBySession[activeSessionId]?.revealSubagentSeq
      : undefined,
  );
  useEffect(() => {
    if (!revealSubagentSeq) return;
    setAuxiliaryOpen(true);
    dispatch({ type: "auxiliary.width.ensureMin" });
  }, [revealSubagentSeq, setAuxiliaryOpen, dispatch]);

  // ---- Derived platform + page flags --------------------------------------
  const previewPlatform = readPreviewPlatform();
  const platform = resolveWorkbenchPlatform(
    window.marloues.app.platform,
    previewPlatform,
  );
  const isMacOS = platform === "macos";
  const reviewAcceptance = readReviewAcceptanceMode();
  // ---- Derived layout values ---------------------------------------------
  const auxiliaryScope = getAuxiliarySessionScope(activeSessionId);
  const auxiliaryOpen = isAuxiliaryOpenForSession(
    state.auxiliaryOpenScopes,
    auxiliaryScope,
  );
  const auxiliaryMode = deriveAuxiliaryMode(
    auxiliaryOpen,
    state.auxiliaryPrimaryOverlay,
  );
  const effectiveAuxiliaryMode = page === "chat" ? auxiliaryMode : "closed";
  const sidebarVisible = state.primaryOpen;
  const leftResizable = state.primaryOpen;
  const sidebarFloating = !state.primaryOpen && state.primaryPeeking;
  const sidebarIsCollapsed = !state.primaryOpen;
  const hideTitleBarExtras =
    effectiveAuxiliaryMode === "primary-overlay" && sidebarIsCollapsed;
  // Quick pages temporarily close the visible auxiliary column, but the
  // hidden chat tree keeps the layout props it had before the page switch.
  const hideChatTitle = auxiliaryMode === "primary-overlay";

  const shellStyle = useMemo(
    () =>
      ({
        "--workbench-primary-width": `${state.primaryWidth}px`,
        "--workbench-auxiliary-width": `${state.auxiliaryWidth}px`,
      }) as CSSProperties,
    [state.auxiliaryWidth, state.primaryWidth],
  );

  // ---- OPEN_SETTINGS shortcut via GlobalSearchOverlay ---------------------
  const openSettingsPage = useSettingsPageStore((s) => s.openSection);
  const openPluginsPage = (tab: PluginsTab) => {
    setPluginsTab(tab);
    onPage("plugins");
  };

  // The macOS vs standard WindowChrome variants only differ by a positioning
  // Props are identical across platforms, so the chrome is rendered once.
  const windowChrome = (
    <WindowChrome
      sidebarOpen={state.primaryOpen}
      page={page}
      isDark={isDark}
      themeMode={themeMode}
      onPage={onPage}
      globalSearchOpen={globalSearchOpen}
      onOpenSearch={() => setGlobalSearchOpen(true)}
      onToggleSidebar={togglePrimary}
      sidebarPeeking={sidebarFloating}
      titleExtrasHidden={hideTitleBarExtras}
      onSidebarTogglePointerEnter={showPrimaryPeek}
      onSidebarTogglePointerLeave={schedulePrimaryPeekHide}
      onToggleTheme={onToggleTheme}
      auxiliaryOpen={auxiliaryOpen}
      onToggleAuxiliary={toggleAuxiliary}
      auxiliaryMode={effectiveAuxiliaryMode}
      auxiliarySwitching={auxiliarySwitching}
      onReturnToMain={toggleAuxiliaryPrimary}
      isMacOS={isMacOS}
      onDoubleClickTitleBar={isMacOS ? undefined : handleDoubleClickTitleBar}
    />
  );

  return (
    <PlatformWindow
      platform={platform}
      page={page}
      primaryOpen={sidebarVisible}
      primaryPeeking={sidebarFloating}
      primaryTransition={state.primaryTransition}
      auxiliaryMode={effectiveAuxiliaryMode}
      auxiliarySwitching={auxiliarySwitching}
      reviewAcceptance={reviewAcceptance}
      style={shellStyle}
    >
      {windowChrome}
      <WorkbenchLayout>
        <PrimarySidebarShell
          open={sidebarVisible}
          peeking={sidebarFloating}
          width={state.primaryWidth}
          regionRef={(node) => {
            layout.primaryRef.current = node;
          }}
          onPointerEnter={showPrimaryPeek}
          onPointerLeave={schedulePrimaryPeekHide}
        >
          <PrimarySidebar
            page={page}
            onPage={onPage}
            isMacOS={isMacOS}
            pendingPermissionSessionIds={pendingPermissionSessionIds}
          />
        </PrimarySidebarShell>
        {leftResizable ? (
          <ResizeHandle
            target="primary"
            ariaLabel="调整左侧边栏宽度"
            onPointerDown={(event) => startResize("primary", event)}
          />
        ) : null}
        <WorkbenchMainColumns
          regionRef={(node) => {
            layout.contentFrameRef.current = node;
          }}
        >
          <MainWorkspaceShell obscured={auxiliaryMode === "primary-overlay"}>
            <WorkbenchViewHost
              page={page}
              isMacOS={isMacOS}
              sidebarOpen={state.primaryOpen}
              auxiliaryOpen={auxiliaryOpen}
              hideChatTitle={hideChatTitle}
              auxiliaryObscuresMain={auxiliaryMode === "primary-overlay"}
              permissionRequest={permissionRequest}
              onPermissionRespond={onPermissionRespond}
            />
          </MainWorkspaceShell>

          <WorkbenchAuxiliaryHost
            mode={effectiveAuxiliaryMode}
            width={state.auxiliaryWidth}
            busy={auxiliarySwitching}
            onTogglePrimary={toggleAuxiliaryPrimary}
            onEnsureOpen={() => setAuxiliaryOpen(true)}
            onStartResize={startResize}
            regionRef={(node) => {
              layout.auxiliaryRef.current = node;
            }}
          />

          <KeepAliveWorkbenchView
            name="schedules"
            active={page === "schedules"}
            className="quick-page-overlay-host scheduled-tasks-page-host"
          >
            <SchedulePage onOpenSession={openScheduledSession} />
          </KeepAliveWorkbenchView>

          <KeepAliveWorkbenchView
            name="plugins"
            active={page === "plugins"}
            className="quick-page-overlay-host plugins-page-host"
          >
            <PluginsView tab={pluginsTab} onTabChange={setPluginsTab} />
          </KeepAliveWorkbenchView>
        </WorkbenchMainColumns>
      </WorkbenchLayout>

      <WorkbenchOverlayHost>
        <GlobalSearchOverlay
          open={globalSearchOpen}
          onClose={() => setGlobalSearchOpen(false)}
          onPage={onPage}
          onOpenSettings={openSettingsPage}
          onOpenPlugins={openPluginsPage}
        />
      </WorkbenchOverlayHost>
      <SettingsPage />
    </PlatformWindow>
  );
}
