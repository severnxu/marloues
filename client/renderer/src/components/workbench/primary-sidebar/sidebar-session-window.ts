import type { ChatSessionRecord } from "@shared/types";

export const SIDEBAR_SESSION_PAGE_SIZE = 50;

export interface SidebarSessionWindow {
  sessions: ChatSessionRecord[];
  hiddenCount: number;
}

/**
 * Keep the project tree's DOM bounded while ensuring sessions that need the
 * user's attention never disappear behind the "show more" affordance.
 */
export function getSidebarSessionWindow(
  sessions: readonly ChatSessionRecord[],
  limit: number,
  prioritySessionIds: ReadonlySet<string>,
): SidebarSessionWindow {
  if (sessions.length <= limit) {
    return { sessions: [...sessions], hiddenCount: 0 };
  }

  const visibleIds = new Set(
    sessions.slice(0, Math.max(0, limit)).map((session) => session.id),
  );
  for (const session of sessions) {
    if (session.isPinned || prioritySessionIds.has(session.id)) {
      visibleIds.add(session.id);
    }
  }

  const visibleSessions = sessions.filter((session) =>
    visibleIds.has(session.id),
  );
  return {
    sessions: visibleSessions,
    hiddenCount: Math.max(0, sessions.length - visibleSessions.length),
  };
}
