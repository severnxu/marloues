import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { OPEN_SETTINGS_EVENT } from "@/components/workflow-chat/EmptyChatState";
import { OPEN_AUXILIARY_PANEL_EVENT } from "./events";
import { useUnifiedChatStore } from "@/stores/unified-chat-store";
import type { Page, SettingsSection } from "@/components/layout/types";
import type { PermissionDialogRequest } from "@shared/types";
import {
  MainWorkspaceShell,
  PlatformWindow,
  PrimarySidebarShell,
  ResizeHandle,
  WorkbenchViewHost,
  WindowChrome,
  type WorkbenchPlatform,
  resolveWorkbenchPlatform,
  useAuxiliaryTransition,
  useWorkbenchLayout,
} from ".";

export function WorkbenchRoot({
  page,
  onPage,
  settingsSection,
  onSettingsSection,
  permissionRequest,
  onPermissionRespond,
}: {
  page: Page;
  onPage: (page: Page) => void;
  settingsSection: SettingsSection;
  onSettingsSection: (section: SettingsSection) => void;
  permissionRequest?: PermissionDialogRequest;
  onPermissionRespond: (
    approved: boolean,
    scope?: "once" | "session",
    reason?: string,
  ) => void;
}) {
  const {
    state,
    dispatch,
    contentFrameRef,
    startResize,
    showPrimaryPeek,
    hidePrimaryPeek,
  } = useWorkbenchLayout();
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const { switching: auxiliarySwitching, transition: transitionAuxiliary } =
    useAuxiliaryTransition(dispatch);
  const createSession = useUnifiedChatStore((store) => store.createSession);
  const activeTurn = useUnifiedChatStore((store) =>
    store.activeSessionId ? store.liveTurns[store.activeSessionId] : undefined,
  );
  const isRunning =
    activeTurn?.status === "pending" || activeTurn?.status === "running";
  const previewPlatform = import.meta.env.DEV
    ? new URLSearchParams(window.location.search).get("platform")
    : null;
  const platform: WorkbenchPlatform = resolveWorkbenchPlatform(
    window.marloues.app.platform,
    previewPlatform,
  );
  const settingsPage = page === "settings";
  const primaryOpen = settingsPage || state.primaryOpen;
  const auxiliaryMode = settingsPage ? "closed" : state.auxiliaryMode;

  useEffect(() => {
    const openSettings = (event: Event) => {
      const detail = (event as CustomEvent<{ section?: SettingsSection }>)
        .detail;
      onPage("settings");
      if (detail?.section) onSettingsSection(detail.section);
    };
    window.addEventListener(OPEN_SETTINGS_EVENT, openSettings);
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, openSettings);
  }, [onPage, onSettingsSection]);

  useEffect(() => {
    const openAuxiliaryPanel = () => {
      if (state.auxiliaryMode === "closed") {
        dispatch({ type: "auxiliary.mode.set", mode: "open" });
      }
    };
    window.addEventListener(OPEN_AUXILIARY_PANEL_EVENT, openAuxiliaryPanel);
    return () =>
      window.removeEventListener(
        OPEN_AUXILIARY_PANEL_EVENT,
        openAuxiliaryPanel,
      );
  }, [dispatch, state.auxiliaryMode]);

  const toggleAuxiliary = () => {
    if (auxiliaryMode === "primary-overlay") {
      transitionAuxiliary("closed");
      return;
    }
    dispatch({ type: "auxiliary.toggle" });
  };

  const shellStyle = useMemo(
    () =>
      ({
        "--workbench-primary-width": `${state.primaryWidth}px`,
        "--workbench-auxiliary-width": `${state.auxiliaryWidth}px`,
      }) as CSSProperties,
    [state.auxiliaryWidth, state.primaryWidth],
  );

  const openSettings = (section?: SettingsSection) => {
    if (section) onSettingsSection(section);
    onPage("settings");
  };

  return (
    <PlatformWindow
      platform={platform}
      primaryOpen={primaryOpen}
      primaryPeeking={state.primaryPeeking}
      auxiliaryMode={auxiliaryMode}
      auxiliarySwitching={auxiliarySwitching}
      style={shellStyle}
    >
      <WindowChrome
        platform={platform}
        primaryOpen={primaryOpen}
        primaryPeeking={state.primaryPeeking}
        auxiliaryMode={auxiliaryMode}
        isRunning={isRunning}
        searchOpen={globalSearchOpen}
        page={page}
        onPage={onPage}
        onOpenSettings={openSettings}
        onTogglePrimary={() => dispatch({ type: "primary.toggle" })}
        onNewThread={() => void createSession()}
        onToggleAuxiliary={toggleAuxiliary}
        onReturnToMain={() => transitionAuxiliary("open")}
        onToggleAuxiliaryPrimary={() =>
          transitionAuxiliary(
            auxiliaryMode === "primary-overlay" ? "open" : "primary-overlay",
          )
        }
        onCloseSearch={() => setGlobalSearchOpen(false)}
        onPrimaryPointerEnter={showPrimaryPeek}
        onPrimaryPointerLeave={hidePrimaryPeek}
      />

      <div
        className={`workspace workbench-layout ${settingsPage ? "settings-paper-workspace" : ""}`}
      >
        <PrimarySidebarShell
          width={state.primaryWidth}
          open={primaryOpen}
          peeking={state.primaryPeeking}
          onPointerEnter={showPrimaryPeek}
          onPointerLeave={hidePrimaryPeek}
        >
          <Sidebar
            page={page}
            onPage={onPage}
            onOpenSettings={openSettings}
            onOpenSearch={() => setGlobalSearchOpen(true)}
            settingsSection={settingsSection}
            onSettingsSection={onSettingsSection}
          />
        </PrimarySidebarShell>

        {state.primaryOpen && !settingsPage ? (
          <ResizeHandle target="primary" onPointerDown={startResize} />
        ) : null}

        <MainWorkspaceShell
          className={settingsPage ? "settings-paper-main" : ""}
        >
          <WorkbenchViewHost
            page={page}
            platform={platform}
            primaryOpen={state.primaryOpen}
            auxiliaryMode={auxiliaryMode}
            auxiliaryWidth={state.auxiliaryWidth}
            auxiliarySwitching={auxiliarySwitching}
            isRunning={isRunning}
            settingsSection={settingsSection}
            permissionRequest={permissionRequest}
            contentFrameRef={contentFrameRef}
            onSettingsSection={onSettingsSection}
            onPermissionRespond={onPermissionRespond}
            onStartResize={startResize}
            onAuxiliaryMode={transitionAuxiliary}
          />
        </MainWorkspaceShell>
      </div>
    </PlatformWindow>
  );
}
