import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceInfo } from "@shared/types";
import { WorkAreaZone, type WorkAreaZoneProps } from "./WorkAreaZone";
import { formatSidebarTimestamp } from "./sidebar-work-areas";

const projects: WorkspaceInfo[] = [
  {
    id: "project-1",
    name: "marloues",
    path: "C:\\workspace\\marloues",
    lastOpenedAt: 1,
  },
];

describe("sidebar work area mapping", () => {
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
  it("renders the daily workspace without legacy generic roots", () => {
    const markup = renderToStaticMarkup(<WorkAreaZone {...createProps()} />);

    expect(markup).toContain("日常区");
    expect(markup).not.toContain("IM 空间");
    expect(markup).not.toContain(">工作空间<");
    expect(markup).toContain('data-work-area="daily"');
  });
});

function createProps(): WorkAreaZoneProps {
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
  };
}
