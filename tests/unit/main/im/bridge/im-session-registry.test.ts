import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImSessionRecord } from "@shared/im/im-types";

let originalHome: string | undefined;
let home: string;

beforeEach(() => {
  originalHome = process.env.MARLOUES_HOME;
  home = mkdtempSync(join(tmpdir(), "marloues-im-registry-"));
  process.env.MARLOUES_HOME = home;
  vi.resetModules();
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.MARLOUES_HOME;
  else process.env.MARLOUES_HOME = originalHome;
  vi.resetModules();
});

describe("ImSessionRegistry", () => {
  it("keeps previous IM threads visible when a chat starts a new session", async () => {
    const { ImSessionRegistry } =
      await import("../../../../../client/main/im/bridge/im-session-registry");
    const registry = new ImSessionRegistry();

    registry.bind(createRecord("thread-old", 1_000));
    registry.bind(createRecord("thread-new", 2_000));

    expect(registry.getThreadId("feishu", "chat-1")).toBe("thread-new");
    expect(registry.getByThreadId("thread-old")?.state).toBe("suspended");
    expect(registry.getByThreadId("thread-new")?.state).toBe("active");
    expect(
      registry.listForRenderer((threadId) =>
        threadId === "thread-old" ? "旧会话" : "新会话",
      ),
    ).toMatchObject([
      { threadId: "thread-new", title: "新会话" },
      { threadId: "thread-old", title: "旧会话" },
    ]);

    registry.updateLastTurnForThread("thread-old", "turn-old");
    expect(registry.getByThreadId("thread-old")?.lastTurnId).toBe("turn-old");
    expect(registry.getByThreadId("thread-new")?.lastTurnId).toBeUndefined();

    registry.clearThreadState("thread-old");
    expect(registry.getByThreadId("thread-old")?.lastTurnId).toBeUndefined();

    const disk = JSON.parse(
      readFileSync(join(home, "config", "im-sessions.json"), "utf-8"),
    ) as { sessions: ImSessionRecord[] };
    expect(disk.sessions.map((session) => session.threadId).sort()).toEqual([
      "thread-new",
      "thread-old",
    ]);

    const restored = new ImSessionRegistry();
    restored.loadAll();
    expect(restored.getThreadId("feishu", "chat-1")).toBe("thread-new");
    expect(restored.getByThreadId("thread-old")?.state).toBe("suspended");
    expect(restored.listForRenderer((threadId) => threadId)).toHaveLength(2);
  });
});

function createRecord(threadId: string, updatedAt: number): ImSessionRecord {
  mkdirSync(join(home, "workspace"), { recursive: true });
  return {
    channel: "feishu",
    chatId: "chat-1",
    threadId,
    ownerUserId: "owner-1",
    workspacePath: join(home, "workspace"),
    createdAt: updatedAt,
    updatedAt,
    state: "active",
  };
}
