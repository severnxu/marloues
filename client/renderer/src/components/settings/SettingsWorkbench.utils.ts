import type { McpServerConfig, ModelOption } from "@shared/types";
import type { SessionInitInfo } from "@/stores/unified-chat-store";
import { STRINGS } from "@shared/strings.zh";
export interface RuntimeSnapshot {
  skills: string[];
  mcpTools: string[];
  mcpServers: Array<{ name: string; status?: string; error?: string }>;
  updatedAt?: number;
}

export type McpAddMode = "stdio" | "http" | "sse" | "json";
export type McpAddDraft = {
  name: string;
  command: string;
  args: string[];
  url: string;
  json: string;
  enabled: boolean;
};

export const emptyMcpAddDraft = (): McpAddDraft => ({
  name: "",
  command: "",
  args: [],
  url: "",
  json: "",
  enabled: true,
});

export function statusToastTitle(
  message: string,
  tone: "info" | "ok" | "error",
): string {
  if (tone === "ok") return STRINGS.status.operationOk;
  if (tone === "error") {
    const prefix = message.split(/[：:]/)[0]?.trim();
    return prefix
      ? STRINGS.status.operationFailedWithPrefix(prefix)
      : STRINGS.status.operationFailed;
  }
  if (message.includes(STRINGS.status.testing)) return STRINGS.status.testing;
  return STRINGS.status.updated;
}

export function _splitLines(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function compactMcpArgs(args: string[]): string[] {
  return args.map((arg) => arg.trim()).filter(Boolean);
}

export function updateArrayValue(
  items: string[],
  index: number,
  value: string,
): string[] {
  const next = [...items];
  next[index] = value;
  return next;
}

export function buildMcpConfigFromDraft(
  mode: McpAddMode,
  draft: McpAddDraft,
): Record<string, unknown> | null {
  if (mode === "stdio") {
    const command = draft.command.trim();
    if (!command) return null;
    return {
      type: "stdio",
      command,
      args: draft.args.map((arg) => arg.trim()).filter(Boolean),
    };
  }
  if (mode === "http" || mode === "sse") {
    const url = draft.url.trim();
    if (!url) return null;
    return { type: mode, url };
  }
  const rawJson = draft.json.trim();
  if (!rawJson) return null;
  try {
    const parsed = JSON.parse(rawJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function formatMcpAddModeHint(mode: McpAddMode): string {
  if (mode === "stdio") return STRINGS.mcp.addModeHint.stdio;
  if (mode === "http") return STRINGS.mcp.addModeHint.http;
  if (mode === "sse") return STRINGS.mcp.addModeHint.sse;
  return STRINGS.mcp.addModeHint.json;
}

export function readMcpConfigRecord(config: unknown): Record<string, unknown> {
  return config && typeof config === "object" && !Array.isArray(config)
    ? { ...(config as Record<string, unknown>) }
    : {};
}

export function readMcpCommand(config: unknown): string {
  const record = readMcpConfigRecord(config);
  return typeof record.command === "string" ? record.command : "";
}

export function readMcpType(
  config: unknown,
): "stdio" | "http" | "sse" | "json" {
  const record = readMcpConfigRecord(config);
  const type = typeof record.type === "string" ? record.type : "";
  if (type === "http" || type === "sse") return type;
  if (typeof record.command === "string") return "stdio";
  return "json";
}

export function readMcpUrl(config: unknown): string {
  const record = readMcpConfigRecord(config);
  return typeof record.url === "string" ? record.url : "";
}

export function readMcpArgs(config: unknown): string[] {
  const record = readMcpConfigRecord(config);
  return Array.isArray(record.args)
    ? record.args.filter((item): item is string => typeof item === "string")
    : [];
}

export function formatMcpServerSummary(
  server: McpServerConfig,
  type: ReturnType<typeof readMcpType>,
): string {
  const transport = formatMcpTransportLabel(type);
  const toolCount = server.tools?.length ?? 0;
  if (server.lastStatus === "ok")
    return STRINGS.mcp.serverSummary(transport, toolCount);
  if (server.lastStatus === "running")
    return STRINGS.mcp.serverSummaryRunning(transport);
  if (server.lastStatus === "disconnected")
    return STRINGS.mcp.serverSummaryDisconnected(transport);
  if (server.lastStatus === "error")
    return STRINGS.mcp.serverSummaryCheckFailed(transport);
  return STRINGS.mcp.serverSummaryUncheck(transport);
}

export function formatMcpTransportLabel(
  type: ReturnType<typeof readMcpType>,
): string {
  if (type === "stdio") return STRINGS.mcp.transport.stdio;
  if (type === "http") return STRINGS.mcp.transport.http;
  if (type === "sse") return STRINGS.mcp.transport.sse;
  return STRINGS.mcp.transport.json;
}

export function formatMcpStatus(server: McpServerConfig): string {
  if (server.lastStatus === "ok") return STRINGS.mcp.status.ok;
  if (server.lastStatus === "running") return STRINGS.mcp.status.running;
  if (server.lastStatus === "disconnected")
    return STRINGS.mcp.status.disconnected;
  if (server.lastStatus === "error") return STRINGS.mcp.status.error;
  return STRINGS.mcp.status.uncheck;
}

export function formatMcpError(error: string | undefined): string {
  if (!error) return STRINGS.mcp.errorUnknown;
  if (/ENOENT|not found|cannot find/i.test(error))
    return `${error}。${STRINGS.mcp.errorHint.notFound}`;
  if (/timed out|timeout/i.test(error))
    return `${error}。${STRINGS.mcp.errorHint.timeout}`;
  if (/invalid response|JSON|parse/i.test(error))
    return `${error}。${STRINGS.mcp.errorHint.parse}`;
  return error;
}

export function buildRuntimeSnapshot(
  info: SessionInitInfo | undefined,
): RuntimeSnapshot {
  if (!info) {
    return { skills: [], mcpTools: [], mcpServers: [] };
  }
  return {
    skills: [],
    mcpTools: info.mcpTools ?? [],
    mcpServers: info.mcpServers ?? [],
    updatedAt: info.mcpUpdatedAt,
  };
}

export function withModelMetadataDefaults(model: ModelOption): ModelOption {
  const preset = modelMetadataPreset(model.id);
  return normalizeModelMetadataPatch({ ...preset, ...model });
}

export function normalizeModelMetadataPatch(model: ModelOption): ModelOption {
  return {
    ...model,
    contextWindowTokens: normalizePositiveInteger(model.contextWindowTokens),
    maxOutputTokens: normalizePositiveInteger(model.maxOutputTokens),
  };
}

export function modelMetadataPreset(modelId: string): Partial<ModelOption> {
  const id = modelId.toLowerCase();
  if (id === "deepseek-v4-flash" || id === "deepseek-v4-pro") {
    return {
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 384_000,
      supportsThinking: true,
      supportsVision: false,
    };
  }
  return {};
}

export function normalizePositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const normalized = Math.trunc(value);
  return normalized > 0 ? normalized : undefined;
}

export function parseJsonLoose(value: string, fallback: unknown): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
