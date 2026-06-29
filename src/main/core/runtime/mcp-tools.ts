import type { ToolDefinition } from "@shared/agent-runtime";
import { getAgentSettings } from "../../services/config-service";
import { compressToolDescription } from "../context/token-economy";

export function configuredMcpTools(): ToolDefinition[] {
  const tools = getAgentSettings()
    .mcpServers
    .filter((server) => server.enabled)
    .flatMap((server) =>
      (server.tools ?? []).map((tool) => ({
        name: tool,
        description: compressToolDescription(`Configured MCP tool from ${server.name}.`),
        inputSchema: { type: "object" },
      })),
    );
  const byName = new Map<string, ToolDefinition>();
  for (const tool of tools) {
    if (!byName.has(tool.name)) byName.set(tool.name, tool);
  }
  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
}
