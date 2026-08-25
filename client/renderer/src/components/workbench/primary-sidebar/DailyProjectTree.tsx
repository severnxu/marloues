import { useMemo, useState } from "react";
import { MoreHorizontal, SquarePen } from "lucide-react";
import type { ChatSessionRecord, WorkspaceInfo } from "@shared/types";
import { workspacePathsEqual } from "@shared/workspace-path";
import type { Page } from "../types";
import * as SidebarParts from "./SidebarParts";
import { resolveSidebarActivity } from "./sidebar-activity";
import {
  getSidebarSessionWindow,
  SIDEBAR_SESSION_PAGE_SIZE,
} from "./sidebar-session-window";
import { WorkAreaProjectRow } from "./WorkAreaPrimitives";

export interface DailyProjectTreeProps {
  projectList: WorkspaceInfo[];
  activeWorkspace: WorkspaceInfo | null;
  sessionsByWorkspace: Map<string, ChatSessionRecord[]>;
  expandedWorkspaces: Set<string>;
  onToggleWorkspaceExpanded: (path: string) => void;
  runningSessionIds: Set<string>;
  runningWorkspacePaths: Set<string>;
  unreadCompletedSessionIds: Set<string>;
  activeSessionId: string | null;
  pendingPermissionSessionIdSet: Set<string>;
  renamingId: string | null;
  renameValue: string;
  onRenameValue: (value: string) => void;
  onCommitRename: (session: ChatSessionRecord) => void;
  onCancelRename: () => void;
  onOpenSessionMenu: (x: number, y: number, sessionId: string) => void;
  onOpenProjectMenu: (x: number, y: number, projectId: string) => void;
  onCreateProjectSession: (project: WorkspaceInfo) => void;
  onSwitchProject: (projectId: string) => Promise<void>;
  onSetActiveSession: (sessionId: string) => void;
  onTogglePinned: (session: ChatSessionRecord) => void;
  page: Page;
  onPage: (page: Page) => void;
}

