import { describe, expect, it } from "vitest";
import type { WorkflowReadThreadResponse } from "@shared/workflow-read-thread-contract";
import { buildTaskPresentationModel } from "../../../../../../../client/renderer/src/components/workflow-chat/task-context/task-presentation-model";

const readThread: WorkflowReadThreadResponse = {
  schemaVersion: 2,
  thread: {
    id: "thread-1",
    title: "Build context panel",
    preview: "Build context panel",
    status: { type: "active", activeFlags: {} },
    cwd: "C:/workspace/marloues",
    createdAt: 1,
    updatedAt: 2,
  },
  page: { order: "newest_first", limit: 1, nextCursor: null, hasMore: false },
  turns: [
    {
      id: "turn-1",
      zone: "workspace",
      status: "running",
      error: null,
      startedAt: 1,
      completedAt: null,
      durationMs: null,
      modelName: "Marloues 5",
      items: [
        {
          id: "user",
          type: "userMessage",
          content: [{ type: "text", text: "go" }],
        },
        {
          id: "cmd",
          type: "commandExecution",
          command: "npm test",
          status: "running",
        },
        { id: "web", type: "webSearch", query: "Codex task context" },
        {
          id: "change",
          type: "fileChange",
          status: "completed",
          changes: [
            {
              path: "src/app.ts",
              kind: "update",
              diff: { text: "+one\n-two" },
            },
          ],
        },
      ],
    },
  ],
};

describe("buildTaskPresentationModel", () => {
  it("projects only task-relevant context", () => {
    const model = buildTaskPresentationModel({
      sessionId: "session-1",
      readThread,
      workspace: {
        id: "ws",
        name: "marloues",
        path: "C:/workspace/marloues",
        lastOpenedAt: 1,
      },
      permissionMode: "default",
    });
    expect(model.hasData).toBe(true);
    expect(model.changes).toMatchObject({
      filesChanged: 1,
      insertions: 1,
      deletions: 1,
    });
    expect(model.processes[0]?.command).toBe("npm test");
    expect(model.sources[0]).toMatchObject({ kind: "web", count: 1 });
  });

  it("hides the surface when a session has no task data", () => {
    const model = buildTaskPresentationModel({ sessionId: "empty" });
    expect(model.hasData).toBe(false);
    expect(model.workspace).toBeNull();
  });
});
