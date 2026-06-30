import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight, Copy, Download, Folder, GitBranch, LoaderCircle, LogOut, MoreHorizontal, Pencil, Pin, RefreshCcw, SquarePen, Trash2, UserRound } from "lucide-react";
import type { ThemeMode } from "@/stores/theme-store";
import type { SettingsSection } from "@/components/layout/types";
import type { AuthSession, ChatSessionRecord, WorkspaceInfo } from "@shared/types";
export function SessionRow({
  session,
  active,
  running,
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
  running?: boolean;
  renaming: boolean;
  renameValue: string;
  onRenameValue: (value: string) => void;
  onCommitRename: (session: ChatSessionRecord) => void;
  onCancelRename: () => void;
  onOpen: () => void;
  onTogglePinned: () => void;
  onOpenMenu: (x: number, y: number) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      className={`session-item ${active ? "active" : ""} ${session.isPinned ? "pinned" : ""} ${running ? "running" : ""}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter") onOpen();
      }}
    >
      <span className="session-pin-slot">
        <button
          className={`session-pin ${session.isPinned ? "active" : ""}`}
          onClick={(event) => {
            event.stopPropagation();
            onTogglePinned();
          }}
          title={session.isPinned ? "取消置顶" : "置顶对话"}
        >
          <Pin size={14} strokeWidth={2.25} />
        </button>
      </span>

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
          <span>{formatSessionTitle(session.title)}</span>
        )}
      </div>

      <div className="session-meta">
        {running ? (
          <span className="runtime-spinner session-runtime-spinner" title="运行中" aria-label="运行中">
            <LoaderCircle size={14} />
          </span>
        ) : (
          <small>{formatRelativeTime(session.updatedAt)}</small>
        )}
        <button
          onClick={(event) => {
            event.stopPropagation();
            const rect = event.currentTarget.getBoundingClientRect();
            onOpenMenu(rect.left, rect.bottom + 4);
          }}
          title="对话操作"
        >
          <MoreHorizontal size={15} />
        </button>
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
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [themeMenuPosition, setThemeMenuPosition] = useState({ left: 0, top: 0 });
  const themeTriggerRef = useRef<HTMLDivElement>(null);
  const themeCloseTimerRef = useRef<number | null>(null);
  const accountName = session?.displayName || session?.username || session?.email || "Marloues User";
  const accountDetail = workspaceName || session?.email || session?.provider || "已登录";
  const themeOptions: Array<{ mode: ThemeMode; label: string }> = [
    { mode: "system", label: "跟随系统" },
    { mode: "dark", label: "深色主题" },
    { mode: "light", label: "浅色主题" },
    { mode: "warm", label: "暖色主题" },
  ];
  const currentThemeLabel = themeOptions.find((item) => item.mode === themeMode)?.label ?? "系统";

  useEffect(() => {
    return () => {
      if (themeCloseTimerRef.current) window.clearTimeout(themeCloseTimerRef.current);
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
    const menuHeight = 148;
    const menuGap = 8;
    const rightSideLeft = rect.right + menuGap;
    const leftSideLeft = rect.left - menuWidth - menuGap;
    const hasRightRoom = rightSideLeft + menuWidth <= window.innerWidth - viewportPadding;
    const preferredLeft = hasRightRoom ? rightSideLeft : leftSideLeft;
    const left = Math.min(Math.max(preferredLeft, viewportPadding), window.innerWidth - menuWidth - viewportPadding);
    const top = Math.min(Math.max(rect.top, viewportPadding), window.innerHeight - menuHeight - viewportPadding);

    setThemeMenuPosition({ left, top });
  };

  const openThemeMenu = () => {
    clearThemeCloseTimer();
    updateThemeMenuPosition();
    setThemeMenuOpen(true);
  };

  const scheduleCloseThemeMenu = () => {
    clearThemeCloseTimer();
    themeCloseTimerRef.current = window.setTimeout(() => setThemeMenuOpen(false), 140);
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
  }, [themeMenuOpen]);

  return (
    <section className="sidebar-user-popover" role="dialog" aria-label="用户信息">
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
            <RefreshCcw size={15} />
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
                style={{ left: themeMenuPosition.left, top: themeMenuPosition.top }}
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
      <button className="sidebar-user-menu-row" type="button" onClick={() => onSettings("personalization")}>
        <span className="sidebar-user-popover-icon">
          <UserRound size={15} />
        </span>
        <span>设置</span>
      </button>
      <button className="sidebar-user-menu-row danger" type="button" onClick={onLogout}>
        <LogOut size={15} />
        <span>退出登录</span>
      </button>
    </section>
  );
}

export function SessionContextMenu({
  menu,
  sessions,
  onTogglePinned,
  onRename,
  onFork,
  onExport,
  onDelete,
}: {
  menu: { x: number; y: number; sessionId: string };
  sessions: ChatSessionRecord[];
  onTogglePinned: (session: ChatSessionRecord) => void;
  onRename: (session: ChatSessionRecord) => void;
  onFork: (session: ChatSessionRecord) => void;
  onExport: (session: ChatSessionRecord) => void;
  onDelete: (session: ChatSessionRecord) => void;
}) {
  const session = sessions.find((item) => item.id === menu.sessionId);
  if (!session) return null;

  const menuElement = (
    <div data-session-menu className="session-menu" style={getFloatingMenuPosition(menu.x, menu.y, 150, 196)}>
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
      <button onClick={() => onExport(session)}>
        <Download size={14} />
        导出 Markdown
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
  activeProjectId,
  onSwitch,
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
  activeProjectId?: string;
  onSwitch: (project: WorkspaceInfo) => void;
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

  const itemCount = 6 + (project.id !== firstProjectId ? 1 : 0) + (project.id !== activeProjectId ? 1 : 0);
  const menuElement = (
    <div
      data-project-menu
      className="session-menu project-menu"
      style={getFloatingMenuPosition(menu.x, menu.y, 178, itemCount * 37 + 10)}
    >
      {project.id !== activeProjectId ? (
        <button
          onClick={() => {
            onSwitch(project);
            onClose();
          }}
        >
          <Check size={14} />
          {"\u8bbe\u4e3a\u5f53\u524d\u7a7a\u95f4"}
        </button>
      ) : null}
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

function getFloatingMenuPosition(x: number, y: number, width: number, height: number): CSSProperties {
  const viewportPadding = 8;
  const left = Math.min(Math.max(x, viewportPadding), window.innerWidth - width - viewportPadding);
  const top = Math.min(Math.max(y, viewportPadding), window.innerHeight - height - viewportPadding);
  return { left, top };
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

export function formatSessionTitle(title: string): string {
  return title === "New chat" ? "新对话" : title;
}
