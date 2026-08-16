import { app } from "electron";
import { existsSync } from "fs";
import { join } from "path";
import type { AgentSettings } from "@shared/types";
import { logWarn } from "../logging/app-logger";

export type ClaudeCanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  context: Record<string, unknown>,
) => Promise<unknown>;

export function enabledMcpServerConfigs(
  settings: AgentSettings,
): Record<string, unknown> {
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
  if (!config || typeof config !== "object" || Array.isArray(config))
    return config;
  const record = config as Record<string, unknown>;
  const command =
    typeof record.command === "string" ? record.command.trim() : "";
  if (!command) return record;

  const args = Array.isArray(record.args)
    ? record.args.map((arg) => String(arg))
    : [];
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
  if (platform !== "win32" || !isWindowsPackageRunner(command))
    return { command, args };
  return { command: "cmd.exe", args: ["/d", "/s", "/c", command, ...args] };
}

function isWindowsPackageRunner(command: string): boolean {
  return (
    command === "npx" ||
    command === "npm" ||
    command === "pnpm" ||
    command === "yarn"
  );
}

/**
 * 解析打包环境下 Claude Code 原生二进制的真实路径。
 *
 * 背景：@anthropic-ai/claude-agent-sdk 的 platform 包
 * （claude-agent-sdk-win32-x64/claude.exe 等）在 electron-builder 打包时会被
 * 解压到 app.asar.unpacked，但 SDK 自身只按 asar 内虚拟路径探测：
 * Electron 的 asar 虚拟文件系统让 fs.existsSync 返回 true，而
 * child_process.spawn 需要真实文件，导致 "exists but failed to launch"。
 * 因此必须显式传 pathToClaudeCodeExecutable 指向解压后的真实路径。
 * 开发模式（未打包）下 node_modules 是真实目录，SDK 自动发现，无需覆盖。
 */
export function resolveClaudeExecutablePath(): string | undefined {
  if (!app?.isPackaged || !process.resourcesPath) return undefined;
  const platformPart =
    process.platform === "win32"
      ? "win32"
      : process.platform === "darwin"
        ? "darwin"
        : "linux";
  const executableName = process.platform === "win32" ? "claude.exe" : "claude";
  const candidate = join(
    process.resourcesPath,
    "app.asar.unpacked",
    "node_modules",
    "@anthropic-ai",
    `claude-agent-sdk-${platformPart}-${process.arch}`,
    executableName,
  );
  if (existsSync(candidate)) return candidate;
  logWarn("claude.executable.unpackedMissing", {
    resourcesPath: process.resourcesPath,
    candidate,
  });
  return undefined;
}

export function buildClaudeMemorySettings(
  settings: AgentSettings,
): Record<string, unknown> {
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
  const permissionMode =
    settings.workMode === "plan" ? "plan" : settings.permissionMode;
  const claudeExecutablePath = resolveClaudeExecutablePath();
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
    stderr: (data: string) =>
      logWarn("sdk.claude.stderr", { data: data.trim().slice(0, 2000) }),
    // 打包环境显式指向 app.asar.unpacked 内的真实二进制（SDK 自动发现只认 asar 虚拟路径）。
    ...(claudeExecutablePath
      ? { pathToClaudeCodeExecutable: claudeExecutablePath }
      : {}),
  };
}
