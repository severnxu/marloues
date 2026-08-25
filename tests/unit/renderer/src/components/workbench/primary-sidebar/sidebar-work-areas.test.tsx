import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useImStore } from "../../../../../../../client/renderer/src/stores/im-store";
import { useScheduleStore } from "../../../../../../../client/renderer/src/stores/schedule-store";
import type { RendererImSession } from "@shared/im/im-types";
import type {
  ChatSessionRecord,
  ScheduledTaskRecord,
  WorkspaceInfo,
} from "@shared/types";
import {
  WorkAreaZone,
  type WorkAreaZoneProps,
} from "../../../../../../../client/renderer/src/components/workbench/primary-sidebar/WorkAreaZone";
import {
  formatSidebarTimestamp,
  groupImSessions,
  groupScheduledTasks,
} from "../../../../../../../client/renderer/src/components/workbench/primary-sidebar/sidebar-work-areas";

const projects: WorkspaceInfo[] = [
  {
    id: "project-1",
    name: "marloues",
    path: "C:\\workspace\\marloues",
    lastOpenedAt: 1,
  },
];

const imSession: RendererImSession = {
  channel: "feishu",
  chatId: "chat-1",
  threadId: "thread-1",
  title: "[IM] 今日研发群摘要",
  workspacePath: projects[0].path,
  updatedAt: new Date(2026, 7, 9, 9, 12).getTime(),
};

const scheduledTask: ScheduledTaskRecord = {
  id: "task-1",
  name: "每日代码检查",
  instruction: "运行类型检查",
  workspacePath: projects[0].path,
  kind: "cron",
  cronExpr: "0 9 * * 1-5",
  enabled: true,
  createdAt: 1,
  updatedAt: 1,
};

describe("sidebar work area mapping", () => {
  beforeEach(() => {
    useImStore.setState({ statuses: {}, sessions: [], loaded: true });
    useScheduleStore.setState({ tasks: [], runs: {}, loaded: true });
  });

  it("groups IM sessions and scheduled tasks by their bound project", () => {
    expect(groupImSessions("feishu", [imSession], projects)).toEqual([
      {
        key: projects[0].path,
        name: "marloues",
        path: projects[0].path,
        items: [imSession],
      },
    ]);
    expect(groupScheduledTasks([scheduledTask], projects)[0].name).toBe(
      "marloues",
    );
  });

  it("formats recent timestamps with the compact sidebar vocabulary", () => {
    const now = new Date(2026, 7, 9, 18, 0).getTime();
    expect(
      formatSidebarTimestamp(new Date(2026, 7, 9, 9, 12).getTime(), now),
    ).toBe("09:12");
    expect(
      formatSidebarTimestamp(new Date(2026, 7, 8, 18, 0).getTime(), now),
    ).toBe("昨天");
  });
});

describe("WorkAreaZone", () => {
  beforeEach(() => {
    useImStore.setState({ statuses: {}, sessions: [], loaded: true });
    useScheduleStore.setState({ tasks: [], runs: {}, loaded: true });
  });

  it("renders the daily workspace without legacy generic roots", () => {
    const markup = renderToStaticMarkup(<WorkAreaZone {...createProps()} />);

    expect(markup).toContain("日常区");
    expect(markup).not.toContain("IM 空间");
    expect(markup).not.toContain(">工作空间<");
    expect(markup).toContain('data-work-area="daily"');
  });

  it("renders pinned sessions in a separate group before the daily area", () => {
    const pinned = createSession("pinned-session", "置顶会话", 2, true);
    const projectSession = createSession("project-session", "项目会话", 3);
    const markup = renderToStaticMarkup(
      <WorkAreaZone
        {...createProps({
          sessionsByWorkspace: new Map([
            [projects[0].path, [pinned, projectSession]],
          ]),
          expandedWorkspaces: new Set([projects[0].path]),
        })}
      />,
    );

    expect(markup.indexOf(">置顶<")).toBeLessThan(markup.indexOf(">日常区<"));
    expect(markup).not.toContain(">项目<");
    expect(markup.indexOf("置顶会话")).toBeLessThan(markup.indexOf("项目会话"));
    expect(countOccurrences(markup, "置顶会话")).toBe(1);
    expect(countOccurrences(markup, "项目会话")).toBe(1);
    expect(markup).not.toContain('aria-label="已置顶"');
  });
});

function createProps(
  overrides: Partial<WorkAreaZoneProps> = {},
): WorkAreaZoneProps {
  return {
    projectList: projects,
    activeWorkspace: projects[0],
    sessionsByWorkspace: new Map(),
    expandedWorkspaces: new Set(),
    onToggleWorkspaceExpanded: vi.fn(),
    runningSessionIds: new Set(),
    runningWorkspacePaths: new Set(),
    unreadCompletedSessionIds: new Set(),
    activeSessionId: null,
    pendingPermissionSessionIdSet: new Set(),
    renamingId: null,
    renameValue: "",
    onRenameValue: vi.fn(),
    onCommitRename: vi.fn(),
    onCancelRename: vi.fn(),
    onOpenSessionMenu: vi.fn(),
    onOpenProjectMenu: vi.fn(),
    onCreateProjectSession: vi.fn(),
    onSwitchProject: vi.fn().mockResolvedValue(undefined),
    onSetActiveSession: vi.fn(),
    onTogglePinned: vi.fn(),
    page: "chat",
    onPage: vi.fn(),
    onAddWorkspace: vi.fn(),
    ...overrides,
  };
}

function createSession(
  id: string,
  title: string,
  updatedAt: number,
  isPinned = false,
): ChatSessionRecord {
  return {
    id,
    title,
    workspacePath: projects[0].path,
    workspaceName: projects[0].name,
    createdAt: updatedAt,
    updatedAt,
    isPinned,
    messages: [],
  };
}

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}
