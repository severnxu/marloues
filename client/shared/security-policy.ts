import type {
  AgentPermissionMode,
  AgentSandboxMode,
  AgentSecurityMode,
  AgentSettings,
} from "./types";

export type SecurityApprovalStrategy = "user" | "reviewer" | "none";

export interface EffectiveSecurityPolicy {
  mode: AgentSecurityMode;
  permissionMode: AgentPermissionMode | "plan";
  sandboxMode: AgentSandboxMode;
  approvalStrategy: SecurityApprovalStrategy;
  filesystemLabel: string;
  networkLabel: string;
}

export function resolveEffectiveSecurityPolicy(
  settings: Pick<
    AgentSettings,
    "workMode" | "securityMode" | "permissionMode" | "sandboxMode"
  >,
): EffectiveSecurityPolicy {
  if (settings.workMode === "plan") {
    return {
      mode: settings.securityMode,
      permissionMode: "plan",
      sandboxMode: "read-only",
      approvalStrategy: "user",
      filesystemLabel: "只读",
      networkLabel: "关闭",
    };
  }

  if (settings.securityMode === "full-access") {
    return {
      mode: settings.securityMode,
      permissionMode: "bypassPermissions",
      sandboxMode: "danger-full-access",
      approvalStrategy: "none",
      filesystemLabel: "完整访问",
      networkLabel: "允许",
    };
  }

  const sandboxMode =
    settings.sandboxMode === "danger-full-access"
      ? "workspace-write"
      : (settings.sandboxMode ?? "workspace-write");

  return {
    mode: settings.securityMode,
    permissionMode: "default",
    sandboxMode,
    approvalStrategy:
      settings.securityMode === "auto-review" ? "reviewer" : "user",
    filesystemLabel: sandboxMode === "read-only" ? "只读" : "工作区可写",
    networkLabel: sandboxMode === "workspace-write-network" ? "允许" : "按请求",
  };
}

export function applySecurityMode(
  settings: AgentSettings,
  securityMode: AgentSecurityMode,
): AgentSettings {
  const fullAccess = securityMode === "full-access";
  return {
    ...settings,
    securityMode,
    permissionMode: fullAccess ? "bypassPermissions" : "default",
    sandboxEnabled: !fullAccess,
    sandboxMode: fullAccess ? "danger-full-access" : "workspace-write",
  };
}
