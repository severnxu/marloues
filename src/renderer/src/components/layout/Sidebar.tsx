import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  Bot,
  ChevronRight,
  CircleDotDashed,
  Download,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
  LogOut,
  MonitorCog,
  MoreHorizontal,
  Package,
  Pencil,
  Pin,
  PlugZap,
  Plus,
  RefreshCcw,
  Search,
  ServerCog,
  Settings,
  ShieldCheck,
  ShieldOff,
  SquarePen,
  Trash2,
  UserRound,
  Wrench,
  LoaderCircle,
} from "lucide-react";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";
import { notify } from "@/lib/notifications";
import { useAuthStore } from "@/stores/auth-store";
import { useUnifiedChatStore } from "@/stores/unified-chat-store";
import { useThemeStore, type ThemeMode } from "@/stores/theme-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { Page, SettingsSection } from "@/components/layout/types";
import type { AuthSession, ChatSessionRecord, WorkspaceInfo } from "@shared/types";
import { workspacePathsEqual } from "@shared/workspace-path";
import { ProjectContextMenu, SessionContextMenu, SessionRow, UserInfoPopover, formatSessionTitle } from "@/components/layout/SidebarParts";

export function Sidebar({
  page,
  onPage,
  onOpenSettings,
  onOpenSearch,
  settingsSection,
  onSettingsSection,
}: {
  page: Page;
  onPage: (page: Page) => void;
  onOpenSettings: (section?: SettingsSection) => void;
  onOpenSearch: () => void;
  settingsSection: SettingsSection;
  onSettingsSection: (section: SettingsSection) => void;
}) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; sessionId: string } | null>(null);
  const [projectMenu, setProjectMenu] = useState<{ x: number; y: number; projectId: string } | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [projectOrder, setProjectOrder] = useState<string[]>([]);
  const { showConfirm, DialogComponent } = useConfirmDialog();
  const userMenuRef = useRef<HTMLDivElement>(null);
  const sessions = useUnifiedChatStore((state) => state.sessions);
  const activeSessionId = useUnifiedChatStore((state) => state.activeSessionId);
  const liveTurns = useUnifiedChatStore((state) => state.liveTurns);
  const setActiveSession = useUnifiedChatStore((state) => state.setActiveSession);
  const createSession = useUnifiedChatStore((state) => state.createSession);
  const loadChats = useUnifiedChatStore((state) => state.load);
  const deleteSession = useUnifiedChatStore((state) => state.deleteSession);
  const updateSessionTitle = useUnifiedChatStore((state) => state.updateSessionTitle);
  const toggleSessionPinned = useUnifiedChatStore((state) => state.toggleSessionPinned);
  const forkSession = useUnifiedChatStore((state) => state.forkSession);
  const workspace = useWorkspaceStore((state) => state.current);
  const workspaces = useWorkspaceStore((state) => state.settings.workspaces);
  const switchWorkspace = useWorkspaceStore((state) => state.switchWorkspace);
  const renameWorkspace = useWorkspaceStore((state) => state.renameWorkspace);
  const removeWorkspace = useWorkspaceStore((state) => state.removeWorkspace);
  const selectWorkspace = useWorkspaceStore((state) => state.select);
  const openInExplorer = useWorkspaceStore((state) => state.openInExplorer);
  const session = useAuthStore((state) => state.session);
  const logout = useAuthStore((state) => state.logout);
  const themeMode = useThemeStore((state) => state.mode);
  const setThemeMode = useThemeStore((state) => state.setMode);
  const displayName = session?.displayName || session?.username || session?.email || "Marloues User";
  const displayDetail = session?.email || workspace?.name || "未选择工作区";
  const avatarInitial = displayName.trim()[0]?.toUpperCase() || "N";
  const currentSessions = useMemo(
    () =>
      [...sessions]
        .sort(
          (a, b) => Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned)) || b.updatedAt - a.updatedAt,
        ),
    [sessions],
  );
  const workspaceItems = useMemo(() => {
    if (!workspace) return workspaces;
    return workspaces.some((item) => item.id === workspace.id || workspacePathsEqual(item.path, workspace.path))
      ? workspaces
      : [workspace, ...workspaces];
  }, [workspace, workspaces]);

  useEffect(() => {
    setProjectOrder((current) => {
      const ids = workspaceItems.map((item) => item.id);
      if (ids.length === 0) return [];
      const known = current.filter((id) => ids.includes(id));
      const added = ids.filter((id) => !known.includes(id));
      const next = [...known, ...added];
      return next.length === current.length && next.every((id, index) => id === current[index]) ? current : next;
    });
  }, [workspaceItems]);

  const projectList = useMemo(() => {
    const order = projectOrder.length ? projectOrder : workspaceItems.map((item) => item.id);
    return [...workspaceItems].sort((a, b) => {
      const left = order.indexOf(a.id);
      const right = order.indexOf(b.id);
      return (left === -1 ? Number.MAX_SAFE_INTEGER : left) - (right === -1 ? Number.MAX_SAFE_INTEGER : right);
    });
  }, [projectOrder, workspaceItems]);
  const runningSessionIds = useMemo(() => {
    return new Set(
      Object.entries(liveTurns)
        .filter(([, turn]) => turn?.status === "pending" || turn?.status === "running")
        .map(([sessionId]) => sessionId),
    );
  }, [liveTurns]);
  const runningWorkspacePaths = useMemo(() => {
    const paths = new Set<string>();
    for (const [sessionId, turn] of Object.entries(liveTurns)) {
      if (turn?.status !== "pending" && turn?.status !== "running") continue;
      const session = sessions.find((item) => item.id === sessionId);
      const path = turn.workspacePath ?? session?.workspacePath;
      if (path) paths.add(path);
    }
    return paths;
  }, [liveTurns, sessions]);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest("[data-session-menu]")) {
        setContextMenu(null);
      }
      if (!(event.target as HTMLElement).closest("[data-project-menu]")) {
        setProjectMenu(null);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  useEffect(() => {
    if (!userMenuOpen) return;

    const close = (event: MouseEvent) => {
      if (userMenuRef.current?.contains(event.target as Node)) return;
      if ((event.target as HTMLElement).closest("[data-sidebar-theme-menu]")) return;
      setUserMenuOpen(false);
    };

    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [userMenuOpen]);

  const startRename = (session: ChatSessionRecord) => {
    setRenamingId(session.id);
    setRenameValue(formatSessionTitle(session.title));
    setContextMenu(null);
  };

  const commitRename = (session: ChatSessionRecord) => {
    const title = renameValue.trim();
    if (!title) {
      setRenamingId(null);
      return;
    }
    if (title !== session.title) {
      void updateSessionTitle(session.id, title);
    }
    setRenamingId(null);
  };

  const removeSession = async (session: ChatSessionRecord) => {
    setContextMenu(null);
    const approved = await showConfirm({
      title: "删除会话？",
      message: `删除「${formatSessionTitle(session.title)}」后不可恢复。`,
      confirmLabel: "删除",
      variant: "danger",
    });
    if (!approved) return;
    await deleteSession(session.id);
  };

  const forkChat = async (session: ChatSessionRecord) => {
    setContextMenu(null);
    try {
      await forkSession(session.id);
      onPage("chat");
      notify({ title: "已分叉会话", description: formatSessionTitle(session.title), tone: "success" });
    } catch (error) {
      notify({
        title: "分叉失败",
        description: error instanceof Error ? error.message : String(error),
        tone: "error",
      });
    }
  };

  const exportSession = async (session: ChatSessionRecord) => {
    setContextMenu(null);
    try {
      const filePath = await window.marloues.chat.exportSession(session.id);
      if (!filePath) return;
      notify({ title: "Chat exported", description: filePath, tone: "success" });
    } catch (error) {
      notify({
        title: "Export failed",
        description: error instanceof Error ? error.message : String(error),
        tone: "error",
      });
    }
  };
  const switchProject = async (workspaceId: string) => {
    if (workspaceId === workspace?.id) return;
    await switchWorkspace(workspaceId);
    await loadChats();
    onPage("chat");
  };

  const createProjectSession = async (project: WorkspaceInfo) => {
    if (!workspace || (project.id !== workspace.id && !workspacePathsEqual(project.path, workspace.path))) {
      await switchWorkspace(project.id);
      await loadChats();
    }
    await createSession();
    onPage("chat");
  };

  const createCurrentWorkspaceSession = async () => {
    await createSession();
    onPage("chat");
  };

  const copyProjectPath = async (project: WorkspaceInfo) => {
    try {
      await navigator.clipboard.writeText(project.path);
      notify({ title: "Path copied", description: project.path, tone: "success" });
    } catch (error) {
      notify({
        title: "Copy failed",
        description: error instanceof Error ? error.message : String(error),
        tone: "error",
      });
    }
  };

  const renameProject = async (project: WorkspaceInfo) => {
    const nextName = window.prompt("Rename workspace", project.name)?.trim();
    if (!nextName || nextName === project.name) return;
    try {
      await renameWorkspace(project.id, nextName);
      notify({ title: "Workspace renamed", description: nextName, tone: "success" });
    } catch (error) {
      notify({
        title: "Rename failed",
        description: error instanceof Error ? error.message : String(error),
        tone: "error",
      });
    }
  };

  const removeProject = async (project: WorkspaceInfo) => {
    const approved = await showConfirm({
      title: "Remove workspace?",
      message: `Remove "${project.name}" from the workspace list. Files on disk will not be deleted.`,
      confirmLabel: "Remove",
      variant: "danger",
    });
    if (!approved) return;
    try {
      const wasActive = Boolean(workspace && (project.id === workspace.id || workspacePathsEqual(project.path, workspace.path)));
      await removeWorkspace(project.id);
      setProjectOrder((current) => current.filter((id) => id !== project.id));
      if (wasActive) await loadChats();
      notify({ title: "Workspace removed", description: project.name, tone: "success" });
    } catch (error) {
      notify({
        title: "Remove failed",
        description: error instanceof Error ? error.message : String(error),
        tone: "error",
      });
    }
  };

  const addWorkspace = async () => {
    await selectWorkspace();
    await loadChats();
    onPage("chat");
  };

  const moveProjectToTop = (projectId: string) => {
    setProjectOrder((current) => {
      const order = current.length ? current : workspaceItems.map((item) => item.id);
      return [projectId, ...order.filter((id) => id !== projectId)];
    });
    setProjectMenu(null);
  };

  const togglePinned = async (session: ChatSessionRecord) => {
    await toggleSessionPinned(session.id);
  };

  if (page === "settings") {
    const navItems = [
      { id: "general" as const, label: "通用", description: "运行行为与通知", icon: <Wrench size={16} /> },
      { id: "personalization" as const, label: "个性化", description: "回复风格与指令", icon: <Bot size={16} /> },
      { id: "appearance" as const, label: "外观", description: "主题和强调色", icon: <MonitorCog size={16} /> },
      { id: "providers" as const, label: "提供商", description: "端点与模型", icon: <ServerCog size={16} /> },
      { id: "mcp" as const, label: "MCP", description: "Server JSON", icon: <PlugZap size={16} /> },
      { id: "skills" as const, label: "Skills", description: "导入与详情", icon: <Package size={16} /> },
      { id: "audit" as const, label: "审计", description: "工具调用", icon: <FileText size={16} /> },
      { id: "runtime" as const, label: "Runtime", description: "运行限制", icon: <ShieldCheck size={16} /> },
      { id: "security" as const, label: "安全", description: "网络与脱敏", icon: <ShieldOff size={16} /> },
    ];

    return (
      <aside className="sidebar settings-sidebar">
        <div className="settings-side-top">
          <button onClick={() => onPage("chat")}>
            <ArrowLeft size={16} />
            返回对话
          </button>
        </div>
        <div className="settings-side-body">
          <div className="settings-side-label">
            <Settings size={14} />
            设置
          </div>
          <nav className="settings-side-nav">
            {navItems.map((item) => (
              <button
                key={item.id}
                className={settingsSection === item.id ? "active" : ""}
                onClick={() => onSettingsSection(item.id)}
              >
                {item.icon}
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </span>
              </button>
            ))}
          </nav>
        </div>
      </aside>
    );
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-panel">
        <nav className="sidebar-command-list" aria-label="主要操作">
          <button
            className="sidebar-command"
            onClick={() => {
              void createSession();
              onPage("chat");
            }}
          >
            <SquarePen size={15} />
            <span>新对话</span>
          </button>
          <button className="sidebar-command" onClick={onOpenSearch}>
            <Search size={15} />
            <span>搜索</span>
          </button>
          <button
            className="sidebar-command"
            onClick={() => {
              onOpenSettings("skills");
            }}
          >
            <CircleDotDashed size={15} />
            <span>插件</span>
          </button>
        </nav>

        <div className="sidebar-projects scrollbar-thin">
          <div className="sidebar-section-label">
            <span>工作空间</span>
            <button
              className="sidebar-section-label-action"
              type="button"
              onClick={() => void addWorkspace()}
              title="添加工作空间"
              aria-label="添加工作空间"
            >
              <Plus size={14} />
            </button>
          </div>
          {projectList.length === 0 ? <p className="session-empty">还没有项目</p> : null}
          {projectList.map((project) => {
            const activeProject = Boolean(
              workspace && (project.id === workspace.id || workspacePathsEqual(project.path, workspace.path)),
            );
            const projectRunning = [...runningWorkspacePaths].some((path) => workspacePathsEqual(path, project.path));
            return (
              <div className={`project-row ${activeProject ? "active" : ""} ${projectRunning ? "running" : ""}`} title={project.path} key={project.id}>
                <button
                  className="project-row-main"
                  type="button"
                  onClick={() => void switchProject(project.id)}
                  aria-current={activeProject ? "page" : undefined}
                >
                  {activeProject ? <FolderOpen size={15} /> : <Folder size={15} />}
                  <span className="project-row-name">{project.name}</span>
                </button>
                <div className="project-row-actions">
                  {projectRunning ? (
                    <span className="runtime-spinner project-runtime-spinner" title="空间内有运行中的会话" aria-label="空间内有运行中的会话">
                      <LoaderCircle size={14} />
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      const rect = event.currentTarget.getBoundingClientRect();
                      setProjectMenu({ x: rect.left, y: rect.bottom + 4, projectId: project.id });
                    }}
                    title="项目操作"
                    aria-label="项目操作"
                  >
                    <MoreHorizontal size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void createProjectSession(project);
                    }}
                    title="在此项目中新建会话"
                    aria-label="在此项目中新建会话"
                  >
                    <SquarePen size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="sidebar-sessions scrollbar-thin">
          <div className="sidebar-section-label">
            <span>会话列表</span>
            <button
              className="sidebar-section-label-action"
              type="button"
              onClick={() => void createCurrentWorkspaceSession()}
              title="添加新会话"
              aria-label="添加新会话"
            >
              <Plus size={14} />
            </button>
          </div>
          {currentSessions.length === 0
            ? <p className="session-empty">还没有对话</p>
            : null}
          {currentSessions.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              active={session.id === activeSessionId && page === "chat"}
              running={runningSessionIds.has(session.id)}
              renaming={renamingId === session.id}
              renameValue={renameValue}
              onRenameValue={setRenameValue}
              onCommitRename={commitRename}
              onCancelRename={() => setRenamingId(null)}
              onOpen={() => {
                setActiveSession(session.id);
                onPage("chat");
              }}
              onTogglePinned={() => void togglePinned(session)}
              onOpenMenu={(x, y) => setContextMenu({ x, y, sessionId: session.id })}
            />
          ))}
        </div>

        <div className="sidebar-user-dock" ref={userMenuRef}>
          {userMenuOpen ? (
            <UserInfoPopover
              workspaceName={workspace?.name}
              session={session}
              avatarInitial={avatarInitial}
              themeMode={themeMode}
              onSetThemeMode={setThemeMode}
              onSettings={(section) => {
                onOpenSettings(section);
                setUserMenuOpen(false);
              }}
              onLogout={() => {
                setUserMenuOpen(false);
                void logout();
              }}
            />
          ) : null}
          <button
            className={`sidebar-user-button ${userMenuOpen ? "active" : ""}`}
            type="button"
            onClick={() => setUserMenuOpen((open) => !open)}
            aria-haspopup="dialog"
            aria-expanded={userMenuOpen}
            title="用户信息"
          >
            <span className="sidebar-user-avatar" aria-hidden="true">
              {avatarInitial}
            </span>
            <span className="sidebar-user-copy">
              <strong>{displayName}</strong>
              <small>{displayDetail}</small>
            </span>
            <ChevronRight size={15} />
          </button>
        </div>
      </div>

      {contextMenu ? (
        <SessionContextMenu
          menu={contextMenu}
          sessions={sessions}
          onTogglePinned={(session) => {
            void togglePinned(session);
            setContextMenu(null);
          }}
          onRename={startRename}
          onFork={(session) => void forkChat(session)}
          onExport={exportSession}
          onDelete={(session) => void removeSession(session)}
        />
      ) : null}
      {projectMenu ? (
        <ProjectContextMenu
          menu={projectMenu}
          projects={projectList}
          firstProjectId={projectList[0]?.id}
          activeProjectId={workspace?.id}
          onSwitch={(project) => void switchProject(project.id)}
          onNewSession={(project) => void createProjectSession(project)}
          onOpen={(project) => void openInExplorer(project.id)}
          onCopyPath={(project) => void copyProjectPath(project)}
          onRename={(project) => void renameProject(project)}
          onMoveToTop={(project) => moveProjectToTop(project.id)}
          onRemove={(project) => void removeProject(project)}
          onClose={() => setProjectMenu(null)}
        />
      ) : null}
      {DialogComponent}
    </aside>
  );
}
