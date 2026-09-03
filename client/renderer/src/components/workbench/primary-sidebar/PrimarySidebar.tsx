import { useEffect, useMemo, useState } from "react";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";
import { notify } from "@/lib/notifications";
import { useUnifiedChatStore } from "@/stores/unified-chat-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { Page } from "../types";
import type { ChatSessionRecord, WorkspaceInfo } from "@shared/types";
import { STRINGS } from "@shared/strings.zh";
import { workspacePathsEqual } from "@shared/workspace-path";
import * as SidebarParts from "./SidebarParts";
import { QuickAccessZone } from "./QuickAccessZone";
import { SidebarUserDock } from "./SidebarUserDock";
import { WorkAreaZone } from "./WorkAreaZone";
import { SidebarMenus } from "./SidebarMenus";
import { ProjectConfigDialog } from "./ProjectConfigDialog";

export function PrimarySidebar({
  page,
  onPage,
  isMacOS,
  pendingPermissionSessionIds = [],
}: {
  page: Page;
  onPage: (page: Page) => void;
  isMacOS: boolean;
  pendingPermissionSessionIds?: readonly string[];
}) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    sessionId: string;
  } | null>(null);
  const [projectMenu, setProjectMenu] = useState<{
    x: number;
    y: number;
    projectId: string;
  } | null>(null);
  const [projectOrder, setProjectOrder] = useState<string[]>([]);
  const [configuringProject, setConfiguringProject] =
    useState<WorkspaceInfo | null>(null);
  const [addProjectOpen, setAddProjectOpen] = useState(false);

  const expandedWorkspaces = useWorkspaceStore(
    (state) => state.expandedWorkspaces,
  );
  const toggleWorkspaceExpanded = useWorkspaceStore(
    (state) => state.toggleWorkspaceExpanded,
  );
  const expandWorkspace = useWorkspaceStore((state) => state.expandWorkspace);
  const { showConfirm, DialogComponent } = useConfirmDialog();

  const activeSessionId = useUnifiedChatStore((state) => state.activeSessionId);
  const unreadCompletedSessionIds = useUnifiedChatStore(
    (state) => state.unreadCompletedSessionIds,
  );
  const setActiveSession = useUnifiedChatStore(
    (state) => state.setActiveSession,
  );
  const createSession = useUnifiedChatStore((state) => state.createSession);
  const loadChats = useUnifiedChatStore((state) => state.load);
  const deleteSession = useUnifiedChatStore((state) => state.deleteSession);
  const updateSessionTitle = useUnifiedChatStore(
    (state) => state.updateSessionTitle,
  );
  const toggleSessionPinned = useUnifiedChatStore(
    (state) => state.toggleSessionPinned,
  );
  const forkSession = useUnifiedChatStore((state) => state.forkSession);
  const allSessions = useUnifiedChatStore((state) => state.allSessions);

  const streamingSessionIds = useUnifiedChatStore(
    (state) => state.streamingSessionIds,
  );

  const { runningSessionIds, runningWorkspacePaths } = useMemo(() => {
    const sessionWorkspaceById = new Map(
      allSessions.map((session) => [session.id, session.workspacePath]),
    );
    const sessionIds = new Set<string>();
    const workspacePaths = new Set<string>();
    for (const sessionId of Object.keys(streamingSessionIds)) {
      if (!streamingSessionIds[sessionId]) continue;
      sessionIds.add(sessionId);
      const path = sessionWorkspaceById.get(sessionId);
      if (path) workspacePaths.add(path);
    }
    return {
      runningSessionIds: sessionIds,
      runningWorkspacePaths: workspacePaths,
    };
  }, [allSessions, streamingSessionIds]);

  const loadAllSessions = useUnifiedChatStore((state) => state.loadAllSessions);
  const workspace = useWorkspaceStore((state) => state.current);
  const workspaces = useWorkspaceStore((state) => state.settings.workspaces);
  const switchWorkspace = useWorkspaceStore((state) => state.switchWorkspace);
  const renameWorkspace = useWorkspaceStore((state) => state.renameWorkspace);
  const removeWorkspace = useWorkspaceStore((state) => state.removeWorkspace);
  const openInExplorer = useWorkspaceStore((state) => state.openInExplorer);

  const workspaceItems = useMemo(() => {
    if (!workspace) return workspaces;
    return workspaces.some(
      (item) =>
        item.id === workspace.id ||
        workspacePathsEqual(item.path, workspace.path),
    )
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
      return next.length === current.length &&
        next.every((id, index) => id === current[index])
        ? current
        : next;
    });
  }, [workspaceItems]);

  const projectList = useMemo(() => {
    const order = projectOrder.length
      ? projectOrder
      : workspaceItems.map((item) => item.id);
    return [...workspaceItems].sort((a, b) => {
      const left = order.indexOf(a.id);
      const right = order.indexOf(b.id);
      return (
        (left === -1 ? Number.MAX_SAFE_INTEGER : left) -
        (right === -1 ? Number.MAX_SAFE_INTEGER : right)
      );
    });
  }, [projectOrder, workspaceItems]);

  // Load all sessions once on mount and whenever the set of known workspace
  // paths changes (a workspace was added or removed). It does NOT refetch on
  // workspace switch: the tree reads this list directly and the store keeps it
  // in sync incrementally on create/delete/rename/pin/turn events, so a plain
  // switch is just a pointer change with no list refresh.
  const workspacePathKey = useMemo(
    () =>
      workspaces
        .map((item) => item.path)
        .slice()
        .sort()
        .join("\n"),
    [workspaces],
  );
  useEffect(() => {
    if (!workspacePathKey) return;
    void loadAllSessions();
  }, [workspacePathKey, loadAllSessions]);

  useEffect(() => {
    const unsubscribe = window.marloues.im?.onSessionsChanged?.(() => {
      void loadAllSessions();
    });
    return () => {
      unsubscribe?.();
    };
  }, [loadAllSessions]);

  // Group sessions by workspace path.
  const sessionsByWorkspace = useMemo(() => {
    const map = new Map<string, ChatSessionRecord[]>();
    for (const session of allSessions) {
      const key = session.workspacePath || "";
      const list = map.get(key);
      if (list) list.push(session);
      else map.set(key, [session]);
    }
    // Sort each group: pinned first, then by updatedAt desc.
    for (const list of map.values()) {
      list.sort(
        (a, b) =>
          Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned)) ||
          b.updatedAt - a.updatedAt,
      );
    }
    return map;
  }, [allSessions]);

  // Auto-expand current workspace.
  useEffect(() => {
    if (!workspace) return;
    expandWorkspace(workspace.path);
  }, [workspace, expandWorkspace]);

  const pendingPermissionSessionIdSet = useMemo(
    () => new Set(pendingPermissionSessionIds),
    [pendingPermissionSessionIds],
  );

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

  const startRename = (session: ChatSessionRecord) => {
    setRenamingId(session.id);
    setRenameValue(SidebarParts.formatSessionTitle(session.title));
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
      title: STRINGS.system.session.confirmRemoveTitle,
      message: STRINGS.system.session.confirmRemoveMessage(
        SidebarParts.formatSessionTitle(session.title),
      ),
      confirmLabel: STRINGS.system.session.confirmRemoveConfirmLabel,
      variant: "danger",
    });
    if (!approved) return;
    try {
      await deleteSession(session.id);
    } catch {
      // deleteSession already reports the error.
    }
  };

  const forkChat = async (session: ChatSessionRecord) => {
    setContextMenu(null);
    try {
      await forkSession(session.id);
      onPage("chat");
      notify({
        title: STRINGS.system.session.forkedSuccessTitle,
        description: SidebarParts.formatSessionTitle(session.title),
        tone: "success",
      });
    } catch (error) {
      notify({
        title: STRINGS.system.session.forkFailedTitle,
        description: error instanceof Error ? error.message : String(error),
        tone: "error",
      });
    }
  };

  const exportSessionAsMarloues = async (session: ChatSessionRecord) => {
    setContextMenu(null);
    try {
      const filePath = await window.marloues.chat.exportSession(session.id);
      if (!filePath) return;
      notify({
        title: "会话已导出",
        description: filePath,
        tone: "success",
      });
    } catch (error) {
      notify({
        title: STRINGS.system.session.exportFailedTitle,
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
    if (
      !workspace ||
      (project.id !== workspace.id &&
        !workspacePathsEqual(project.path, workspace.path))
    ) {
      await switchWorkspace(project.id);
      await loadChats();
    }
    await createSession();
    onPage("chat");
  };

  const renameProject = async (project: WorkspaceInfo) => {
    const nextName = window.prompt("Rename workspace", project.name)?.trim();
    if (!nextName || nextName === project.name) return;
    try {
      await renameWorkspace(project.id, nextName);
      notify({
        title: "Workspace renamed",
        description: nextName,
        tone: "success",
      });
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
      title: STRINGS.system.workspace.confirmRemoveTitle,
      message: STRINGS.system.workspace.confirmRemoveMessage(project.name),
      confirmLabel: STRINGS.system.workspace.confirmRemoveConfirmLabel,
      variant: "danger",
    });
    if (!approved) return;
    try {
      const wasActive = Boolean(
        workspace &&
        (project.id === workspace.id ||
          workspacePathsEqual(project.path, workspace.path)),
      );
      await removeWorkspace(project.id);
      setProjectOrder((current) => current.filter((id) => id !== project.id));
      if (wasActive) await loadChats();
      notify({
        title: STRINGS.system.workspace.removeSuccessTitle,
        description: project.name,
        tone: "success",
      });
    } catch (error) {
      notify({
        title: STRINGS.system.workspace.removeFailedTitle,
        description: error instanceof Error ? error.message : String(error),
        tone: "error",
      });
    }
  };

  const handleWorkspaceAdded = async () => {
    await loadChats();
    onPage("chat");
  };

  const moveProjectToTop = (projectId: string) => {
    setProjectOrder((current) => {
      const order = current.length
        ? current
        : workspaceItems.map((item) => item.id);
      return [projectId, ...order.filter((id) => id !== projectId)];
    });
    setProjectMenu(null);
  };

  const togglePinned = async (session: ChatSessionRecord) => {
    await toggleSessionPinned(session.id);
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-panel">
        <QuickAccessZone
          page={page}
          isMacOS={isMacOS}
          onNewConversation={async () => {
            await createSession();
            onPage("chat");
          }}
          onPage={onPage}
        />

        <WorkAreaZone
          onAddWorkspace={() => setAddProjectOpen(true)}
          projectList={projectList}
          activeWorkspace={workspace}
          sessionsByWorkspace={sessionsByWorkspace}
          expandedWorkspaces={expandedWorkspaces}
          onToggleWorkspaceExpanded={toggleWorkspaceExpanded}
          runningSessionIds={runningSessionIds}
          runningWorkspacePaths={runningWorkspacePaths}
          unreadCompletedSessionIds={unreadCompletedSessionIds}
          activeSessionId={activeSessionId}
          pendingPermissionSessionIdSet={pendingPermissionSessionIdSet}
          renamingId={renamingId}
          renameValue={renameValue}
          onRenameValue={setRenameValue}
          onCommitRename={commitRename}
          onCancelRename={() => setRenamingId(null)}
          onOpenSessionMenu={(x, y, sessionId) =>
            setContextMenu({ x, y, sessionId })
          }
          onOpenProjectMenu={(x, y, projectId) =>
            setProjectMenu({ x, y, projectId })
          }
          onCreateProjectSession={(project) =>
            void createProjectSession(project)
          }
          onSwitchProject={switchProject}
          onSetActiveSession={setActiveSession}
          onTogglePinned={togglePinned}
          page={page}
          onPage={onPage}
        />

        <SidebarUserDock />
      </div>

      <SidebarMenus
        contextMenu={contextMenu}
        allSessions={allSessions}
        onTogglePinned={(session) => {
          void togglePinned(session);
          setContextMenu(null);
        }}
        onRename={startRename}
        onFork={(session) => void forkChat(session)}
        onExportMarloues={exportSessionAsMarloues}
        onDelete={(session) => void removeSession(session)}
        projectMenu={projectMenu}
        projectList={projectList}
        onOpenInExplorer={(project) => void openInExplorer(project.id)}
        onConfigureProject={setConfiguringProject}
        onRenameProject={(project) => void renameProject(project)}
        onMoveToTop={(projectId) => moveProjectToTop(projectId)}
        onRemoveProject={(project) => void removeProject(project)}
        onCloseProjectMenu={() => setProjectMenu(null)}
        confirmDialog={DialogComponent}
      />
      {configuringProject ? (
        <ProjectConfigDialog
          project={configuringProject}
          onClose={() => setConfiguringProject(null)}
        />
      ) : null}
      {addProjectOpen ? (
        <ProjectConfigDialog
          mode="create"
          onClose={() => setAddProjectOpen(false)}
          onAdded={() => void handleWorkspaceAdded()}
        />
      ) : null}
    </aside>
  );
}
