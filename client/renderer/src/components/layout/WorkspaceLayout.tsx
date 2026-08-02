import { useEffect, useRef, useState } from "react";
import { WorkflowChatPage } from "@/pages/WorkflowChatPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { OPEN_SETTINGS_EVENT } from "@/components/workflow-chat/EmptyChatState";
import { PermissionRequestOverlay } from "@/components/layout/PermissionRequestOverlay";
import { RightSidebar } from "@/components/layout/RightSidebar";
import { TitleBar } from "@/components/layout/TitleBar";
import { Sidebar } from "@/components/layout/Sidebar";
import type { Page, SettingsSection } from "@/components/layout/types";
import type { ThemeMode } from "@/stores/theme-store";
import type { PermissionDialogRequest } from "@shared/types";

type ResizeTarget = "left" | "right" | null;

const DEFAULT_SIDEBAR_WIDTH = 300;
const INSPECTOR_DIVIDER_WIDTH = 1;
const DEFAULT_INSPECTOR_WIDTH = 319;
const SIDEBAR_MIN = 300;
const SIDEBAR_MAX = 480;
const SIDEBAR_COLLAPSE = 220;
const INSPECTOR_MIN = 319;
const INSPECTOR_MAX = 500;
const INSPECTOR_COLLAPSE = 220;
const MAIN_MIN = 400;
const INSPECTOR_AUTO_CLOSE_WIDTH =
  SIDEBAR_MIN + INSPECTOR_MIN + INSPECTOR_DIVIDER_WIDTH + MAIN_MIN;

