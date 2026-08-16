import { describe, expect, it } from "vitest";
import { workflowTurnDurationLabel } from "../../../../../../../client/renderer/src/components/workflow-chat/turns/turn-status";

describe("workflowTurnDurationLabel", () => {
  it("floors partial seconds consistently with the Codex timer", () => {
    expect(workflowTurnDurationLabel(4_001)).toBe("4秒");
    expect(workflowTurnDurationLabel(4_999)).toBe("4秒");
  });

  it("preserves sub-second, exact-second, and minute boundaries", () => {
    expect(workflowTurnDurationLabel(0)).toBe("");
    expect(workflowTurnDurationLabel(999)).toBe("1秒");
    expect(workflowTurnDurationLabel(5_000)).toBe("5秒");
    expect(workflowTurnDurationLabel(60_000)).toBe("1分钟");
  });

  it("rounds a running timer up to avoid showing zero seconds", () => {
    expect(workflowTurnDurationLabel(1_001, { running: true })).toBe("2秒");
  });

  it("omits the label only when no duration is available", () => {
    expect(workflowTurnDurationLabel(null)).toBe("");
  });
});
