import type { AgentSettings, RuntimeKind } from "@shared/types";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { SecurityOperation } from "./operation-factory";

export type SandboxProfile =
  | "read-only"
  | "workspace-write"
  | "workspace-write-network"
  | "danger-full-access";

export type SandboxOwnership =
  | { kind: "managed"; backend: "brokered-fs" | "codex-cli" }
  | { kind: "external"; owner: "codex-binary" }
  | { kind: "disabled"; reason: string };

export interface SecurityPermit {
  id: string;
  operationId: string;
  runtimeId: RuntimeKind;
  sandboxProfile: SandboxProfile;
  sandboxOwnership: SandboxOwnership;
  fs: {
    read: string[];
    write: string[];
    denyWrite: string[];
  };
  network: {
    mode: "deny" | "allow" | "ask";
    allowedDomains: string[];
  };
}

export const PROTECTED_WORKSPACE_WRITE_SUBPATHS = [
  ".git",
  ".marloues",
  ".codebuddy",
  ".codex",
  ".agents",
] as const;

export function codexWorkspaceFilesystemConfig(): string {
  const scopedEntries = [
    '"."="write"',
    ...PROTECTED_WORKSPACE_WRITE_SUBPATHS.map(
      (subpath) => `${JSON.stringify(subpath)}="read"`,
    ),
  ].join(",");
  return `{":root"="read",":workspace_roots"={${scopedEntries}}}`;
}

export function isProtectedWorkspaceWritePath(
  candidate: string,
  workspaceRoot: string,
): boolean {
  const resolvedCandidate = resolve(candidate);
  let resolvedWorkspaceRoot = resolve(workspaceRoot);
  try {
    resolvedWorkspaceRoot = realpathSync.native(resolvedWorkspaceRoot);
  } catch {
    return false;
  }
  return PROTECTED_WORKSPACE_WRITE_SUBPATHS.some((subpath) => {
    const protectedRoot = resolve(resolvedWorkspaceRoot, subpath);
    const relativePath = relative(protectedRoot, resolvedCandidate);
    return (
      relativePath === "" ||
      (relativePath !== ".." &&
        !relativePath.startsWith(`..${sep}`) &&
        !isAbsolute(relativePath))
    );
  });
}

export function issuePermit(input: {
  operation: SecurityOperation;
  sandboxProfile: SandboxProfile;
  sandboxOwnership: SandboxOwnership;
}): SecurityPermit {
  const { operation, sandboxProfile, sandboxOwnership } = input;
  const workspace = operation.workspaceRoot ? [operation.workspaceRoot] : [];
  const read =
    operation.category === "file_read" && operation.resolvedPath
      ? [operation.resolvedPath]
      : workspace;
  const write =
    operation.category === "file_change" && operation.resolvedPath
      ? [
          operation.resolvedPath,
          ...(operation.resolvedDestinationPath
            ? [operation.resolvedDestinationPath]
            : []),
        ]
      : sandboxProfile === "workspace-write" ||
          sandboxProfile === "workspace-write-network"
        ? workspace
        : [];
  return {
    id: crypto.randomUUID(),
    operationId: operation.id,
    runtimeId: operation.runtimeId,
    sandboxProfile,
    sandboxOwnership,
    fs: {
      read,
      write,
      denyWrite: protectedWritePaths(operation.workspaceRoot),
    },
    network: {
      mode:
        sandboxProfile === "workspace-write-network" ||
        sandboxProfile === "danger-full-access"
          ? "allow"
          : "deny",
      allowedDomains: [],
    },
  };
}

export function sandboxProfileFromAgentSettings(
  settings: Pick<AgentSettings, "sandboxEnabled" | "sandboxMode">,
  fallback: SandboxProfile = "workspace-write",
): SandboxProfile {
  if (settings.sandboxMode) return settings.sandboxMode;
  if (settings.sandboxEnabled === false) return "danger-full-access";
  if (settings.sandboxEnabled === true) return "workspace-write";
  return fallback;
}

export function codexSandboxProfileFromSettings(input: {
  sandboxEnabled?: boolean;
  sandboxMode?: SandboxProfile;
}): SandboxProfile {
  return sandboxProfileFromAgentSettings(input, "workspace-write");
}

function protectedWritePaths(workspaceRoot?: string): string[] {
  const workspaceProtected = workspaceRoot
    ? PROTECTED_WORKSPACE_WRITE_SUBPATHS.map((subpath) =>
        join(workspaceRoot, subpath),
      )
    : [];
  return [
    ...workspaceProtected,
    join(homedir(), ".ssh"),
    join(homedir(), ".aws"),
    join(homedir(), ".azure"),
    join(homedir(), ".kube"),
    join(homedir(), ".gnupg"),
  ];
}
