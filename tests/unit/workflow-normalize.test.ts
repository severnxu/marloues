import { describe, it, expect } from "vitest";
import {
  normalizeWorkflowRawEvents,
  normalizeWorkflowItem,
  type WorkflowRawEvent,
} from "../../client/shared/workflow-normalize";

describe("workflow-normalize", () => {
  it("maps basic lifecycle events to a NormalizedTurn", () => {
    const events: WorkflowRawEvent[] = [
      {
        method: "item/started",
        params: { threadId: "th", turnId: "tu", item: { id: "a1", type: "agentMessage", text: "hello" } },
        receivedAt: 1,
      },
      { method: "turn/completed", params: { threadId: "th", turn: { id: "tu" } }, receivedAt: 2 },
    ];
    const turn = normalizeWorkflowRawEvents(events);
    expect(turn.threadId).toBe("th");
    expect(turn.turnId).toBe("tu");
    expect(turn.hasCompleted).toBe(true);
    expect(turn.hasFailed).toBe(false);
    expect(turn.items.some((entry) => entry.type === "agent_message" && entry.text === "hello")).toBe(true);
    expect(turn.methodCounts["item/started"]).toBe(1);
  });

  it("accumulates agentMessage deltas into finalText", () => {
    const events: WorkflowRawEvent[] = [
      { method: "item/agentMessage/delta", params: { itemId: "a1", delta: "Hello" }, receivedAt: 1 },
      { method: "item/agentMessage/delta", params: { itemId: "a1", delta: " world" }, receivedAt: 2 },
    ];
    const turn = normalizeWorkflowRawEvents(events);
    expect(turn.finalText).toBe("Hello world");
  });

  it("marks failed turns", () => {
    const turn = normalizeWorkflowRawEvents([{ method: "turn/failed", params: {}, receivedAt: 5 }]);
    expect(turn.hasFailed).toBe(true);
    expect(turn.hasCompleted).toBe(false);
  });

  it("normalizes command execution items", () => {
    const entry = normalizeWorkflowItem({ id: "c1", type: "shell", name: "shell", command: "ls -la", output: "ok" }, {}, "completed");
    expect(entry?.type).toBe("command_execution");
    expect(entry?.phase).toBe("completed");
    expect(entry?.status).toBe("completed");
  });

  it("normalizes reasoning items", () => {
    const entry = normalizeWorkflowItem({ id: "r1", type: "reasoning", text: "think" }, {}, "started");
    expect(entry?.type).toBe("reasoning");
    expect(entry?.status).toBe("in_progress");
  });

  it("ignores userMessage items", () => {
    expect(normalizeWorkflowItem({ id: "u1", type: "userMessage" }, {}, "started")).toBeNull();
  });

  it("counts unknown methods but ignores them", () => {
    const turn = normalizeWorkflowRawEvents([{ method: "something/else", params: { foo: 1 }, receivedAt: 1 }]);
    expect(turn.methodCounts["something/else"]).toBe(1);
    expect(turn.items).toHaveLength(0);
    expect(turn.hasCompleted).toBe(false);
  });

  it("merges started + updated + completed phases for the same item", () => {
    const events: WorkflowRawEvent[] = [
      {
        method: "item/started",
        params: { threadId: "th", turnId: "tu", item: { id: "c1", type: "shell", name: "shell" } },
        receivedAt: 1,
      },
      {
        method: "item/completed",
        params: { threadId: "th", turnId: "tu", item: { id: "c1", type: "shell", name: "shell", output: "done" } },
        receivedAt: 2,
      },
    ];
    const turn = normalizeWorkflowRawEvents(events);
    expect(turn.items).toHaveLength(1);
    expect(turn.items[0].type).toBe("command_execution");
  });
});
