import { basename } from "node:path";
import type { McpServerConfig } from "@shared/types";
import { getRuntime } from "../core/runtime/manager";
import { getAgentSettings, saveAgentSettings } from "./config-service";
import { probeMcpServer } from "./mcp-probe";

export function normalizeMcpServerConfig(server: McpServerConfig): McpServerConfig {
  const id = server.id?.trim() || `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const config = server.config ?? {};
  return {
    ...server,
    id,
    name: server.name?.trim() || inferMcpServerName(config, id),
    config,
    enabled: server.enabled !== false,
    lastStatus: server.lastStatus ?? "untested",
    tools: Array.from(
      new Set((server.tools ?? []).filter((tool): tool is string => typeof tool === "string" && tool.trim().length > 0)),
    ),
  };
}

export function listMcpServers(): McpServerConfig[] {
  return getAgentSettings().mcpServers.map(normalizeMcpServerConfig);
}

export async function saveMcpServers(servers: McpServerConfig[]): Promise<McpServerConfig[]> {
  assertMutableLocalMcpServers();
  const settings = getAgentSettings();
  const normalized = servers.map(normalizeMcpServerConfig);
  saveAgentSettings({ ...settings, mcpServers: normalized });
  return refreshMcpServerStatuses();
}

export async function testMcpServer(server: McpServerConfig): Promise<McpServerConfig> {
  assertMutableLocalMcpServers();
  const tested = await probeMcpServerConfig(normalizeMcpServerConfig(server));
  const settings = getAgentSettings();
  const exists = settings.mcpServers.some((item) => item.id === tested.id);
  const mcpServers = exists
    ? settings.mcpServers.map((item) => (item.id === tested.id ? tested : item))
    : [...settings.mcpServers, tested];
  saveAgentSettings({ ...settings, mcpServers });
  return tested;
}

export async function refreshMcpServerStatuses(): Promise<McpServerConfig[]> {
  const settings = getAgentSettings();
  const normalized = settings.mcpServers.map(normalizeMcpServerConfig);
  const running = normalized.map((server) =>
    server.enabled
      ? {
          ...server,
          lastStatus: "running" as const,
          lastError: undefined,
          lastProbeResult: "Checking...",
        }
      : {
          ...server,
          lastStatus: "disconnected" as const,
          lastError: "Disabled",
          lastProbeResult: "Disabled",
        },
  );
  saveAgentSettings({ ...settings, mcpServers: running });

  const tested = await Promise.all(
    running.map((server) => (server.enabled ? probeMcpServerConfig(server) : Promise.resolve(server))),
  );
  saveAgentSettings({ ...getAgentSettings(), mcpServers: tested });
  return tested;
}

export async function listRuntimeMcpTools(): Promise<string[]> {
  const runtimeTools = await getRuntime().listTools();
  return Array.from(new Set(runtimeTools.map((tool) => tool.name))).sort((a, b) => a.localeCompare(b));
}


interface RuntimeMcpServer {
  name: string;
  status: string;
  error?: string;
  tools: string[];
}

export function recordMcpRuntimeStatus(runtimeServers: unknown[], runtimeTools?: string[]): void {
  const settings = getAgentSettings();
  if (!settings.mcpServers.length || !runtimeServers.length) return;

  const statusByName = new Map<string, RuntimeMcpServer>();
  for (const server of runtimeServers) {
    const parsed = parseRuntimeServer(server);
    if (parsed) statusByName.set(parsed.name, parsed);
  }
  if (!statusByName.size) return;

  const nextServers = settings.mcpServers.map((server) => {
    const runtime = statusByName.get(server.name);
    if (!runtime) return server;
    return normalizeMcpServerConfig({
      ...server,
      lastStatus: runtime.status === "connected" ? "ok" : runtime.status === "failed" ? "error" : "untested",
      lastError: runtime.error,
      tools: runtime.tools.length ? runtime.tools : filterRuntimeTools(server.name, runtimeTools),
    });
  });

  saveAgentSettings({ ...settings, mcpServers: nextServers });
}

function assertMutableLocalMcpServers(): void {
  const enterprisePolicy = getAgentSettings().enterprisePolicy;
  if (enterprisePolicy?.allowLocalMcpServers === false) {
    throw new Error("Enterprise policy does not allow changing MCP servers.");
  }
}
function parseRuntimeServer(value: unknown): RuntimeMcpServer | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.name !== "string" || !record.name.trim()) return null;
  const toolRecords = Array.isArray(record.tools) ? record.tools : [];
  const tools = toolRecords
    .map((tool) => {
      if (typeof tool === "string") return tool;
      if (tool && typeof tool === "object" && typeof (tool as Record<string, unknown>).name === "string") {
        return `mcp__${record.name}__${(tool as Record<string, unknown>).name}`;
      }
      return "";
    })
    .filter((tool): tool is string => Boolean(tool));
  return {
    name: record.name.trim(),
    status: typeof record.status === "string" ? record.status : "pending",
    error: typeof record.error === "string" ? record.error : undefined,
    tools,
  };
}

function filterRuntimeTools(serverName: string, tools: string[] | undefined): string[] {
  if (!tools?.length) return [];
  const prefix = `mcp__${serverName}__`;
  return tools.filter((tool) => tool.startsWith(prefix));
}
async function probeMcpServerConfig(server: McpServerConfig): Promise<McpServerConfig> {
  const result = await probeMcpServer(server);
  if (!result.ok) {
    return {
      ...server,
      lastStatus: classifyMcpProbeFailure(result.error),
      lastError: result.error,
      lastProbeTool: undefined,
      lastProbeResult: result.error,
    };
  }
  return {
    ...server,
    lastStatus: "ok",
    lastError: undefined,
    lastProbeTool: result.probeTool,
    lastProbeResult: result.probeResult ?? result.message,
    tools: result.tools,
  };
}

function classifyMcpProbeFailure(error: string): NonNullable<McpServerConfig["lastStatus"]> {
  return /timed out|exited|ECONN|ENOTFOUND|EHOST|refused|network|fetch failed|disconnected/i.test(error)
    ? "disconnected"
    : "error";
}

function inferMcpServerName(config: unknown, fallback: string): string {
  if (!config || typeof config !== "object") return fallback;
  const record = config as Record<string, unknown>;
  if (typeof record.name === "string" && record.name.trim()) return record.name.trim();
  if (typeof record.command === "string" && record.command.trim()) return basename(record.command.trim());
  if (typeof record.url === "string" && record.url.trim()) return record.url.trim();
  return fallback;
}
