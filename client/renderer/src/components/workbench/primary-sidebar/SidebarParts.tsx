import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  ArchiveRestore,
  ChevronRight,
  Copy,
  Folder,
  GitBranch,
  LogOut,
  MoreHorizontal,
  Palette,
  Pencil,
  Pin,
  RefreshCcw,
  Settings,
  SquarePen,
  Trash2,
} from "lucide-react";
import { getThemeDefinitions, type ThemeMode } from "@/stores/theme-store";
import { useUpdateStore } from "@/stores/update-store";
import { notify } from "@/lib/notifications";
import type { SettingsSection } from "@/components/settings/types";
import type { AppVersionInfo } from "@shared/hot-update";
import { STRINGS } from "@shared/strings.zh";
import type {
  AuthSession,
  ChatSessionRecord,
  WorkspaceInfo,
} from "@shared/types";
import { SidebarActivityIndicator } from "./SidebarActivityIndicator";
import type { SidebarActivityStatus } from "./sidebar-activity";
import { formatSidebarTimestamp } from "./sidebar-work-areas";
export function SessionRow({
  session,
  active,
  activity,
  executionRunning,
  permissionPending,
  renaming,
  renameValue,
  onRenameValue,
  onCommitRename,
  onCancelRename,
  onOpen,
  onTogglePinned,
  onOpenMenu,
}: {
  session: ChatSessionRecord;
  active: boolean;
  activity: SidebarActivityStatus;
  executionRunning: boolean;
  permissionPending?: boolean;
  renaming: boolean;
  renameValue: string;
  onRenameValue: (value: string) => void;
  onCommitRename: (session: ChatSessionRecord) => void;
  onCancelRename: () => void;
  onOpen: () => void;
  onTogglePinned: () => void;
  onOpenMenu: (x: number, y: number) => void;
}) {
  const showPermissionStatus = permissionPending && executionRunning;
  const metaActivity = showPermissionStatus ? null : activity;

  return (
    <div
      role="button"
      tabIndex={0}
      className={`session-item ${active ? "active" : ""} ${session.isPinned ? "pinned" : ""} ${showPermissionStatus ? "has-permission" : ""} ${activity ? `has-activity activity-${activity}` : ""}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter") onOpen();
      }}
    >
      {session.isPinned ? (
        <span className="session-pinned-indicator" aria-label="已置顶">
          <Pin aria-hidden="true" />
        </span>
      ) : null}

      <div className="session-content">
        {renaming ? (
          <input
            className="session-rename"
            value={renameValue}
            autoFocus
            onChange={(event) => onRenameValue(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onBlur={() => onCommitRename(session)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onCommitRename(session);
              if (event.key === "Escape") onCancelRename();
            }}
          />
        ) : (
          <span className="session-title-line">
            <span className="session-title-text">
              {formatSessionTitle(session.title)}
            </span>
            <span
              className={`session-permission-status${showPermissionStatus ? " is-visible" : ""}`}
              role={showPermissionStatus ? "status" : undefined}
              aria-hidden={!showPermissionStatus}
              title={showPermissionStatus ? "等待批准" : undefined}
            >
              <span>{"\u7b49\u5f85\u6279\u51c6"}</span>
            </span>
          </span>
        )}
      </div>

      <div className="session-trailing">
        {metaActivity ? (
          <SidebarActivityIndicator
            status={metaActivity}
            className="session-activity-indicator"
          />
        ) : (
          <time>{formatSidebarTimestamp(session.updatedAt)}</time>
        )}
        <span className="session-actions">
          <button
            className={`session-action session-pin ${session.isPinned ? "active" : ""}`}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onTogglePinned();
            }}
            title={session.isPinned ? "取消置顶" : "置顶对话"}
            aria-label={session.isPinned ? "取消置顶" : "置顶对话"}
          >
            <Pin aria-hidden="true" />
          </button>
          <button
            className="session-action"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              const rect = event.currentTarget.getBoundingClientRect();
              onOpenMenu(rect.left, rect.bottom + 4);
            }}
            title="对话操作"
            aria-label="对话操作"
          >
            <MoreHorizontal aria-hidden="true" />
          </button>
        </span>
      </div>
    </div>
  );
}

export function UserInfoPopover({
  workspaceName,
  session,
  avatarInitial,
  themeMode,
  onSetThemeMode,
  onSettings,
  onLogout,
}: {
  workspaceName?: string;
  session: AuthSession | null;
  avatarInitial: string;
  themeMode: ThemeMode;
  onSetThemeMode: (mode: ThemeMode) => void;
  onSettings: (section: SettingsSection) => void;
  onLogout: () => void;
}) {
  const [versionInfo, setVersionInfo] = useState<AppVersionInfo | null>(null);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [themeMenuPosition, setThemeMenuPosition] = useState({
    left: 0,
    top: 0,
  });
  const themeTriggerRef = useRef<HTMLDivElement>(null);
  const themeCloseTimerRef = useRef<number | null>(null);
  const isCheckingUpdate = useUpdateStore((state) => state.isChecking);
  const checkForUpdate = useUpdateStore((state) => state.check);
  const accountName =
    session?.displayName ||
    session?.username ||
    session?.email ||
    "Marloues User";
  const accountDetail =
    workspaceName || session?.email || session?.provider || "已登录";
  const themeOptions: Array<{ mode: ThemeMode; label: string }> = [
    { mode: "system", label: "跟随系统" },
    ...getThemeDefinitions().map(({ label, mode }) => ({ label, mode })),
  ];
  const currentThemeLabel =
    themeOptions.find((item) => item.mode === themeMode)?.label ?? "系统";

  useEffect(() => {
    let cancelled = false;
    void window.marloues.app.getVersionInfo().then((info) => {
      if (!cancelled) setVersionInfo(info);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (themeCloseTimerRef.current)
        window.clearTimeout(themeCloseTimerRef.current);
    };
  }, []);

  const clearThemeCloseTimer = () => {
    if (!themeCloseTimerRef.current) return;
    window.clearTimeout(themeCloseTimerRef.current);
    themeCloseTimerRef.current = null;
  };

  const updateThemeMenuPosition = () => {
    const rect = themeTriggerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const viewportPadding = 8;
    const menuWidth = 132;
    const menuHeight = 8 + themeOptions.length * 36;
    const menuGap = 8;
    const rightSideLeft = rect.right + menuGap;
    const leftSideLeft = rect.left - menuWidth - menuGap;
    const hasRightRoom =
      rightSideLeft + menuWidth <= window.innerWidth - viewportPadding;
    const preferredLeft = hasRightRoom ? rightSideLeft : leftSideLeft;
    const left = Math.min(
      Math.max(preferredLeft, viewportPadding),
      window.innerWidth - menuWidth - viewportPadding,
    );
    const top = Math.min(
      Math.max(rect.top, viewportPadding),
      window.innerHeight - menuHeight - viewportPadding,
    );

    setThemeMenuPosition({ left, top });
  };

  const openThemeMenu = () => {
    clearThemeCloseTimer();
    updateThemeMenuPosition();
    setThemeMenuOpen(true);
  };

  const scheduleCloseThemeMenu = () => {
    clearThemeCloseTimer();
    themeCloseTimerRef.current = window.setTimeout(
      () => setThemeMenuOpen(false),
      140,
    );
  };

  useEffect(() => {
    if (!themeMenuOpen) return;
    updateThemeMenuPosition();
    window.addEventListener("resize", updateThemeMenuPosition);
    window.addEventListener("scroll", updateThemeMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateThemeMenuPosition);
      window.removeEventListener("scroll", updateThemeMenuPosition, true);
    };
  }, [themeMenuOpen]); // eslint-disable-line react-hooks/exhaustive-deps -- updateThemeMenuPosition 每次渲染重建（依赖 themeOptions/ref），加入会在菜单打开期间每次渲染重订阅监听

  return (
    <section
      className="sidebar-user-popover"
      role="dialog"
      aria-label="用户信息"
    >
      <div className="sidebar-user-popover-head">
        <span className="sidebar-user-popover-avatar">{avatarInitial}</span>
        <span>
          <strong>{accountName}</strong>
          <small>{accountDetail}</small>
        </span>
      </div>
      <div
        ref={themeTriggerRef}
        className="sidebar-user-theme-trigger"
        onMouseEnter={openThemeMenu}
        onMouseLeave={scheduleCloseThemeMenu}
        onFocus={openThemeMenu}
      >
        <button
          className={`sidebar-user-menu-row ${themeMenuOpen ? "active" : ""}`}
          type="button"
          aria-haspopup="menu"
          aria-expanded={themeMenuOpen}
        >
          <span className="sidebar-user-popover-icon">
            <Palette size={15} />
          </span>
          <span>主题切换</span>
          <strong>{currentThemeLabel}</strong>
          <ChevronRight size={14} />
        </button>
        {themeMenuOpen
          ? createPortal(
              <div
                data-sidebar-theme-menu
                className="sidebar-theme-submenu"
                style={{
                  left: themeMenuPosition.left,
                  top: themeMenuPosition.top,
                }}
                role="menu"
                onMouseEnter={clearThemeCloseTimer}
                onMouseLeave={scheduleCloseThemeMenu}
              >
                {themeOptions.map((item) => (
                  <button
                    key={item.mode}
                    className={item.mode === themeMode ? "active" : ""}
                    type="button"
                    role="menuitemradio"
                    aria-checked={item.mode === themeMode}
                    onClick={() => {
                      onSetThemeMode(item.mode);
                      setThemeMenuOpen(false);
                    }}
                  >
                    <span>{item.label}</span>
                    {item.mode === themeMode ? <strong>当前</strong> : null}
                  </button>
                ))}
              </div>,
              document.body,
            )
          : null}
      </div>
      <button
        className="sidebar-user-menu-row"
        type="button"
        onClick={() => onSettings("personalization")}
      >
        <span className="sidebar-user-popover-icon">
          <Settings size={15} />
        </span>
        <span>设置</span>
      </button>
      <button
        className="sidebar-user-menu-row"
        type="button"
        disabled={isCheckingUpdate}
        onClick={() => {
          void checkForUpdate().then(() => {
            if (useUpdateStore.getState().state?.status === "idle") {
              notify({
                title: STRINGS.system.update.alreadyLatest,
                tone: "success",
              });
            }
          });
        }}
      >
        <span className="sidebar-user-popover-icon">
          <RefreshCcw
            size={15}
            className={isCheckingUpdate ? "sidebar-update-icon-spinning" : ""}
          />
        </span>
        <span>{isCheckingUpdate ? "正在检查更新" : "检查更新"}</span>
      </button>
      <div className="sidebar-user-menu-divider" />
      <button
        className="sidebar-user-menu-row danger"
        type="button"
        onClick={onLogout}
      >
        <LogOut size={15} />
        <span>退出登录</span>
      </button>
      {versionInfo ? (
        <div
          className="sidebar-user-app-version"
          title={`客户端 ${versionInfo.clientVersion} / UI ${versionInfo.uiVersion}`}
        >
          <span>版本 v{versionInfo.clientVersion}</span>
        </div>
      ) : null}
    </section>
  );
}

export function SessionContextMenu({
  menu,
  sessions,
  onTogglePinned,
  onRename,
  onFork,
  onExportMarloues,
  onDelete,
}: {
  menu: { x: number; y: number; sessionId: string };
  sessions: ChatSessionRecord[];
  onTogglePinned: (session: ChatSessionRecord) => void;
  onRename: (session: ChatSessionRecord) => void;
  onFork: (session: ChatSessionRecord) => void;
  onExportMarloues: (session: ChatSessionRecord) => void;
  onDelete: (session: ChatSessionRecord) => void;
}) {
  const session = sessions.find((item) => item.id === menu.sessionId);
  if (!session) return null;

  const menuElement = (
    <div
      data-session-menu
      className="session-menu"
      style={getFloatingMenuPosition(menu.x, menu.y, 150, 196)}
    >
      <button onClick={() => onTogglePinned(session)}>
        <Pin size={14} />
        {session.isPinned ? "取消置顶" : "置顶"}
      </button>
      <button onClick={() => onRename(session)}>
        <Pencil size={14} />
        重命名
      </button>
      <button onClick={() => onFork(session)}>
        <GitBranch size={14} />
        分叉副本
      </button>
      <button onClick={() => onExportMarloues(session)}>
        <ArchiveRestore size={14} />
        导出为 Markdown
      </button>
      <button className="danger" onClick={() => onDelete(session)}>
        <Trash2 size={14} />
        删除
      </button>
    </div>
  );

  return createPortal(menuElement, document.body);
}

export function ProjectContextMenu({
  menu,
  projects,
  firstProjectId,
  onNewSession,
  onOpen,
  onCopyPath,
  onRename,
  onMoveToTop,
  onRemove,
  onClose,
}: {
  menu: { x: number; y: number; projectId: string };
  projects: WorkspaceInfo[];
  firstProjectId?: string;
  onNewSession: (project: WorkspaceInfo) => void;
  onOpen: (project: WorkspaceInfo) => void;
  onCopyPath: (project: WorkspaceInfo) => void;
  onRename: (project: WorkspaceInfo) => void;
  onMoveToTop: (project: WorkspaceInfo) => void;
  onRemove: (project: WorkspaceInfo) => void;
  onClose: () => void;
}) {
  const project = projects.find((item) => item.id === menu.projectId);
  if (!project) return null;

  const itemCount = 5 + (project.id !== firstProjectId ? 1 : 0);
  const menuElement = (
    <div
      data-project-menu
      className="session-menu project-menu"
      style={getFloatingMenuPosition(menu.x, menu.y, 178, itemCount * 37 + 10)}
    >
      <button
        onClick={() => {
          onNewSession(project);
          onClose();
        }}
      >
        <SquarePen size={14} />
        {"\u65b0\u5efa\u4f1a\u8bdd"}
      </button>
      <button
        onClick={() => {
          onOpen(project);
          onClose();
        }}
      >
        <Folder size={14} />
        打开空间
      </button>
      <button
        onClick={() => {
          onCopyPath(project);
          onClose();
        }}
      >
        <Copy size={14} />
        {"\u590d\u5236\u8def\u5f84"}
      </button>
      <button
        onClick={() => {
          onRename(project);
          onClose();
        }}
      >
        <Pencil size={14} />
        {"\u91cd\u547d\u540d"}
      </button>
      {project.id !== firstProjectId ? (
        <button onClick={() => onMoveToTop(project)}>
          <Pin size={14} />
          移到顶部
        </button>
      ) : null}
      <button
        className="danger"
        onClick={() => {
          onRemove(project);
          onClose();
        }}
      >
        <Trash2 size={14} />
        {"\u4ece\u5217\u8868\u79fb\u9664"}
      </button>
    </div>
  );

  return createPortal(menuElement, document.body);
}

function getFloatingMenuPosition(
  x: number,
  y: number,
  width: number,
  height: number,
): CSSProperties {
  const viewportPadding = 8;
  const left = Math.min(
    Math.max(x, viewportPadding),
    window.innerWidth - width - viewportPadding,
  );
  const top = Math.min(
    Math.max(y, viewportPadding),
    window.innerHeight - height - viewportPadding,
  );
  return { left, top };
}

export function formatSessionTitle(title: string): string {
  return title === "New chat" ? "新对话" : title;
}
