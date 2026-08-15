import { describe, expect, it } from "vitest";
import type { WorkflowMessageBlock } from "../../../../../shared/adapters/workflow-messages-to-read-thread";
import { buildTurnPresentationModel } from "./turn-presentation-model";

describe("buildTurnPresentationModel", () => {
  it("projects a completed turn into process, document, and result blocks", () => {
    const model = buildTurnPresentationModel(
      turn({
        items: [
          {
            type: "commandExecution",
            id: "command",
            command: "npm test",
            status: "completed",
          },
          {
            type: "fileChange",
            id: "changes",
            status: "completed",
            changes: [{ path: "src/app.ts", kind: "edit" }],
          },
          { type: "agentMessage", id: "answer", text: "All checks pass." },
        ],
      }),
      { isLastStreaming: false },
    );

    expect(model.runtime.kind).toBe("completed");
    expect(model.chrome.presentation.type).toBe("complete");
    expect(model.process.stepCount).toBe(2);
    expect(model.blocks.map((block) => block.kind)).toEqual([
      "process",
      "document",
      "results",
    ]);
    expect(model.documentText).toBe("All checks pass.");

    const process = model.blocks.find((block) => block.kind === "process");
    expect(process?.entries).toHaveLength(1);
    expect(process?.entries[0]?.kind).toBe("activityItem");

    const document = model.blocks.find((block) => block.kind === "document");
    expect(document?.itemIds).toEqual(["answer"]);
    expect(document?.tone).toBe("normal");
  });

  it("keeps live work separate from the streaming document", () => {
    const model = buildTurnPresentationModel(
      turn({
        status: "running",
        activity: "responding",
        items: [
          {
            type: "reasoning",
            id: "reasoning",
            summary: "Inspecting the workspace",
          },
          {
            type: "commandExecution",
            id: "command",
            command: "rg TODO",
            status: "running",
          },
          {
            type: "agentMessage",
            id: "answer",
            text: "I found the relevant path.",
            settled: false,
          },
        ],
      }),
      { isLastStreaming: true },
    );

    expect(model.runtime.kind).toBe("answering");
    expect(model.runtime.running).toBe(true);
    expect(model.process.hasActivityItems).toBe(true);
    expect(model.blocks.map((block) => block.kind)).toEqual([
      "process",
      "document",
    ]);
    expect(
      model.blocks.find((block) => block.kind === "document")?.streaming,
    ).toBe(true);
  });

  it("turns a failed final message into an error document", () => {
    const model = buildTurnPresentationModel(
      turn({
        status: "failed",
        activity: "failed",
        items: [
          {
            type: "agentMessage",
            id: "error",
            text: "Process exited with code 1",
          },
        ],
      }),
      { isLastStreaming: false },
    );

    expect(model.runtime.kind).toBe("failed");
    expect(model.chrome.presentation.type).toBe("failed");
    expect(model.blocks).toEqual([
      expect.objectContaining({ kind: "document", tone: "error" }),
    ]);
  });

  it("represents an empty live turn as a thinking state", () => {
    const model = buildTurnPresentationModel(
      turn({ status: "running", activity: "thinking", items: [] }),
      { isLastStreaming: true },
    );

    expect(model.runtime.kind).toBe("thinking");
    expect(model.chrome.presentation.type).toBe("thinking-empty");
    expect(model.blocks).toEqual([]);
  });

  it("keeps approvals and unknown legacy items in the process projection", () => {
    const model = buildTurnPresentationModel(
      turn({
        status: "running",
        activity: "running",
        items: [
          {
            type: "permissionRequest",
            id: "approval",
            toolName: "shell_command",
            reason: "Needs permission",
            status: "pending",
          },
          { type: "unknown", id: "legacy", rawType: "legacy.event", raw: {} },
        ],
      }),
      { isLastStreaming: true },
    );

    expect(model.process.stepCount).toBe(2);
    expect(model.process.hasActivityItems).toBe(true);
    expect(model.blocks[0]).toMatchObject({ kind: "process" });
  });

  it("keeps live file edits in process until they become settled results", () => {
    const model = buildTurnPresentationModel(
      turn({
        status: "running",
        activity: "running",
        items: [
          {
            type: "fileChange",
            id: "changes",
            status: "running",
            changes: [{ path: "src/app.ts", kind: "edit" }],
          },
        ],
      }),
      { isLastStreaming: true },
    );

    expect(model.blocks.map((block) => block.kind)).toEqual(["process"]);
    expect(model.process.hasActivityItems).toBe(true);
  });

  it("suppresses duplicate chrome for a continuation fragment", () => {
    const model = buildTurnPresentationModel(
      turn({
        continuesPreviousTurn: true,
        items: [{ type: "agentMessage", id: "answer", text: "Continuing." }],
      }),
      { isLastStreaming: false },
    );

    expect(model.runtime.continuesPreviousTurn).toBe(true);
    expect(model.runtime.showDuration).toBe(false);
    expect(model.chrome.presentation.type).toBe("continuation");
  });
});

function turn(patch: Partial<WorkflowMessageBlock> = {}): WorkflowMessageBlock {
  return {
    id: "turn-1",
    userMessageId: "user-1",
    user: "Implement the task",
    userContent: [{ type: "text", text: "Implement the task" }],
    status: "completed",
    activity: "done",
    startedAt: 100,
    completedAt: 1_100,
    durationMs: 1_000,
    items: [],
    ...patch,
  };
}
