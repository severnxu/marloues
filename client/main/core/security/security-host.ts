import type {
  AgentPermissionMode,
  AgentSettings,
  RuntimeKind,
} from "@shared/types";
import { checkHardSafety } from "../permissions/hard-safety-guard";
import {
  evaluateToolPermission,
  type ToolPermissionDecision,
} from "../permissions/tool-permission-engine";
import { validatePathBoundary } from "../permissions/path-boundary-validator";
import {
  createSecurityOperation,
  type SecurityOperation,
} from "./operation-factory";
import { SecurityGrantStore, type SecurityGrantScope } from "./grant-store";
import {
  issuePermit,
  isProtectedWorkspaceWritePath,
  sandboxProfileFromAgentSettings,
  type SandboxOwnership,
  type SandboxProfile,
  type SecurityPermit,
} from "./sandbox-broker";
import { enforceCommandSandbox } from "./command-sandbox-policy";

export type SecurityDecisionAction = "allow" | "ask" | "deny";

export interface SecurityDecision {
  action: SecurityDecisionAction;
  reason: string;
  operation: SecurityOperation;
  permit?: SecurityPermit;
  matchedRule?: string;
  allowSession?: boolean;
}

export interface SecurityHostOptions {
  runtimeId: RuntimeKind;
  sandboxOwnership: SandboxOwnership;
  sandboxProfile?: SandboxProfile;
  grantStore?: SecurityGrantStore;
}

export interface EvaluateSecurityInput {
  threadId?: string;
  turnId?: string;
  toolName: string;
  input?: unknown;
  workspaceRoot?: string;
  permissionMode?: AgentPermissionMode | "plan" | "bypass";
  settings: AgentSettings;
}

export class SecurityHost {
  private readonly runtimeId: RuntimeKind;
  private readonly sandboxOwnership: SandboxOwnership;
  private readonly sandboxProfile: SandboxProfile;
  private readonly grantStore: SecurityGrantStore;

  constructor(options: SecurityHostOptions) {
    this.runtimeId = options.runtimeId;
    this.sandboxOwnership = options.sandboxOwnership;
    this.sandboxProfile = options.sandboxProfile ?? "workspace-write";
    this.grantStore = options.grantStore ?? new SecurityGrantStore();
  }

  evaluate(input: EvaluateSecurityInput): SecurityDecision {
    const sandboxProfile = sandboxProfileFromAgentSettings(
      input.settings,
      this.sandboxProfile,
    );
    const operation = createSecurityOperation({
      runtimeId: this.runtimeId,
      threadId: input.threadId,
      turnId: input.turnId,
      toolName: input.toolName,
      input: input.input,
      workspaceRoot: input.workspaceRoot,
    });

    const boundaryDeny = this.checkPathBoundary(operation, sandboxProfile);
    if (boundaryDeny) {
      return {
        action: "deny",
        reason: boundaryDeny,
        operation,
      };
    }

    const hardDeny = this.checkHardSafety(operation);
    if (hardDeny) {
      return {
        action: "deny",
        reason: hardDeny,
        operation,
      };
    }

    const sandboxDeny = this.checkSandbox(operation, sandboxProfile);
    if (sandboxDeny) {
      return {
        action: "deny",
        reason: sandboxDeny,
        operation,
      };
    }

    const grant = this.grantStore.match(operation);
    if (grant) {
      return {
        action: "allow",
        reason: `Allowed by scoped ${grant.scope} grant.`,
        operation,
        permit: this.issuePermit(operation, sandboxProfile),
      };
    }

    const permission = evaluateToolPermission({
      toolName: operation.toolName,
      input: operation.input,
      permissionMode: input.permissionMode,
      policy: input.settings.toolPermissionPolicy,
    });
    return this.fromPermissionDecision(operation, permission, sandboxProfile);
  }

  createGrant(input: {
    operation: SecurityOperation;
    scope: SecurityGrantScope;
    sourceRequestId: string;
  }): void {
    this.grantStore.addGrant(input);
  }

  clearGrants(): void {
    this.grantStore.clear();
  }

  issueApprovedPermit(
    operation: SecurityOperation,
    settings: Pick<AgentSettings, "sandboxEnabled" | "sandboxMode">,
  ): SecurityPermit {
    return this.issuePermit(
      operation,
      sandboxProfileFromAgentSettings(settings, this.sandboxProfile),
    );
  }

