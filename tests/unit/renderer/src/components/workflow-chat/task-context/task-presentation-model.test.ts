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
        {
          id: "agent",
          type: "agentMessage",
          text: "已修复固定摘要按钮，并保留辅助区展开按钮的原有逻辑。",
          phase: "final_answer",
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
      securityMode: "request",
    });
    expect(model.hasData).toBe(true);
    expect(model.outputContent[0]).toMatchObject({
      label: "最终回复",
      detail: "已修复固定摘要按钮，并保留辅助区展开按钮的原有逻辑。",
    });
    expect(model.changes).toMatchObject({
      filesChanged: 1,
      insertions: 1,
      deletions: 1,
    });
    expect(model.processes[0]?.command).toBe("npm test");
    expect(model.sources[0]).toMatchObject({ kind: "web", count: 1 });
  });

  it("keeps the summary surface available for an active empty session", () => {
    const model = buildTaskPresentationModel({
      sessionId: "empty",
      workspace: {
        id: "tmp",
        name: "tmp",
        path: "C:/tmp",
        lastOpenedAt: 1,
      },
      fallbackModelName: "fallback-model",
      securityMode: "request",
    });

    expect(model.hasData).toBe(true);
    expect(model.workspace?.path).toBe("C:/tmp");
    expect(model.changes).toBeNull();
    expect(model.modelName).toBe("fallback-model");
    expect(model.outputContent).toHaveLength(0);
    expect(model.tasks).toHaveLength(0);
  });

  it("does not treat command output or file diffs as output content", () => {
    const model = buildTaskPresentationModel({
      sessionId: "session-1",
      readThread: {
        ...readThread,
        turns: [
          {
            ...readThread.turns[0],
            items: readThread.turns[0].items.filter(
              (item) => item.type !== "agentMessage",
            ),
          },
        ],
      },
    });

    expect(model.outputContent).toHaveLength(0);
    expect(model.changes?.filesChanged).toBe(1);
    expect(model.processes[0]?.command).toBe("npm test");
  });

  it("uses Codex summary-selected agent output rules", () => {
    const model = buildTaskPresentationModel({
      sessionId: "session-1",
      readThread: {
        ...readThread,
        turns: [
          {
            ...readThread.turns[0],
            items: [
              {
                id: "commentary",
                type: "agentMessage",
                text: "处理中间说明",
                phase: "commentary",
              },
              {
                id: "unknown",
                type: "agentMessage",
                text: "兼容旧模型回复",
              },
              {
                id: "final",
                type: "agentMessage",
                text: "最终输出",
                phase: "final_answer",
              },
            ],
          },
        ],
      },
    });

    expect(model.outputContent[0]?.detail).toBe("最终输出");
  });

  it("uses the last unknown-phase agent message as summary output", () => {
    const model = buildTaskPresentationModel({
      sessionId: "session-1",
      readThread: {
        ...readThread,
        turns: [
          {
            ...readThread.turns[0],
            items: [
              {
                id: "first",
                type: "agentMessage",
                text: "第一条",
              },
              {
                id: "commentary",
                type: "agentMessage",
                text: "中间说明",
                phase: "commentary",
              },
              {
                id: "last",
                type: "agentMessage",
                text: "最后一条旧模型回复",
              },
            ],
          },
        ],
      },
    });

    expect(model.outputContent[0]?.detail).toBe("最后一条旧模型回复");
  });

  it("uses the last summary-eligible agent message", () => {
    const model = buildTaskPresentationModel({
      sessionId: "session-1",
      readThread: {
        ...readThread,
        turns: [
          {
            ...readThread.turns[0],
            items: [
              {
                id: "final",
                type: "agentMessage",
                text: "显式最终输出",
                phase: "final_answer",
              },
              {
                id: "later",
                type: "agentMessage",
                text: "后续兼容输出",
              },
            ],
          },
        ],
      },
    });

    expect(model.outputContent[0]?.detail).toBe("后续兼容输出");
  });

  it("does not show commentary-only messages as output content", () => {
    const model = buildTaskPresentationModel({
      sessionId: "session-1",
      readThread: {
        ...readThread,
        turns: [
          {
            ...readThread.turns[0],
            items: [
              {
                id: "commentary",
                type: "agentMessage",
                text: "这里只是中间说明",
                phase: "commentary",
              },
            ],
          },
        ],
      },
    });

    expect(model.outputContent).toHaveLength(0);
  });

  it("hides the surface when no session is active", () => {
    const model = buildTaskPresentationModel({ sessionId: null });
    expect(model.hasData).toBe(false);
  });
});