export function DailyProjectTree(props: DailyProjectTreeProps) {
  const [sessionRenderLimits, setSessionRenderLimits] = useState<
    Record<string, number | undefined>
  >({});
  const prioritySessionIds = useMemo(
    () =>
      new Set([
        ...(props.activeSessionId ? [props.activeSessionId] : []),
        ...props.runningSessionIds,
        ...props.unreadCompletedSessionIds,
        ...props.pendingPermissionSessionIdSet,
      ]),
    [
      props.activeSessionId,
      props.pendingPermissionSessionIdSet,
      props.runningSessionIds,
      props.unreadCompletedSessionIds,
    ],
  );

  return (
    <>
      {props.projectList.map((project) => {
        const activeProject = Boolean(
          props.activeWorkspace &&
          (project.id === props.activeWorkspace.id ||
            workspacePathsEqual(project.path, props.activeWorkspace.path)),
        );
        const projectRunning = [...props.runningWorkspacePaths].some((path) =>
          workspacePathsEqual(path, project.path),
        );
        const sessions = (
          props.sessionsByWorkspace.get(project.path) || []
        ).filter((session) => !session.isPinned);
        const sessionWindow = getSidebarSessionWindow(
          sessions,
          sessionRenderLimits[project.path] ?? SIDEBAR_SESSION_PAGE_SIZE,
          prioritySessionIds,
        );
        const expanded = props.expandedWorkspaces.has(project.path);
        const activity = resolveSidebarActivity(
          sessions.some((session) =>
            props.unreadCompletedSessionIds.has(session.id),
          ),
          projectRunning,
        );

        return (
          <WorkAreaProjectRow
            key={project.id}
            name={project.name}
            title={project.path}
            expanded={expanded}
            activity={activity}
            onToggle={() => props.onToggleWorkspaceExpanded(project.path)}
            actions={
              <>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    const rect = event.currentTarget.getBoundingClientRect();
                    props.onOpenProjectMenu(
                      rect.left,
                      rect.bottom + 4,
                      project.id,
                    );
                  }}
                  title="项目操作"
                  aria-label="项目操作"
                >
                  <MoreHorizontal aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onCreateProjectSession(project);
                  }}
                  title="在此项目中新建会话"
                  aria-label="在此项目中新建会话"
                >
                  <SquarePen aria-hidden="true" />
                </button>
              </>
            }
          >
            {sessionWindow.sessions.map((session) => (
              <SidebarParts.SessionRow
                key={session.id}
                session={session}
                active={
                  session.id === props.activeSessionId && props.page === "chat"
                }
                executionRunning={props.runningSessionIds.has(session.id)}
                permissionPending={props.pendingPermissionSessionIdSet.has(
                  session.id,
                )}
                activity={resolveSidebarActivity(
                  props.unreadCompletedSessionIds.has(session.id),
                  props.runningSessionIds.has(session.id),
                )}
                renaming={props.renamingId === session.id}
                renameValue={props.renameValue}
                onRenameValue={props.onRenameValue}
                onCommitRename={props.onCommitRename}
                onCancelRename={props.onCancelRename}
                onOpen={async () => {
                  if (!activeProject) await props.onSwitchProject(project.id);
                  props.onSetActiveSession(session.id);
                  props.onPage("chat");
                }}
                onTogglePinned={() => props.onTogglePinned(session)}
                onOpenMenu={(x, y) => props.onOpenSessionMenu(x, y, session.id)}
              />
            ))}
            {sessionWindow.hiddenCount > 0 ? (
              <button
                className="workspace-sessions-more"
                type="button"
                onClick={() =>
                  setSessionRenderLimits((current) => ({
                    ...current,
                    [project.path]:
                      (current[project.path] ?? SIDEBAR_SESSION_PAGE_SIZE) +
                      SIDEBAR_SESSION_PAGE_SIZE,
                  }))
                }
              >
                显示更早会话（剩余 {sessionWindow.hiddenCount}）
              </button>
            ) : null}
          </WorkAreaProjectRow>
        );
      })}
    </>
  );
}

export function PinnedSessionGroup(props: DailyProjectTreeProps) {
  const pinnedSessions = useMemo(
    () =>
      Array.from(props.sessionsByWorkspace.values())
        .flat()
        .filter((session) => session.isPinned)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [props.sessionsByWorkspace],
  );

  if (pinnedSessions.length === 0) return null;

  return (
    <div className="work-area-section pinned-session-group">
      <div className="work-area-section-label">置顶</div>
      {pinnedSessions.map((session) => {
        const project = props.projectList.find((item) =>
          workspacePathsEqual(item.path, session.workspacePath),
        );
        const activeProject = Boolean(
          project &&
          props.activeWorkspace &&
          (project.id === props.activeWorkspace.id ||
            workspacePathsEqual(project.path, props.activeWorkspace.path)),
        );

        return (
          <SidebarParts.SessionRow
            key={session.id}
            session={session}
            showPinnedIndicator={false}
            active={
              session.id === props.activeSessionId && props.page === "chat"
            }
            executionRunning={props.runningSessionIds.has(session.id)}
            permissionPending={props.pendingPermissionSessionIdSet.has(
              session.id,
            )}
            activity={resolveSidebarActivity(
              props.unreadCompletedSessionIds.has(session.id),
              props.runningSessionIds.has(session.id),
            )}
            renaming={props.renamingId === session.id}
            renameValue={props.renameValue}
            onRenameValue={props.onRenameValue}
            onCommitRename={props.onCommitRename}
            onCancelRename={props.onCancelRename}
            onOpen={async () => {
              if (project && !activeProject)
                await props.onSwitchProject(project.id);
              props.onSetActiveSession(session.id);
              props.onPage("chat");
            }}
            onTogglePinned={() => props.onTogglePinned(session)}
            onOpenMenu={(x, y) => props.onOpenSessionMenu(x, y, session.id)}
          />
        );
      })}
    </div>
  );
}
