import type { AgentSettings } from "@shared/types";
import { logWarn } from "../logging/app-logger";

export type ClaudeCanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  context: Record<string, unknown>,
) => Promise<unknown>;

export function enabledMcpServerConfigs(settings: AgentSettings): Record<string, unknown> {
  const servers: Record<string, unknown> = {};
  for (const server of settings.mcpServers) {
    if (!server.enabled) continue;
    const name = server.name?.trim() || server.id.trim();
    if (name) servers[name] = normalizeSdkMcpServerConfig(server.config);
  }
  return servers;
}

export function normalizeSdkMcpServerConfig(
  config: unknown,
  platform: NodeJS.Platform = process.platform,
): unknown {
  if (!config || typeof config !== "object" || Array.isArray(config)) return config;
  const record = config as Record<string, unknown>;
  const command = typeof record.command === "string" ? record.command.trim() : "";
  if (!command) return record;

  const args = Array.isArray(record.args) ? record.args.map((arg) => String(arg)) : [];
  const rest = { ...record };
  delete rest.command;
  delete rest.args;
  const normalized = normalizeStdioCommand(command, args, platform);
  return {
    type: "stdio",
    alwaysLoad: true,
    ...rest,
    command: normalized.command,
    args: normalized.args,
  };
}

function normalizeStdioCommand(
  command: string,
  args: string[],
  platform: NodeJS.Platform,
): { command: string; args: string[] } {
  if (platform !== "win32" || !isWindowsPackageRunner(command)) return { command, args };
  return { command: "cmd.exe", args: ["/d", "/s", "/c", command, ...args] };
}

function isWindowsPackageRunner(command: string): boolean {
  return command === "npx" || command === "npm" || command === "pnpm" || command === "yarn";
}

export function buildClaudeMemorySettings(settings: AgentSettings): Record<string, unknown> {
  return {
    autoMemoryEnabled: settings.autoMemoryEnabled,
    autoMemoryDirectory: settings.autoMemoryDirectory,
    autoDreamEnabled: settings.autoDreamEnabled,
    autoCompactEnabled: false,
  };
}

export function buildClaudeRuntimeOptions(input: {
  settings: AgentSettings;
  cwd: string;
  env: Record<string, string | undefined>;
  canUseTool: ClaudeCanUseTool;
}): Record<string, unknown> {
  const { settings, cwd, env, canUseTool } = input;
  const thinkingBudget = Math.max(0, settings.maxThinkingTokens ?? 0);
  const permissionMode = settings.workMode === "plan" ? "plan" : settings.permissionMode;
  return {
    cwd,
    model: settings.defaultModel.modelId,
    maxTurns: settings.maxTurns,
    includePartialMessages: true,
    includeHookEvents: true,
    forwardSubagentText: true,
    promptSuggestions: true,
    agentProgressSummaries: true,
    enableFileCheckpointing: true,
    env,
    settings: buildClaudeMemorySettings(settings),
    thinking: settings.thinkingEnabled
      ? { type: "enabled", budgetTokens: thinkingBudget, display: "summarized" }
      : { type: "disabled" },
    maxThinkingTokens: settings.thinkingEnabled ? thinkingBudget : 0,
    allowedTools: settings.toolPermissionPolicy?.allowedTools ?? [],
    disallowedTools: settings.toolPermissionPolicy?.disallowedTools ?? [],
    mcpServers: enabledMcpServerConfigs(settings),
    permissionMode,
    allowDangerouslySkipPermissions: permissionMode === "bypassPermissions",
    canUseTool,
    stderr: (data: string) => logWarn("sdk.claude.stderr", { data: data.trim().slice(0, 2000) }),
  };
}