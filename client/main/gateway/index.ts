/**
 * Gateway Initializer - starts the HTTP gateway using store configuration
 */

import {
  startServer,
  stopServer,
  RouteDecision,
  RouteResolver,
} from "./server";
import { randomBytes } from "node:crypto";
import { configurePipeline } from "./pipeline";
import { getAgentSettings } from "../services/config-service";
import { resolveModelProvider } from "../core/config/model-provider";
import type { ProtocolId } from "./protocol";
import { resolveRuntimeProviderRoutes } from "../core/config/provider-routing";
import { log } from "./logger";

let gatewayStarted = false;
let gatewayPort = 0;
let gatewayToken = "";
let gatewayStartPromise: Promise<GatewayConnection> | null = null;

export interface GatewayConnection {
  port: number;
  baseUrl: string;
  token: string;
}

export async function startGateway(): Promise<GatewayConnection> {
  if (gatewayStarted) {
    log("[Gateway] Already started");
    return gatewayConnection();
  }
  if (gatewayStartPromise) return gatewayStartPromise;
  gatewayStartPromise = startGatewayServer();
  try {
    return await gatewayStartPromise;
  } finally {
    gatewayStartPromise = null;
  }
}

async function startGatewayServer(): Promise<GatewayConnection> {
  const provider = resolveModelProvider(getAgentSettings()).provider;
  if (!provider) {
    log("[Gateway] No provider configured, starting with empty config");
  }

  log(`[Gateway] Starting with provider: ${provider?.name ?? "none"}`);

  // Resolve the same AgentSettings provider used by every runtime on each request.
  // so provider changes take effect without restarting the gateway
  const resolveRoute: RouteResolver = (
    sourceProtocol: ProtocolId,
    _model: string,
  ): RouteDecision[] => {
    const plan = resolveRuntimeProviderRoutes(getAgentSettings(), {
      sourceProtocol,
    });
    return plan.routes.map((route) => ({
      targetProvider: route.providerId,
      targetModel: route.model,
      targetProtocol: route.protocol,
      targetBaseUrl: route.baseUrl,
      apiKey: route.apiKey,
      adapterId: route.endpointId,
    }));
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

  gatewayToken = randomBytes(32).toString("hex");
  try {
    gatewayPort = await startServer({
      port: 0,
      internalToken: gatewayToken,
      resolveRoute,
      getModels,
    });
  } catch (error) {
    gatewayPort = 0;
    gatewayToken = "";
    throw error;
  }

  gatewayStarted = true;
  log(`[Gateway] Started successfully on port ${gatewayPort}`);
  return gatewayConnection();
}

export async function stopGateway(): Promise<void> {
  if (!gatewayStarted) {
    return;
  }

  await stopServer();
  gatewayStarted = false;
  gatewayPort = 0;
  gatewayToken = "";
  log("[Gateway] Stopped");
}

export function isGatewayStarted(): boolean {
  return gatewayStarted;
}

export function getGatewayPort(): number {
  return gatewayPort;
}

function gatewayConnection(): GatewayConnection {
  return {
    port: gatewayPort,
    baseUrl: `http://127.0.0.1:${gatewayPort}`,
    token: gatewayToken,
  };
}
