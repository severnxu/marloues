import type { ReactNode } from "react";
import type { ChatSessionRecord, WorkspaceInfo } from "@shared/types";
import * as SidebarParts from "./SidebarParts";

interface SessionMenu {
  x: number;
  y: number;
  sessionId: string;
}

interface ProjectMenu {
  x: number;
  y: number;
  projectId: string;
}

interface SidebarMenusProps {
  // Session context menu
  contextMenu: SessionMenu | null;
  allSessions: ChatSessionRecord[];
  onTogglePinned: (session: ChatSessionRecord) => void;
  onRename: (session: ChatSessionRecord) => void;
  onFork: (session: ChatSessionRecord) => void;
  onExportMarloues: (session: ChatSessionRecord) => void;
  onDelete: (session: ChatSessionRecord) => void;

  // Project context menu
  projectMenu: ProjectMenu | null;
  projectList: WorkspaceInfo[];
  onOpenInExplorer: (project: WorkspaceInfo) => void;
  onConfigureProject: (project: WorkspaceInfo) => void;
  onRenameProject: (project: WorkspaceInfo) => void;
  onMoveToTop: (projectId: string) => void;
  onRemoveProject: (project: WorkspaceInfo) => void;
  onCloseProjectMenu: () => void;

  // Confirm dialog
  confirmDialog: ReactNode;
}

export function SidebarMenus({
  contextMenu,
  allSessions,
  onTogglePinned,
  onRename,
  onFork,
  onExportMarloues,
  onDelete,
  projectMenu,
  projectList,
  onOpenInExplorer,
  onConfigureProject,
  onRenameProject,
  onMoveToTop,
  onRemoveProject,
  onCloseProjectMenu,
  confirmDialog,
}: SidebarMenusProps) {
  return (
    <>
      {contextMenu ? (
        <SidebarParts.SessionContextMenu
          menu={contextMenu}
          sessions={allSessions}
          onTogglePinned={onTogglePinned}
          onRename={onRename}
          onFork={onFork}
          onExportMarloues={onExportMarloues}
          onDelete={onDelete}
        />
      ) : null}
      {projectMenu ? (
        <SidebarParts.ProjectContextMenu
          menu={projectMenu}
          projects={projectList}
          firstProjectId={projectList[0]?.id}
          onOpen={onOpenInExplorer}
          onConfigure={onConfigureProject}
          onRename={onRenameProject}
          onMoveToTop={(project) => onMoveToTop(project.id)}
          onRemove={onRemoveProject}
          onClose={onCloseProjectMenu}
        />
      ) : null}
      {confirmDialog}
    </>
  );
}