export function WorkspaceLayout({
  page,
  onPage,
  settingsSection,
  onSettingsSection,
  isDark,
  themeMode,
  onToggleTheme,
  permissionRequest,
  onPermissionRespond,
}: {
  page: Page;
  onPage: (page: Page) => void;
  settingsSection: SettingsSection;
  onSettingsSection: (section: SettingsSection) => void;
  isDark: boolean;
  themeMode: ThemeMode;
  onToggleTheme: () => void;
  permissionRequest?: PermissionDialogRequest;
  onPermissionRespond: (
    approved: boolean,
    scope?: "once" | "session",
    reason?: string,
  ) => void;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [inspectorWidth, setInspectorWidth] = useState(DEFAULT_INSPECTOR_WIDTH);
  const resizingRef = useRef<ResizeTarget>(null);
  const sidebarOpenRef = useRef(sidebarOpen);
  const inspectorOpenRef = useRef(inspectorOpen);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const inspectorRef = useRef<HTMLDivElement>(null);
  const contentFrameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    sidebarOpenRef.current = sidebarOpen;
  }, [sidebarOpen]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        { section?: SettingsSection } | undefined;
      onPage("settings");
      if (detail?.section) onSettingsSection(detail.section);
    };
    window.addEventListener(OPEN_SETTINGS_EVENT, handler);
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, handler);
  }, [onPage, onSettingsSection]);

  useEffect(() => {
    inspectorOpenRef.current = inspectorOpen;
  }, [inspectorOpen]);

  useEffect(() => {
    const check = () => {
      const width = window.innerWidth;
      if (inspectorOpenRef.current && width < INSPECTOR_AUTO_CLOSE_WIDTH)
        setInspectorOpen(false);
      if (sidebarOpenRef.current && width < 680) setSidebarOpen(false);
    };

    const observer = new ResizeObserver(check);
    observer.observe(document.body);
    window.addEventListener("resize", check);
    check();

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", check);
    };
  }, []);

  useEffect(() => {
    let rafId: number | null = null;

    const onPointerMove = (event: PointerEvent) => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (resizingRef.current === "left") {
          const nextWidth = Math.min(SIDEBAR_MAX, event.clientX);
          if (nextWidth < SIDEBAR_COLLAPSE) {
            setSidebarOpen(false);
            setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
            endResize();
            return;
          }
          setSidebarOpen(true);
          setSidebarWidth(Math.max(SIDEBAR_MIN, nextWidth));
        }
        if (resizingRef.current === "right") {
          const frameRect = contentFrameRef.current?.getBoundingClientRect();
          const frameRight = frameRect?.right ?? window.innerWidth;
          const frameWidth = frameRect?.width ?? window.innerWidth;
          const maxWidth = Math.max(
            0,
            frameWidth - MAIN_MIN - INSPECTOR_DIVIDER_WIDTH,
          );
          const nextWidth = Math.min(
            INSPECTOR_MAX,
            maxWidth,
            frameRight - event.clientX,
          );
          if (nextWidth < INSPECTOR_COLLAPSE) {
            setInspectorOpen(false);
            setInspectorWidth(DEFAULT_INSPECTOR_WIDTH);
            endResize();
            return;
          }
          setInspectorOpen(true);
          setInspectorWidth(Math.max(INSPECTOR_MIN, nextWidth));
        }
      });
    };

    const onPointerUp = () => endResize();

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, []);

  const endResize = () => {
    resizingRef.current = null;
    document.body.classList.remove("resizing-columns");
    if (sidebarRef.current) sidebarRef.current.style.transition = "";
    if (inspectorRef.current) inspectorRef.current.style.transition = "";
  };

  const startResize = (
    target: ResizeTarget,
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    resizingRef.current = target;
    document.body.classList.add("resizing-columns");
    if (sidebarRef.current) sidebarRef.current.style.transition = "none";
    if (inspectorRef.current) inspectorRef.current.style.transition = "none";
  };

  const toggleSidebar = () => {
    setSidebarOpen((open) => {
      if (!open) setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
      return !open;
    });
  };

  const inspectorVisible = inspectorOpen;
  const openSettings = (section?: SettingsSection) => {
    if (section) onSettingsSection(section);
    onPage("settings");
  };
  const isMacOS = window.marloues.app.platform === "darwin";
  const settingsPage = page === "settings";
  const sidebarVisible = sidebarOpen || settingsPage;

  return (
    <div
      className={`app-shell ${isMacOS ? "platform-layout-macos" : "platform-layout-standard"} ${sidebarVisible ? "sidebar-expanded" : "sidebar-collapsed"}`}
    >
      {!isMacOS ? (
        <TitleBar
          sidebarOpen={sidebarVisible}
          page={page}
          isDark={isDark}
          themeMode={themeMode}
          globalSearchOpen={globalSearchOpen}
          onPage={onPage}
          onOpenSettings={openSettings}
          onToggleSidebar={toggleSidebar}
          onToggleTheme={onToggleTheme}
          onCloseSearch={() => setGlobalSearchOpen(false)}
        />
      ) : (
        <TitleBar
          sidebarOpen={sidebarVisible}
          page={page}
          isDark={isDark}
          themeMode={themeMode}
          globalSearchOpen={globalSearchOpen}
          onPage={onPage}
          onOpenSettings={openSettings}
          onToggleSidebar={toggleSidebar}
          onToggleTheme={onToggleTheme}
          onCloseSearch={() => setGlobalSearchOpen(false)}
          style={sidebarVisible ? { width: sidebarWidth } : undefined}
        />
      )}
      <div
        className={`workspace ${page === "settings" ? "settings-paper-workspace" : ""}`}
      >
        <div
          ref={sidebarRef}
          className={`sidebar-region ${sidebarVisible ? "open" : "closed"}`}
          style={{ width: sidebarVisible ? sidebarWidth : 0 }}
        >
          <div className="sidebar-size-lock" style={{ width: sidebarWidth }}>
            <Sidebar
              page={page}
              onPage={onPage}
              onOpenSettings={openSettings}
              onOpenSearch={() => setGlobalSearchOpen(true)}
              settingsSection={settingsSection}
              onSettingsSection={onSettingsSection}
            />
          </div>
        </div>
        <main
          className={`main-panel ${page === "settings" ? "settings-paper-main" : ""}`}
        >
          <div className="content-frame" ref={contentFrameRef}>
            {sidebarVisible && !settingsPage ? (
              <div
                className="frame-resize-handle left"
                onPointerDown={(event) => startResize("left", event)}
              />
            ) : null}
            {page === "chat" ? (
              <>
                <div className="chat-region">
                  <WorkflowChatPage
                    leftCollapsed={isMacOS && !sidebarOpen}
                    permissionRequest={permissionRequest}
                    onPermissionRespond={onPermissionRespond}
                  />
                </div>
                {inspectorVisible ? (
                  <div
                    className="frame-resize-handle right"
                    onPointerDown={(event) => startResize("right", event)}
                  />
                ) : null}
                <div
                  ref={inspectorRef}
                  className={`inspector-region ${inspectorVisible ? "open" : "closed"}`}
                  style={{ width: inspectorVisible ? inspectorWidth : 0 }}
                >
                  <div
                    className="inspector-size-lock"
                    style={{ width: inspectorWidth }}
                  >
                    <RightSidebar />
                  </div>
                </div>
              </>
            ) : (
              <div className="settings-region">
                <SettingsPage
                  section={settingsSection}
                  onSection={onSettingsSection}
                />
                <PermissionRequestOverlay
                  request={permissionRequest}
                  onRespond={onPermissionRespond}
                />
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
