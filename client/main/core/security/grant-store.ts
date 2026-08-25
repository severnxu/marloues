import type { SecurityOperation } from "./operation-factory";

export type SecurityGrantScope = "thread" | "session";

export interface SecurityGrant {
  id: string;
  scope: SecurityGrantScope;
  toolName: string;
  category: SecurityOperation["category"];
  threadId?: string;
  commandFingerprint?: string;
  allowedPaths?: string[];
  destinationPaths?: string[];
  expiresAt?: number;
  sourceRequestId: string;
}

const DEFAULT_GRANT_TTL_MS = 60 * 60 * 1000;

export class SecurityGrantStore {
  private readonly grants = new Map<string, SecurityGrant>();

  addGrant(input: {
    operation: SecurityOperation;
    scope: SecurityGrantScope;
    sourceRequestId: string;
    ttlMs?: number;
  }): SecurityGrant | null {
    const { operation, scope, sourceRequestId } = input;
    const grant: SecurityGrant = {
      id: crypto.randomUUID(),
      scope,
      toolName: operation.toolName,
      category: operation.category,
      // Both scopes belong to the current task. "session" controls lifetime,
      // not whether the grant can leak into another thread.
      threadId: operation.threadId,
      commandFingerprint: operation.commandFingerprint,
      allowedPaths: operation.resolvedPath
        ? [operation.resolvedPath]
        : undefined,
      destinationPaths: operation.resolvedDestinationPath
        ? [operation.resolvedDestinationPath]
        : undefined,
      expiresAt: Date.now() + (input.ttlMs ?? DEFAULT_GRANT_TTL_MS),
      sourceRequestId,
    };
    if (!grant.commandFingerprint && !grant.allowedPaths?.length) return null;
    this.grants.set(grant.id, grant);
    return grant;
  }

  match(operation: SecurityOperation): SecurityGrant | null {
    this.pruneExpired();
    for (const grant of this.grants.values()) {
      if (grant.toolName !== operation.toolName) continue;
      if (grant.category !== operation.category) continue;
      if (grant.threadId !== operation.threadId) {
        continue;
      }
      if (
        grant.commandFingerprint &&
        grant.commandFingerprint === operation.commandFingerprint
      ) {
        return grant;
      }
      if (operation.resolvedPath && this.matchesPaths(operation, grant)) {
        return grant;
      }
    }
    return null;
  }

  clear(): void {
    this.grants.clear();
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [id, grant] of this.grants) {
      if (grant.expiresAt !== undefined && grant.expiresAt <= now) {
        this.grants.delete(id);
      }
    }
  }

  private matchesPaths(
    operation: SecurityOperation,
    grant: SecurityGrant,
  ): boolean {
    const sourceMatches = grant.allowedPaths?.some((root) =>
      isSameOrChild(operation.resolvedPath!, root),
    );
    if (!sourceMatches) return false;
    if (!grant.destinationPaths?.length) return true;
    if (!operation.resolvedDestinationPath) return false;
    return grant.destinationPaths.some((root) =>
      isSameOrChild(operation.resolvedDestinationPath!, root),
    );
  }
}

function isSameOrChild(candidate: string, root: string): boolean {
  const normalizedCandidate = normalizePath(candidate);
  const normalizedRoot = normalizePath(root);
  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(`${normalizedRoot}/`)
  );
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/g, "").toLowerCase();
}
