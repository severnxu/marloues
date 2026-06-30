export function normalizeWorkspacePathForCompare(path: string | undefined | null): string {
  return (path ?? "").trim().replace(/\\/g, "/").replace(/\/+$/g, "").toLowerCase();
}

export function workspacePathsEqual(left: string | undefined | null, right: string | undefined | null): boolean {
  const normalizedLeft = normalizeWorkspacePathForCompare(left);
  const normalizedRight = normalizeWorkspacePathForCompare(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}
