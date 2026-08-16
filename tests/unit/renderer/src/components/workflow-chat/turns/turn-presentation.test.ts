import { describe, expect, it } from "vitest";
import type { WorkflowMessageBlock } from "../../../../../../../client/shared/adapters/workflow-messages-to-read-thread";
import { workflowTurnLayout } from "../../../../../../../client/renderer/src/components/workflow-chat/turns/turn-layout";
import { workflowTurnPresentation } from "../../../../../../../client/renderer/src/components/workflow-chat/turns/turn-presentation";

function message(
  overrides: Partial<WorkflowMessageBlock> = {},
): WorkflowMessageBlock {
  return {
    id: "turn-1",
    user: "Initial request",
    userContent: [{ type: "text", text: "Initial request" }],
    status: "running",
    activity: "responding",
    durationMs: null,
    items: [
      {
        type: "agentMessage",
        id: "agent-1",
        text: "Response before steer.",
      },
    ],
    ...overrides,
  };
}

describe("workflowTurnPresentation", () => {
  it("keeps the Codex duration header on the first non-final slice", () => {
    const block = message({
      status: "completed",
      activity: "done",
      continuationFragment: true,
    });

    expect(
      workflowTurnPresentation(block, workflowTurnLayout(block), false),
    ).toEqual({
      type: "complete",
      showHeader: true,
      showThinkingPlaceholder: false,
    });
  });

  it("does not render a second header on the applied-steer continuation", () => {
    const block = message({ continuesPreviousTurn: true });

    expect(
      workflowTurnPresentation(block, workflowTurnLayout(block), false),
    ).toEqual({
      type: "continuation",
      showHeader: false,
      showThinkingPlaceholder: false,
    });
  });

  it("hides the duplicate header on an intermediate continuation slice", () => {
    const block = message({
      continuationFragment: true,
      continuesPreviousTurn: true,
    });

    expect(
      workflowTurnPresentation(block, workflowTurnLayout(block), false),
    ).toEqual({
      type: "continuation",
      showHeader: false,
      showThinkingPlaceholder: false,
    });
  });

  it("uses document-first completion UI for the segment closed by turn.complete", () => {
    const block = message({ status: "completed", activity: "done" });

    expect(
      workflowTurnPresentation(block, workflowTurnLayout(block), false),
    ).toEqual({
      type: "complete",
      showHeader: true,
      showThinkingPlaceholder: false,
    });
  });
});
