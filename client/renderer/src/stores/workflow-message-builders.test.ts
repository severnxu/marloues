import { describe, expect, it, vi } from "vitest";
import type { ChatSessionRecord } from "@shared/types";
import { useUnifiedChatStore } from "./unified-chat-store";
import {
  activeWorkflowMessages,
  clearWorkflowHistoryCache,
  getWorkflowHistoryCacheSize,
  mergeStreamingText,
  WORKFLOW_HISTORY_CACHE_LIMIT,
} from "./workflow-message-builders";

vi.hoisted(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      marloues: {},
      localStorage: {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
      },
    },
  });
});

describe("mergeStreamingText", () => {
  it("accepts deltas, cumulative snapshots, duplicates, and overlapping tails", () => {
    expect(mergeStreamingText("hello", " world")).toBe("hello world");
    expect(mergeStreamingText("hello", "hello world")).toBe("hello world");
    expect(mergeStreamingText("hello world", "world")).toBe("hello world");
    expect(mergeStreamingText("hello world", "world again")).toBe(
      "hello world again",
    );
  });
});

describe("workflow history cache", () => {
  it("keeps converted histories bounded across many visited sessions", () => {
    clearWorkflowHistoryCache();
    const now = Date.now();
    for (let index = 0; index < 100; index += 1) {
      const session: ChatSessionRecord = {
        id: `history-${index}`,
        title: `History ${index}`,
        createdAt: now,
        updatedAt: now,
        messages: [
          {
            id: `user-old-${index}`,
            role: "user",
            content: "old question",
            blocks: [],
            createdAt: now,
            items: [],
          },
          {
            id: `assistant-old-${index}`,
            role: "assistant",
            content: "old answer",
            blocks: [],
            createdAt: now,
            items: [],
          },
          {
            id: `user-current-${index}`,
            role: "user",
            content: "current question",
            blocks: [],
            createdAt: now,
            items: [],
          },
        ],
      };
      useUnifiedChatStore.setState({
        activeSessionId: session.id,
        sessions: [session],
        streamingSessionIds: {},
      });
      activeWorkflowMessages(useUnifiedChatStore.getState(), session);
    }

    expect(getWorkflowHistoryCacheSize()).toBe(WORKFLOW_HISTORY_CACHE_LIMIT);
  });
});
