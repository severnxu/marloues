import type {
  AgentPermissionMode,
  AgentSettings,
  RuntimeKind,
} from "@shared/types";
import { resolveEffectiveSecurityPolicy } from "@shared/security-policy";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";

const EMPTY_SECURITY_RULES: AgentSettings["securityRules"] = {
  autoAllowPaths: [],
  protectedPaths: [],
  commandAllowlist: [],
  commandAsklist: [],
  networkAccess: "ask",
  allowedDomains: [],
  deniedDomains: [],
};
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
  elevationProfile?: SandboxProfile;
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
    const effectivePolicy = resolveEffectiveSecurityPolicy(input.settings);
    const sandboxProfile = effectivePolicy.sandboxMode;
    const operation = createSecurityOperation({
      runtimeId: this.runtimeId,
      threadId: input.threadId,
      turnId: input.turnId,
      toolName: input.toolName,
      input: input.input,
      workspaceRoot: input.workspaceRoot,
    });

    const boundary = this.checkPathBoundary(operation, sandboxProfile);

    const hardDeny = this.checkHardSafety(operation);
    if (hardDeny) {
      return {
        action: "deny",
        reason: hardDeny,
        operation,
      };
    }

    const configuredDeny =
      effectivePolicy.mode === "full-access"
        ? null
        : this.checkConfiguredDeny(operation, input.settings);
    if (configuredDeny) {
      return { action: "deny", reason: configuredDeny, operation };
    }

    if (boundary?.action === "deny") {
      return { action: "deny", reason: boundary.reason, operation };
    }

    const grant = this.grantStore.match(operation);
    if (grant) {
      return {
        action: "allow",
        reason: `Allowed by scoped ${grant.scope} grant.`,
        operation,
        permit: this.issuePermit(
          operation,
          grant.elevationProfile ?? sandboxProfile,
        ),
      };
    }

    const configuredAction =
      effectivePolicy.mode === "full-access"
        ? null
        : this.configuredAction(operation, input.settings);
    if (boundary?.action === "ask") {
      if (configuredAction === "allow") {
        return {
          action: "allow",
          reason: "Allowed by configured security rule.",
          operation,
          permit: this.issuePermit(operation, boundary.elevationProfile),
        };
      }
      return this.askForElevation(
        operation,
        boundary.reason,
        boundary.elevationProfile,
      );
    }

    const sandboxViolation = this.checkSandbox(operation, sandboxProfile);
    if (sandboxViolation) {
      if (sandboxViolation.action === "deny") {
        return {
          action: "deny",
          reason: sandboxViolation.reason,
          operation,
        };
      }
      if (configuredAction === "allow") {
        return {
          action: "allow",
          reason: "Allowed by configured security rule.",
          operation,
          permit: this.issuePermit(
            operation,
            sandboxViolation.elevationProfile,
          ),
        };
      }
      return this.askForElevation(
        operation,
        sandboxViolation.reason,
        sandboxViolation.elevationProfile,
      );
    }

    if (configuredAction === "ask") {
      return {
        action: "ask",
        reason: "Matched configured approval rule.",
        operation,
        allowSession:
          Boolean(operation.commandFingerprint) ||
          Boolean(operation.resolvedPath),
      };
    }
    if (configuredAction === "allow") {
      return {
        action: "allow",
        reason: "Allowed by configured security rule.",
        operation,
        permit: this.issuePermit(operation, sandboxProfile),
      };
    }

    const permission = evaluateToolPermission({
      toolName: operation.toolName,
      input: operation.input,
      permissionMode: effectivePolicy.permissionMode,
      policy: input.settings.toolPermissionPolicy,
    });
    return this.fromPermissionDecision(operation, permission, sandboxProfile);
  }

  createGrant(input: {
    operation: SecurityOperation;
    scope: SecurityGrantScope;
    sourceRequestId: string;
    elevationProfile?: SandboxProfile;
  }): void {
    this.grantStore.addGrant(input);
  }

  clearGrants(): void {
    this.grantStore.clear();
  }

  issueApprovedPermit(
    operation: SecurityOperation,
    settings: Pick<AgentSettings, "sandboxEnabled" | "sandboxMode">,
    elevationProfile?: SandboxProfile,
  ): SecurityPermit {
    return this.issuePermit(
      operation,
      elevationProfile ??
        sandboxProfileFromAgentSettings(settings, this.sandboxProfile),
    );
  }

  private askForElevation(
    operation: SecurityOperation,
    reason: string,
    elevationProfile: SandboxProfile,
  ): SecurityDecision {
    return {
      action: "ask",
      reason,
      operation,
      elevationProfile,
      allowSession:
        Boolean(operation.commandFingerprint) ||
        Boolean(operation.resolvedPath),
    };
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

  private checkConfiguredDeny(
    operation: SecurityOperation,
    settings: AgentSettings,
  ): string | null {
    const rules = settings.securityRules ?? EMPTY_SECURITY_RULES;
    const hosts =
      operation.networkHosts ??
      (operation.networkHost ? [operation.networkHost] : []);
    const deniedHost = hosts.find((host) =>
      matchesDomainList(host, rules.deniedDomains),
    );
    if (deniedHost) {
      return `Network access to ${deniedHost} is blocked by the denied-domain rule.`;
    }
    if (
      (operation.category === "network_access" || hosts.length > 0) &&
      rules.networkAccess === "deny" &&
      (!hosts.length ||
        hosts.some((host) => !matchesDomainList(host, rules.allowedDomains)))
    ) {
      return "Network access is blocked by the default network policy.";
    }
    return null;
  }

  private configuredAction(
    operation: SecurityOperation,
    settings: AgentSettings,
  ): "allow" | "ask" | null {
    const rules = settings.securityRules ?? EMPTY_SECURITY_RULES;
    const command = operation.command?.trim().toLowerCase();
    if (
      command &&
      rules.commandAsklist.some((prefix) => commandStartsWith(command, prefix))
    ) {
      return "ask";
    }
    if (
      operation.resolvedPath &&
      rules.protectedPaths.some((root) =>
        pathMatches(operation.resolvedPath!, root),
      )
    ) {
      return "ask";
    }
    if (
      command &&
      rules.commandAllowlist.some((prefix) =>
        commandStartsWith(command, prefix),
      )
    ) {
      return "allow";
    }
    if (
      operation.resolvedPath &&
      rules.autoAllowPaths.some((root) =>
        pathMatches(operation.resolvedPath!, root),
      )
    ) {
      return "allow";
    }
    if (
      (operation.category === "network_access" || operation.networkHost) &&
      rules.networkAccess === "allow"
    ) {
      return "allow";
    }
    if (
      operation.category === "network_access" &&
      operation.networkHost &&
      matchesDomainList(operation.networkHost, rules.allowedDomains)
    ) {
      return "allow";
    }
    return null;
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
  ): {
    action: "ask" | "deny";
    reason: string;
    elevationProfile: SandboxProfile;
  } | null {
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
    if (!result.resolvedPath) {
      return {
        action: "deny",
        reason: result.reason ?? "Path cannot be resolved safely.",
        elevationProfile: "danger-full-access",
      };
    }
    operation.resolvedPath = result.resolvedPath;
    if (!result.allowed && sandboxProfile !== "danger-full-access") {
      if (result.failure !== "outside_workspace") {
        return {
          action: "deny",
          reason: result.reason ?? String(result.failure),
          elevationProfile: "danger-full-access",
        };
      }
      return {
        action: "ask",
        reason: "Operation requires access outside the workspace.",
        elevationProfile: "danger-full-access",
      };
    }
    if (operation.destinationPath) {
      const destinationResult = validatePathBoundary(
        operation.destinationPath,
        operation.workspaceRoot,
      );
      if (!destinationResult.resolvedPath) {
        return {
          action: "deny",
          reason:
            destinationResult.reason ??
            "Destination path cannot be resolved safely.",
          elevationProfile: "danger-full-access",
        };
      }
      operation.resolvedDestinationPath = destinationResult.resolvedPath;
      if (
        !destinationResult.allowed &&
        sandboxProfile !== "danger-full-access"
      ) {
        return {
          action:
            destinationResult.failure === "outside_workspace" ? "ask" : "deny",
          reason:
            destinationResult.failure === "outside_workspace"
              ? "Operation requires destination access outside the workspace."
              : (destinationResult.reason ?? String(destinationResult.failure)),
          elevationProfile: "danger-full-access",
        };
      }
    }
    return null;
  }

  private checkSandbox(
    operation: SecurityOperation,
    sandboxProfile: SandboxProfile,
  ): {
    action: "ask" | "deny";
    reason: string;
    elevationProfile: SandboxProfile;
  } | null {
    if (
      operation.category === "file_change" &&
      sandboxProfile === "read-only"
    ) {
      return {
        action: "deny",
        reason: "Read-only sandbox blocks file changes.",
        elevationProfile: "workspace-write",
      };
    }
    if (
      operation.category === "network_access" &&
      sandboxProfile !== "workspace-write-network" &&
      sandboxProfile !== "danger-full-access"
    ) {
      return {
        action: "ask",
        reason: "Operation requires temporary network access.",
        elevationProfile: "workspace-write-network",
      };
    }
    if (operation.category !== "command_execution" || !operation.command)
      return null;
    const result = enforceCommandSandbox({
      command: operation.command,
      workspaceRoot: operation.workspaceRoot,
      sandboxProfile,
    });
    if (result.allowed) return null;
    const reason = result.reason ?? "Command violates sandbox policy.";
    if (sandboxProfile === "read-only") {
      return {
        action: "deny",
        reason,
        elevationProfile: "workspace-write",
      };
    }
    const network = reason.toLowerCase().includes("network");
    return {
      action: "ask",
      reason: network ? "Command requires temporary network access." : reason,
      elevationProfile: network
        ? "workspace-write-network"
        : "danger-full-access",
    };
  }
}

function commandStartsWith(command: string, configuredPrefix: string): boolean {
  const prefix = configuredPrefix.trim().toLowerCase();
  return (
    Boolean(prefix) && (command === prefix || command.startsWith(`${prefix} `))
  );
}

function pathMatches(candidate: string, configuredRoot: string): boolean {
  const expanded =
    configuredRoot.startsWith("~/") || configuredRoot.startsWith("~\\")
      ? resolve(homedir(), configuredRoot.slice(2))
      : resolve(configuredRoot);
  const relativePath = relative(expanded, resolve(candidate));
  return (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${sep}`) &&
      !isAbsolute(relativePath))
  );
}

function matchesDomainList(host: string, configured: string[]): boolean {
  const normalizedHost = host.toLowerCase().replace(/\.$/u, "");
  return configured.some((entry) => {
    const domain = entry
      .trim()
      .toLowerCase()
      .replace(/^\*\./u, "")
      .replace(/\.$/u, "");
    return (
      Boolean(domain) &&
      (normalizedHost === domain || normalizedHost.endsWith(`.${domain}`))
    );
  });
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
