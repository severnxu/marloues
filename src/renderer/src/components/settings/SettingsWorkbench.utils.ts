import type { McpServerConfig, ModelOption, TimelineItem } from "@shared/types";
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

export function statusToastTitle(message: string, tone: "info" | "ok" | "error"): string {
  if (tone === "ok") return "操作成功";
  if (tone === "error") {
    const prefix = message.split(/[：:]/)[0]?.trim();
    return prefix && prefix.length <= 24 ? prefix : "操作失败";
  }
  if (message.includes("正在测试")) return "正在测试";
  return "状态更新";
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

export function updateArrayValue(items: string[], index: number, value: string): string[] {
  const next = [...items];
  next[index] = value;
  return next;
}

export function buildMcpConfigFromDraft(mode: McpAddMode, draft: McpAddDraft): Record<string, unknown> | null {
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
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function formatMcpAddModeHint(mode: McpAddMode): string {
  if (mode === "stdio") return "启动本地 MCP 进程，适合 npx、node、uvx、python。";
  if (mode === "http") return "连接远程 Streamable HTTP MCP 服务。";
  if (mode === "sse") return "连接远程 SSE MCP 服务。";
  return "粘贴完整 MCP 配置，适合 headers、tools、alwaysLoad 等高级项。";
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

export function readMcpType(config: unknown): "stdio" | "http" | "sse" | "json" {
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
  return Array.isArray(record.args) ? record.args.filter((item): item is string => typeof item === "string") : [];
}

export function formatMcpServerSummary(server: McpServerConfig, type: ReturnType<typeof readMcpType>): string {
  const transport = formatMcpTransportLabel(type);
  const toolCount = server.tools?.length ?? 0;
  if (server.lastStatus === "ok") return `${transport} · ${toolCount} 个工具`;
  if (server.lastStatus === "running") return `${transport} · 检查中`;
  if (server.lastStatus === "disconnected") return `${transport} · 已断开`;
  if (server.lastStatus === "error") return `${transport} · 检查失败`;
  return `${transport} · 未检查`;
}

export function formatMcpTransportLabel(type: ReturnType<typeof readMcpType>): string {
  if (type === "stdio") return "本地进程";
  if (type === "http") return "HTTP 服务";
  if (type === "sse") return "SSE 服务";
  return "自定义 JSON";
}

export function formatMcpStatus(server: McpServerConfig): string {
  if (server.lastStatus === "ok") return "正常";
  if (server.lastStatus === "running") return "检查中";
  if (server.lastStatus === "disconnected") return "已断开";
  if (server.lastStatus === "error") return "异常";
  return "未检查";
}

export function formatMcpError(error: string | undefined): string {
  if (!error) return "未知错误";
  if (/ENOENT|not found|cannot find/i.test(error)) return `${error}。请检查 command 或 args 中的本地路径是否已下发。`;
  if (/timed out|timeout/i.test(error)) return `${error}。请确认 MCP Server 能在 5 秒内完成 initialize 和 tools/list。`;
  if (/invalid response|JSON|parse/i.test(error))
    return `${error}。请确认 MCP Server 的 stdout 只输出 JSON-RPC 协议消息，普通日志写入 stderr。`;
  return error;
}

export function buildRuntimeSnapshot(timeline: TimelineItem[]): RuntimeSnapshot {
  const snapshot: RuntimeSnapshot = { skills: [], mcpTools: [], mcpServers: [] };
  for (const item of timeline) {
    if (item.label === "Session initialized") {
      const detail = parseJsonObject(item.detail);
      snapshot.skills = readStringArray(detail.skills);
      snapshot.updatedAt = Math.max(snapshot.updatedAt ?? 0, item.createdAt);
    }
    if (item.label === "MCP servers loaded") {
      const detail = parseJsonObject(item.detail);
      snapshot.mcpTools = readStringArray(detail.tools);
      snapshot.mcpServers = readRuntimeServers(detail.servers);
      snapshot.updatedAt = Math.max(snapshot.updatedAt ?? 0, item.createdAt);
    }
  }
  return snapshot;
}

export function parseJsonObject(value: string | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function readRuntimeServers(value: unknown): RuntimeSnapshot["mcpServers"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    if (typeof record.name !== "string") return [];
    return [
      {
        name: record.name,
        status: typeof record.status === "string" ? record.status : undefined,
        error: typeof record.error === "string" ? record.error : undefined,
      },
    ];
  });
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
