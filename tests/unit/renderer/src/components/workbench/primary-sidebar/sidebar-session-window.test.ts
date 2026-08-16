import { describe, expect, it } from "vitest";
import type { ChatSessionRecord } from "@shared/types";
import {
  getSidebarSessionWindow,
  SIDEBAR_SESSION_PAGE_SIZE,
} from "../../../../../../../client/renderer/src/components/workbench/primary-sidebar/sidebar-session-window";

function session(index: number): ChatSessionRecord {
  return {
    id: `session-${index}`,
    title: `Session ${index}`,
    createdAt: index,
    updatedAt: index,
    messages: [],
  };
}

describe("getSidebarSessionWindow", () => {
  it("bounds a large expanded project while keeping priority sessions visible", () => {
    const sessions = Array.from({ length: 1_000 }, (_, index) =>
      session(index),
    );
    sessions[900] = { ...sessions[900], isPinned: true };

    const result = getSidebarSessionWindow(
      sessions,
      SIDEBAR_SESSION_PAGE_SIZE,
      new Set(["session-750"]),
    );

    expect(result.sessions).toHaveLength(SIDEBAR_SESSION_PAGE_SIZE + 2);
    expect(result.sessions.map((item) => item.id)).toContain("session-750");
    expect(result.sessions.map((item) => item.id)).toContain("session-900");
    expect(result.hiddenCount).toBe(948);
  });

  it("returns every session when the project fits in the current window", () => {
    const sessions = Array.from({ length: 12 }, (_, index) => session(index));
    const result = getSidebarSessionWindow(sessions, 50, new Set());

    expect(result.sessions).toHaveLength(12);
    expect(result.hiddenCount).toBe(0);
  });
});
