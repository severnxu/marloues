import { afterEach, describe, expect, it } from "vitest";
import { workflowThreadStore } from "../../../../../client/main/core/runtime/workflow-thread-store";
import type { StoredMessage } from "../../../../../client/main/store";
import type { WorkflowTurnItem } from "../../../../../client/shared/workflow-read-thread-contract";

function makeUserMessage(id: string, text: string, ts = 1000): StoredMessage {
  return {
    id,
    role: "user",
    content: text,
    timestamp: ts,
    items: [],
  };
}

function makeAssistantMessage(
  id: string,
  text: string,
  ts: number,
  extras: Partial<StoredMessage> = {},
): StoredMessage {
  const items: WorkflowTurnItem[] = text
    ? [{ type: "agentMessage", id: `${id}-item`, text }]
    : [];
  return {
    id,
    role: "assistant",
    content: text,
    timestamp: ts,
    items,
    ...extras,
  };
}

const TEST_THREAD = "test-rehydrate-thread";

afterEach(() => {
  workflowThreadStore.deleteThread(TEST_THREAD);
});

describe("WorkflowThreadStore.rehydrateFromStoredMessages", () => {
  it("seeds turns from a user+assistant message pair", () => {
    const messages: StoredMessage[] = [
      makeUserMessage("u1", "Hello world", 1000),
      makeAssistantMessage("a1", "Hi there", 2000, {
        modelId: "gpt-4",
        modelName: "GPT-4",
        completedAt: 2000,
      }),
    ];

    workflowThreadStore.rehydrateFromStoredMessages(TEST_THREAD, messages);

    const snapshot = workflowThreadStore.readThread({
      threadId: TEST_THREAD,
      limit: 100,
    });

    expect(snapshot.turns).toHaveLength(1);
    const turn = snapshot.turns[0];
    expect(turn.status).toBe("completed");
    expect(turn.modelId).toBe("gpt-4");
    expect(turn.modelName).toBe("GPT-4");
    const itemTypes = turn.items.map((i) => i.type);
    expect(itemTypes).toContain("userMessage");
    expect(itemTypes).toContain("agentMessage");
  });

  it("seeds multiple conversation rounds in chronological order", () => {
    const messages: StoredMessage[] = [
      makeUserMessage("u1", "Question 1", 1000),
      makeAssistantMessage("a1", "Answer 1", 2000),
      makeUserMessage("u2", "Question 2", 3000),
      makeAssistantMessage("a2", "Answer 2", 4000),
    ];

    workflowThreadStore.rehydrateFromStoredMessages(TEST_THREAD, messages);

    const snapshot = workflowThreadStore.readThread({
      threadId: TEST_THREAD,
      limit: 100,
    });

    expect(snapshot.turns).toHaveLength(2);
    // Newest first: second turn on top
    expect(
      snapshot.turns[0].items.some(
        (i) => i.type === "userMessage" && i.id === "u2",
      ),
    ).toBe(true);
    expect(
      snapshot.turns[1].items.some(
        (i) => i.type === "userMessage" && i.id === "u1",
      ),
    ).toBe(true);
  });

  it("is idempotent — calling twice does not duplicate turns", () => {
    const messages: StoredMessage[] = [
      makeUserMessage("u1", "Hello", 1000),
      makeAssistantMessage("a1", "World", 2000),
    ];

    workflowThreadStore.rehydrateFromStoredMessages(TEST_THREAD, messages);
    workflowThreadStore.rehydrateFromStoredMessages(TEST_THREAD, messages);

    const snapshot = workflowThreadStore.readThread({
      threadId: TEST_THREAD,
      limit: 100,
    });

    expect(snapshot.turns).toHaveLength(1);
  });

  it("handles orphan assistant message without a preceding user", () => {
    const messages: StoredMessage[] = [
      makeAssistantMessage("a1", "I am an orphan", 1000, {
        modelId: "test-model",
      }),
    ];

    workflowThreadStore.rehydrateFromStoredMessages(TEST_THREAD, messages);

    const snapshot = workflowThreadStore.readThread({
      threadId: TEST_THREAD,
      limit: 100,
    });

    expect(snapshot.turns).toHaveLength(1);
    const turn = snapshot.turns[0];
    expect(turn.id).toBe("seed-a1");
    expect(turn.modelId).toBe("test-model");
    expect(turn.status).toBe("completed");
  });

  it("sets thread preview and updatedAt from the last message", () => {
    const messages: StoredMessage[] = [
      makeUserMessage("u1", "Hello", 1000),
      makeAssistantMessage("a1", "World response", 5000, {
        completedAt: 5000,
      }),
    ];

    workflowThreadStore.rehydrateFromStoredMessages(TEST_THREAD, messages, {
      title: "Test Session",
    });

    const snapshot = workflowThreadStore.readThread({
      threadId: TEST_THREAD,
      limit: 100,
    });

    expect(snapshot.thread.title).toBe("Test Session");
    expect(snapshot.thread.updatedAt).toBe(5000);
    expect(snapshot.thread.preview.length).toBeGreaterThan(0);
  });

  it("produces no turns for an empty message list", () => {
    workflowThreadStore.rehydrateFromStoredMessages(TEST_THREAD, []);

    const snapshot = workflowThreadStore.readThread({
      threadId: TEST_THREAD,
      limit: 100,
    });

    expect(snapshot.turns).toHaveLength(0);
  });

  it("uses userContent array when provided instead of plain content", () => {
    const messages: StoredMessage[] = [
      {
        id: "u1",
        role: "user",
        content: "",
        userContent: [{ type: "text", text: "Structured message" }],
        timestamp: 1000,
        items: [],
      },
      makeAssistantMessage("a1", "Reply", 2000),
    ];

    workflowThreadStore.rehydrateFromStoredMessages(TEST_THREAD, messages);

    const snapshot = workflowThreadStore.readThread({
      threadId: TEST_THREAD,
      limit: 100,
    });

    expect(snapshot.turns).toHaveLength(1);
    const userItem = snapshot.turns[0].items.find(
      (i) => i.type === "userMessage",
    );
    expect(userItem).toBeDefined();
    expect((userItem as { content: { text: string }[] }).content[0].text).toBe(
      "Structured message",
    );
  });

  it("marks turn as failed when assistant message has no items and no content", () => {
    const messages: StoredMessage[] = [
      makeUserMessage("u1", "Hello", 1000),
      {
        id: "a1",
        role: "assistant",
        content: "",
        timestamp: 2000,
        items: [],
      },
    ];

    workflowThreadStore.rehydrateFromStoredMessages(TEST_THREAD, messages);

    const snapshot = workflowThreadStore.readThread({
      threadId: TEST_THREAD,
      limit: 100,
    });

    expect(snapshot.turns).toHaveLength(1);
    expect(snapshot.turns[0].status).toBe("failed");
  });
});
