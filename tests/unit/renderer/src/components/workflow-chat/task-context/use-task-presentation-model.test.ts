import { describe, expect, it } from "vitest";
import { resolveTaskWorkspace } from "../../../../../../../client/renderer/src/components/workflow-chat/task-context/use-task-presentation-model";

describe("resolveTaskWorkspace", () => {
  it("uses the active session workspace instead of the current workspace", () => {
    const workspace = resolveTaskWorkspace({
      activeSession: {
        id: "session-a",
        title: "Other space",
        workspacePath: "D:/projects/other",
        workspaceName: "other",
        createdAt: 1,
        updatedAt: 2,
        messages: [],
      },
      workspaceSettings: {
        currentWorkspaceId: "current",
        workspaces: [
          {
            id: "current",
            name: "current",
            path: "C:/workspace/current",
            lastOpenedAt: 1,
          },
          {
            id: "other",
            name: "other",
            path: "D:/projects/other",
            lastOpenedAt: 2,
          },
        ],
      },
      currentWorkspace: {
        id: "current",
        name: "current",
        path: "C:/workspace/current",
        lastOpenedAt: 1,
      },
    });

    expect(workspace?.id).toBe("other");
    expect(workspace?.path).toBe("D:/projects/other");
  });

  it("keeps an unlisted session workspace instead of falling back", () => {
    const workspace = resolveTaskWorkspace({
      activeSession: {
        id: "session-b",
        title: "Unlisted space",
        workspacePath: "E:/tmp/unlisted",
        createdAt: 1,
        updatedAt: 3,
        messages: [],
      },
      workspaceSettings: {
        currentWorkspaceId: "current",
        workspaces: [
          {
            id: "current",
            name: "current",
            path: "C:/workspace/current",
            lastOpenedAt: 1,
          },
        ],
      },
      currentWorkspace: {
        id: "current",
        name: "current",
        path: "C:/workspace/current",
        lastOpenedAt: 1,
      },
    });

    expect(workspace?.id).toBe("session-workspace:e:/tmp/unlisted");
    expect(workspace?.name).toBe("unlisted");
    expect(workspace?.path).toBe("E:/tmp/unlisted");
  });
});
