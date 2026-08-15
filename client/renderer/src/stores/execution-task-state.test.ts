import { describe, expect, it } from "vitest";
import type { UIEvent } from "@shared/ui-protocol";
import { upsertExecutionTask } from "./workflow-message-builders";

type TaskUpdate = Extract<UIEvent, { type: "execution.task.update" }>;

function taskUpdate(overrides: Partial<TaskUpdate> = {}): TaskUpdate {
  return {
    type: "execution.task.update",
    sessionId: "session-1",
    turnId: "turn-1",
    taskId: "task-1",
    title: "Analyze the project",
    detail: "Read the core source and summarize the architecture.",
    status: "creating",
    timestamp: 1,
    ...overrides,
  };
}

describe("upsertExecutionTask", () => {
  it("keeps creation-time copy while runtime events only change status", () => {
    const created = upsertExecutionTask({}, taskUpdate());
    const running = upsertExecutionTask(
      created,
      taskUpdate({
        title: "Reading docs\\implementation\\README.md",
        detail: "Last tool: Read",
        status: "running",
        timestamp: 2,
      }),
    );
    const completed = upsertExecutionTask(
      running,
      taskUpdate({
        title: "Task completed",
        detail: "output.txt",
        status: "completed",
        timestamp: 3,
      }),
    );

    expect(completed["session-1"]?.tasks["task-1"]).toMatchObject({
      title: "Analyze the project",
      detail: "Read the core source and summarize the architecture.",
      status: "completed",
      createdAt: 1,
      updatedAt: 3,
    });
  });
});