  private fromPermissionDecision(
    operation: SecurityOperation,
    permission: ToolPermissionDecision,
    sandboxProfile: SandboxProfile,
  ): SecurityDecision {
    if (permission.action === "deny") {
      return {
        action: "deny",
        reason: permission.reason,
        matchedRule: permission.matchedRule,
        operation,
      };
    }
    if (permission.action === "ask") {
      return {
        action: "ask",
        reason: permission.reason,
        matchedRule: permission.matchedRule,
        allowSession:
          Boolean(operation.commandFingerprint) ||
          Boolean(operation.resolvedPath),
        operation,
      };
    }
    return {
      action: "allow",
      reason: permission.reason,
      matchedRule: permission.matchedRule,
      operation,
      permit: this.issuePermit(operation, sandboxProfile),
    };
  }

  private issuePermit(
    operation: SecurityOperation,
    sandboxProfile: SandboxProfile,
  ): SecurityPermit {
    return issuePermit({
      operation,
      sandboxProfile,
      sandboxOwnership: this.sandboxOwnership,
    });
  }

  private checkHardSafety(operation: SecurityOperation): string | null {
    if (operation.category === "command_execution" && operation.command) {
      const result = checkHardSafety({
        kind: "command",
        command: operation.command,
      });
      return result.allowed ? null : (result.reason ?? String(result.failure));
    }
    if (
      operation.category === "file_change" &&
      operation.path &&
      operation.fileAction
    ) {
      if (
        operation.workspaceRoot &&
        [operation.resolvedPath, operation.resolvedDestinationPath].some(
          (target) =>
            target &&
            isProtectedWorkspaceWritePath(target, operation.workspaceRoot!),
        )
      ) {
        return "File mutation targets protected workspace state.";
      }
      const result = checkHardSafety({
        kind: "file",
        action:
          operation.fileAction === "patch"
            ? "write"
            : operation.fileAction === "delete"
              ? "delete"
              : operation.fileAction === "move"
                ? "move"
                : "write",
        path: operation.resolvedPath ?? operation.path,
        destinationPath:
          operation.resolvedDestinationPath ?? operation.destinationPath,
        workspaceRoot: operation.workspaceRoot,
      });
      return result.allowed ? null : (result.reason ?? String(result.failure));
    }
    return null;
  }

  private checkPathBoundary(
    operation: SecurityOperation,
    sandboxProfile: SandboxProfile,
  ): string | null {
    if (!operation.workspaceRoot || !operation.path) return null;
    if (
      operation.category !== "file_read" &&
      operation.category !== "file_change"
    ) {
      return null;
    }
    const result = validatePathBoundary(
      operation.path,
      operation.workspaceRoot,
    );
    if (!result.allowed && sandboxProfile !== "danger-full-access") {
      return result.reason ?? String(result.failure);
    }
    if (!result.resolvedPath)
      return result.reason ?? "Path cannot be resolved safely.";
    operation.resolvedPath = result.resolvedPath;
    if (operation.destinationPath) {
      const destinationResult = validatePathBoundary(
        operation.destinationPath,
        operation.workspaceRoot,
      );
      if (
        !destinationResult.allowed &&
        sandboxProfile !== "danger-full-access"
      ) {
        return destinationResult.reason ?? String(destinationResult.failure);
      }
      if (!destinationResult.resolvedPath) {
        return (
          destinationResult.reason ??
          "Destination path cannot be resolved safely."
        );
      }
      operation.resolvedDestinationPath = destinationResult.resolvedPath;
    }
    return null;
  }

  private checkSandbox(
    operation: SecurityOperation,
    sandboxProfile: SandboxProfile,
  ): string | null {
    if (
      operation.category === "file_change" &&
      sandboxProfile === "read-only"
    ) {
      return "Read-only sandbox blocks file changes.";
    }
    if (
      operation.category === "network_access" &&
      sandboxProfile !== "workspace-write-network" &&
      sandboxProfile !== "danger-full-access"
    ) {
      return "Sandbox profile blocks network access.";
    }
    if (operation.category !== "command_execution" || !operation.command)
      return null;
    const result = enforceCommandSandbox({
      command: operation.command,
      workspaceRoot: operation.workspaceRoot,
      sandboxProfile,
    });
    return result.allowed
      ? null
      : (result.reason ?? "Command violates sandbox policy.");
  }
}

export function createRuntimeSecurityHost(
  runtimeId: RuntimeKind,
): SecurityHost {
  if (runtimeId === "binary") {
    return new SecurityHost({
      runtimeId,
      sandboxOwnership: { kind: "external", owner: "codex-binary" },
      sandboxProfile: "workspace-write",
    });
  }
  if (runtimeId === "self-built") {
    return new SecurityHost({
      runtimeId,
      sandboxOwnership: { kind: "managed", backend: "brokered-fs" },
      sandboxProfile: "workspace-write",
    });
  }
  return new SecurityHost({
    runtimeId,
    sandboxOwnership: { kind: "managed", backend: "codex-cli" },
    sandboxProfile: "workspace-write",
  });
}
