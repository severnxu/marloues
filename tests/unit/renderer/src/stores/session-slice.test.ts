import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatSessionRecord } from "@shared/types";
import { useUnifiedChatStore } from "../../../../../client/renderer/src/stores/unified-chat-store";

vi.hoisted(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      marloues: {
        chat: {
          toggleSessionPinned: vi.fn().mockResolvedValue(undefined),
        },
      },
      localStorage: {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
      },
    },
  });
});

function session(
  id: string,
  updatedAt: number,
  isPinned = false,
): ChatSessionRecord {
  return {
    id,
    title: id,
    createdAt: updatedAt,
    updatedAt,
    isPinned,
    messages: [],
  };
}

describe("session slice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUnifiedChatStore.setState({
      sessions: [],
      allSessions: [],
      activeSessionId: null,
    });
  });

  it("keeps the session activity timestamp when toggling pinned state", async () => {
    const original = session("older-session", 1000, true);
    useUnifiedChatStore.setState({
      sessions: [original],
      allSessions: [original, session("newer-session", 2000)],
    });

    await useUnifiedChatStore.getState().toggleSessionPinned(original.id);

    const current = useUnifiedChatStore
      .getState()
      .sessions.find((item) => item.id === original.id);
    const inTree = useUnifiedChatStore
      .getState()
      .allSessions.find((item) => item.id === original.id);

    expect(current?.isPinned).toBe(false);
    expect(current?.updatedAt).toBe(1000);
    expect(inTree?.isPinned).toBe(false);
    expect(inTree?.updatedAt).toBe(1000);
  });
});
