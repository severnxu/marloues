import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowReadThreadResponse } from "@shared/workflow-read-thread-contract";
import {
  READ_THREAD_CACHE_LIMIT,
  useUnifiedChatStore,
} from "../../../../../client/renderer/src/stores/unified-chat-store";

vi.hoisted(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      marloues: { chat: {} },
      localStorage: {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
      },
    },
  });
});

function snapshot(sessionId: string): WorkflowReadThreadResponse {
  return {
    schemaVersion: 2,
    thread: {
      id: sessionId,
      title: sessionId,
      preview: "",
      status: { type: "idle" },
    },
    page: {
      order: "newest_first",
      limit: 50,
      nextCursor: null,
      hasMore: false,
    },
    turns: [],
  };
}

describe("unified chat performance guards", () => {
  beforeEach(() => {
    useUnifiedChatStore.setState({
      activeSessionId: null,
      sessions: [],
      allSessions: [],
      streamingSessionIds: {},
      readThreads: {},
      readThreadPaging: {},
      executionBySession: {},
    });
  });

  it("bounds canonical history snapshots after browsing many long sessions", () => {
    useUnifiedChatStore.setState({ activeSessionId: "thread-0" });
    for (let index = 0; index < 100; index += 1) {
      useUnifiedChatStore
        .getState()
        .handleReadThread(snapshot(`thread-${index}`));
    }

    const state = useUnifiedChatStore.getState();
    expect(Object.keys(state.readThreads)).toHaveLength(
      READ_THREAD_CACHE_LIMIT,
    );
    expect(state.readThreads["thread-0"]).toBeDefined();
    expect(state.readThreads["thread-99"]).toBeDefined();
  });

  it("makes rapid session selection memory-only until the page settles", () => {
    const readThread = vi.fn();
    window.marloues.chat.readThread = readThread;

    for (let index = 0; index < 100; index += 1) {
      useUnifiedChatStore.getState().setActiveSession(`thread-${index}`);
    }

    expect(useUnifiedChatStore.getState().activeSessionId).toBe("thread-99");
    expect(readThread).not.toHaveBeenCalled();
  });

  it("returns cached readThread for a session not in the sessions list", () => {
    // Simulates a scheduled-task session: activeSessionId is set but the
    // session hasn't been injected into sessions yet. The readThread may
    // already be cached from the main-process push broadcast.
    useUnifiedChatStore.setState({
      activeSessionId: "scheduled-1",
      sessions: [],
    });
    useUnifiedChatStore.getState().handleReadThread(snapshot("scheduled-1"));

    const model = useUnifiedChatStore.getState().getActiveReadThreadModel();
    expect(model).not.toBeNull();
    expect(model?.thread.id).toBe("scheduled-1");
  });
});
