import { describe, expect, it } from "vitest";
import {
  nextWorkflowTurnCollapseState,
  workflowTurnCollapseStateKey,
  type WorkflowTurnCollapseRuntimeState,
} from "./turn-collapse-state";

const scope = "session-1";

describe("nextWorkflowTurnCollapseState", () => {
  it("keeps the latest completed turn expanded by default", () => {
    const result = nextWorkflowTurnCollapseState({
      collapsedTurnsById: {},
      isStreaming: false,
      previousRuntimeByKey: new Map(),
      scope,
      workflowMessages: [
        { id: "latest", activity: "done", status: "completed" },
      ],
      defaultExpandedMessageId: "latest",
    });

    expect(result.collapsedTurnsById).toEqual({});
  });

  it("does not collapse the latest turn when streaming completes", () => {
    const key = workflowTurnCollapseStateKey(scope, "latest");
    const previousRuntimeByKey = new Map<
      string,
      WorkflowTurnCollapseRuntimeState
    >([
      [
        key,
        { activity: "responding", status: "running", isLastStreaming: true },
      ],
    ]);

    const result = nextWorkflowTurnCollapseState({
      collapsedTurnsById: {},
      isStreaming: false,
      previousRuntimeByKey,
      scope,
      workflowMessages: [
        { id: "latest", activity: "done", status: "completed" },
      ],
      defaultExpandedMessageId: "latest",
    });

    expect(result.collapsedTurnsById).toEqual({});
  });

  it("collapses an older turn after its runtime completes", () => {
    const olderKey = workflowTurnCollapseStateKey(scope, "older");
    const previousRuntimeByKey = new Map<
      string,
      WorkflowTurnCollapseRuntimeState
    >([
      [
        olderKey,
        { activity: "responding", status: "running", isLastStreaming: false },
      ],
    ]);

    const result = nextWorkflowTurnCollapseState({
      collapsedTurnsById: {},
      isStreaming: false,
      previousRuntimeByKey,
      scope,
      workflowMessages: [
        { id: "older", activity: "done", status: "completed" },
        { id: "latest", activity: "done", status: "completed" },
      ],
      defaultExpandedMessageId: "latest",
    });

    expect(result.collapsedTurnsById).toEqual({ [olderKey]: true });
  });

  it("preserves an explicit expanded state after runtime completion", () => {
    const olderKey = workflowTurnCollapseStateKey(scope, "older");
    const previousRuntimeByKey = new Map<
      string,
      WorkflowTurnCollapseRuntimeState
    >([
      [
        olderKey,
        { activity: "responding", status: "running", isLastStreaming: false },
      ],
    ]);

    const result = nextWorkflowTurnCollapseState({
      collapsedTurnsById: { [olderKey]: false },
      isStreaming: false,
      previousRuntimeByKey,
      scope,
      workflowMessages: [
        { id: "older", activity: "done", status: "completed" },
        { id: "latest", activity: "done", status: "completed" },
      ],
      defaultExpandedMessageId: "latest",
    });

    expect(result.collapsedTurnsById).toEqual({ [olderKey]: false });
  });
});
