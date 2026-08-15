export const NO_ACTIVE_SESSION_SCOPE = "__no-active-session__";

export type AuxiliaryVisibilityAction = boolean | ((open: boolean) => boolean);

export function getAuxiliarySessionScope(sessionId: string | null): string {
  return sessionId ?? NO_ACTIVE_SESSION_SCOPE;
}

export function isAuxiliaryOpenForSession(
  openSessionScopes: ReadonlySet<string>,
  sessionScope: string,
): boolean {
  return openSessionScopes.has(sessionScope);
}

export function updateAuxiliaryVisibilityForSession(
  openSessionScopes: ReadonlySet<string>,
  sessionScope: string,
  action: AuxiliaryVisibilityAction,
): ReadonlySet<string> {
  const wasOpen = openSessionScopes.has(sessionScope);
  const nextOpen = typeof action === "function" ? action(wasOpen) : action;

  if (nextOpen === wasOpen) {
    return openSessionScopes;
  }

  const next = new Set(openSessionScopes);
  if (nextOpen) {
    next.add(sessionScope);
  } else {
    next.delete(sessionScope);
  }
  return next;
}
