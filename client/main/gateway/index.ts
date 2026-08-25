/**
 * Gateway Initializer - starts the HTTP gateway using store configuration
 */

import {
  startServer,
  stopServer,
  RouteDecision,
  RouteResolver,
} from "./server";
import { configurePipeline } from "./pipeline";
import { getAgentSettings } from "../services/config-service";
import { resolveModelProvider } from "../core/config/model-provider";
import type { ModelProviderConfig } from "../../shared/types";
import type { ProtocolId } from "./protocol";
import { log } from "./logger";

let gatewayStarted = false;
let gatewayPort = 0;

export async function startGateway(): Promise<{ port: number } | null> {
  if (gatewayStarted) {
    log("[Gateway] Already started");
    return { port: gatewayPort };
  }

  const provider = resolveModelProvider(getAgentSettings()).provider;
  if (!provider) {
    log("[Gateway] No provider configured, starting with empty config");
  }

  log(
    `[Gateway] Starting with provider: ${provider?.name ?? "none"} (${provider?.baseUrl ?? "n/a"})`,
  );

  // Resolve the same AgentSettings provider used by every runtime on each request.
  // so provider changes take effect without restarting the gateway
  const resolveRoute: RouteResolver = (
    _sourceProtocol: ProtocolId,
    _model: string,
  ): RouteDecision[] => {
    const resolved = resolveModelProvider(getAgentSettings());
    const currentProvider = resolved.provider;
    if (
      !currentProvider ||
      !resolved.baseUrl ||
      !resolved.apiKey ||
      !resolved.model
    )
      return [];
    return [
      {
        targetProvider: currentProvider.id,
        targetModel: resolved.model,
        targetProtocol: providerTargetProtocol(currentProvider),
        targetBaseUrl: resolved.baseUrl,
        apiKey: resolved.apiKey,
      },
    ];
  };

  // Configure pipeline
  configurePipeline({ resolveRoute });

  // Model list — re-reads AgentSettings on each request.
  const getModels = (): string[] => {
    const settings = getAgentSettings();
    const providers = settings.providers;
    const selected = resolveModelProvider(settings).provider;
    const models = providers
      .filter((p) => p.enabled)
      .flatMap((p) =>
        p.models.filter((model) => model.enabled).map((model) => model.id),
      );
    if (selected) {
      const selectedModels = selected.models
        .filter((model) => model.enabled)
        .map((model) => model.id);
      models.unshift(...selectedModels);
    }
    return Array.from(new Set(models));
  };

  // Start server on port 8080 (or next available if in use)
  gatewayPort = await startServer({
    port: 8080,
    resolveRoute,
    getModels,
  });

  gatewayStarted = true;
  log(`[Gateway] Started successfully on port ${gatewayPort}`);
  return { port: gatewayPort };
}

export async function stopGateway(): Promise<void> {
  if (!gatewayStarted) {
    return;
  }

  await stopServer();
  gatewayStarted = false;
  log("[Gateway] Stopped");
}

export function isGatewayStarted(): boolean {
  return gatewayStarted;
}

export function getGatewayPort(): number {
  return gatewayPort;
}

export function providerTargetProtocol(
  provider: ModelProviderConfig,
): ProtocolId {
  switch (provider.type) {
    case "anthropic":
      return "anthropic";
    case "openai-responses":
      return "openai-responses";
    default:
      return "openai-chat";
  }
}
