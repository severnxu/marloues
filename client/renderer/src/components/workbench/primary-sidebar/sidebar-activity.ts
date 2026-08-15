export type SidebarActivityStatus = "unread" | "running" | null;

export function resolveCollapsedSidebarToggleActivity(
  hasUnreadCompletion: boolean,
): SidebarActivityStatus {
  return hasUnreadCompletion ? "unread" : null;
}

export function resolveSidebarActivity(
  hasUnreadCompletion: boolean,
  hasRunningTask: boolean,
): SidebarActivityStatus {
  if (hasUnreadCompletion) return "unread";
  if (hasRunningTask) return "running";
  return null;
}

export function resolveSessionCollectionActivity(
  sessionIds: Iterable<string>,
  unreadSessionIds: ReadonlySet<string>,
  runningSessionIds: ReadonlySet<string>,
): SidebarActivityStatus {
  let hasRunningTask = false;
  for (const sessionId of sessionIds) {
    if (unreadSessionIds.has(sessionId)) return "unread";
    if (runningSessionIds.has(sessionId)) hasRunningTask = true;
  }
  return hasRunningTask ? "running" : null;
}
