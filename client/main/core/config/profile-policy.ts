import type { AgentSdkPermissionMode, AgentSettings } from "@shared/types";
import type { ChatSendRequest } from "@shared/types";

export interface ResolvedToolPolicy {
  permissionMode: AgentSdkPermissionMode;
  allowedTools?: string[];
  disallowedTools?: string[];
}

export function resolveToolPolicy(
  settings: AgentSettings,
  request: Pick<ChatSendRequest, "permissionMode">,
): ResolvedToolPolicy {
  return {
    permissionMode: settings.workMode === "plan" ? "plan" : (request.permissionMode ?? settings.permissionMode),
    allowedTools: settings.toolPermissionPolicy?.allowedTools,
    disallowedTools: settings.toolPermissionPolicy?.disallowedTools,
  };
}
