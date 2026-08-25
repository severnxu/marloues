import { resolveModelProvider } from "../core/config/model-provider";
import { resolveRuntimeProviderRoutes } from "../core/config/provider-routing";
import { logInfo, logRuntime, logWarn } from "../core/logging/app-logger";
import { diagnoseEndpointModel } from "../core/sdk/endpoint-diagnostics";
import { getAgentSettings } from "./config-service";
import { probeMcpServer } from "./mcp-probe";
import { prepareSkillRuntimeCache } from "./skill-service";

let prewarmStarted = false;

export function startRuntimePrewarm(): void {
  if (prewarmStarted) return;
  prewarmStarted = true;
  setTimeout(() => {
    void prewarmRuntimeDependencies();
  }, 250);
}

async function prewarmRuntimeDependencies(): Promise<void> {
  const startedAt = Date.now();
  logInfo("runtime.prewarm.started");
  try {
    const settings = getAgentSettings();

    prepareSkillRuntimeCache("startup");

    void prewarmEndpoint(settings);
    void prewarmMcpProbe(settings.mcpServers);

    logInfo("runtime.prewarm.scheduled", { elapsedMs: Date.now() - startedAt });
  } catch (error) {
    logWarn("runtime.prewarm.failed", {
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function prewarmEndpoint(
  settings: ReturnType<typeof getAgentSettings>,
): Promise<void> {
  const startedAt = Date.now();
  const modelProvider = resolveModelProvider(settings);
  const route = resolveRuntimeProviderRoutes(settings).routes[0];
  if (!route) {
    logRuntime("prewarm.endpoint.skipped", {
      elapsedMs: Date.now() - startedAt,
      reason: "missing endpoint configuration",
      providerId: modelProvider.selection.providerId,
      modelId: modelProvider.selection.modelId,
    });
    return;
  }

  try {
    const result = await diagnoseEndpointModel({
      baseUrl: route.baseUrl,
      apiKey: route.apiKey,
      model: route.model,
      protocol: route.protocol,
      timeoutMs: 3000,
    });
    logRuntime("prewarm.endpoint", {
      elapsedMs: Date.now() - startedAt,
      providerId: modelProvider.selection.providerId,
      modelId: modelProvider.selection.modelId,
      message: result.message,
    });
  } catch (error) {
    logWarn("runtime.prewarm.endpointFailed", {
      elapsedMs: Date.now() - startedAt,
      model: modelProvider.model,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function prewarmMcpProbe(
  servers: ReturnType<typeof getAgentSettings>["mcpServers"],
): Promise<void> {
  const enabledServers = servers.filter((server) => server.enabled);
  if (!enabledServers.length) {
    logRuntime("prewarm.mcpProbe.skipped", { reason: "no enabled servers" });
    return;
  }

  const startedAt = Date.now();
  const results = await Promise.allSettled(
    enabledServers.map(async (server) => {
      const result = await probeMcpServer(server);
      if (!result.ok) throw new Error(result.error);
      return { name: server.name, toolCount: result.tools.length };
    }),
  );
  logRuntime("prewarm.mcpProbe", {
    elapsedMs: Date.now() - startedAt,
    serverCount: enabledServers.length,
    okCount: results.filter((result) => result.status === "fulfilled").length,
    failedServers: results.flatMap((result, index) =>
      result.status === "rejected" ? [enabledServers[index]?.name] : [],
    ),
  });
}
