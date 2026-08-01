import { describe, it, expect } from "vitest";
import {
  serializeWorkflowThread,
  type WorkflowThreadStoreThread,
} from "../../client/main/core/runtime/read-thread-serializer";
import type { WorkflowTurnItem } from "../../client/shared/workflow-read-thread-contract";

function item(id: string): WorkflowTurnItem {
  return { id } as WorkflowTurnItem;
}

function makeThread(): WorkflowThreadStoreThread {
  const turn = (id: string, itemIds: string[], overrides: Record<string, unknown> = {}) => ({
    id,
    status: "completed",
    error: null,
    startedAt: 100,
    completedAt: 200,
    durationMs: 100,
    modelId: "m-1",
    modelName: "Model One",
    itemOrder: itemIds,
    items: new Map(itemIds.map((itemId) => [itemId, { item: item(itemId) }])),
    ...overrides,
  });

  return {
    id: "thread-1",
    title: "T",
    preview: "p",
    status: { type: "active" },
    cwd: "/ws",
    createdAt: 1,
    updatedAt: 2,
    turnOrder: ["turn-1", "turn-2", "turn-3"],
    turns: new Map([
      ["turn-1", turn("turn-1", ["i1", "i2"])],
      ["turn-2", turn("turn-2", ["i3"])],
      ["turn-3", turn("turn-3", ["i4", "i5", "i6"])],
    ]),
  };
}

describe("read-thread-serializer", () => {
  it("serializes turns newest-first by default", () => {
    const result = serializeWorkflowThread(makeThread());
    expect(result.thread.id).toBe("thread-1");
    expect(result.page.order).toBe("newest_first");
    expect(result.turns.map((turn) => turn.id)).toEqual(["turn-3", "turn-2", "turn-1"]);
    expect(result.page.hasMore).toBe(false);
    expect(result.page.nextCursor).toBeNull();
  });

  it("respects limit and reports nextCursor when more turns remain", () => {
    const result = serializeWorkflowThread(makeThread(), { limit: 2 });
    expect(result.turns.map((turn) => turn.id)).toEqual(["turn-3", "turn-2"]);
    expect(result.page.hasMore).toBe(true);
    expect(result.page.nextCursor).toBe("2");
  });

  it("pages with cursor offset", () => {
    const result = serializeWorkflowThread(makeThread(), { limit: 1, cursor: "1" });
    expect(result.turns.map((turn) => turn.id)).toEqual(["turn-2"]);
    expect(result.page.nextCursor).toBe("2");
  });

  it("treats invalid cursor as zero", () => {
    const result = serializeWorkflowThread(makeThread(), { cursor: "abc" });
    expect(result.turns.map((turn) => turn.id)).toEqual(["turn-3", "turn-2", "turn-1"]);
  });

  it("preserves turn metadata", () => {
    const result = serializeWorkflowThread(makeThread());
    const turn = result.turns[2]; // turn-1
    expect(turn.status).toBe("completed");
    expect(turn.error).toBeNull();
    expect(turn.durationMs).toBe(100);
    expect(turn.modelId).toBe("m-1");
    expect(turn.modelName).toBe("Model One");
  });

  it("preserves item order per turn", () => {
    const result = serializeWorkflowThread(makeThread());
    const turn = result.turns[2];
    expect(turn.items.map((entry) => entry.id)).toEqual(["i1", "i2"]);
  });

  it("clamps limit to at least 1", () => {
    const result = serializeWorkflowThread(makeThread(), { limit: 0 });
    expect(result.turns).toHaveLength(1);
  });
});
