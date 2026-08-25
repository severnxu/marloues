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
import type { ProtocolId } from "./protocol";
import { log } from "./logger";
import { getAgentSettings } from "../services/config-service";
import { resolveModelProvider } from "../core/config/model-provider";

let gatewayStarted = false;
let gatewayPort = 0;

export interface GatewayTarget {
  baseUrl: string;
  protocol: "anthropic" | "openai-chat";
}

export function resolveGatewayTarget(baseUrl: string): GatewayTarget {
  try {
    const url = new URL(baseUrl);
    if (url.hostname.toLowerCase() === "api.anthropic.com") {
      return {
        baseUrl: url.toString().replace(/\/$/, ""),
        protocol: "anthropic",
      };
    }
    if (
      url.hostname.toLowerCase() === "api.deepseek.com" &&
      /\/anthropic\/?$/i.test(url.pathname)
    ) {
      url.pathname = url.pathname.replace(/\/anthropic\/?$/i, "") || "/";
      return {
        baseUrl: url.toString().replace(/\/$/, ""),
        protocol: "openai-chat",
      };
    }
  } catch {
    // Preserve existing behavior for non-standard but otherwise usable URLs.
  }

  return {
    baseUrl,
    protocol: /\/anthropic\/?$/i.test(baseUrl) ? "anthropic" : "openai-chat",
  };
}

export async function startGateway(): Promise<{ port: number } | null> {
  if (gatewayStarted) {
    log("[Gateway] Already started");
    return { port: gatewayPort };
  }

  const provider = resolveModelProvider(getAgentSettings());
  if (!provider.provider) {
    log("[Gateway] No provider configured, starting with empty config");
  }

  log(
    `[Gateway] Starting with provider: ${provider.provider?.name ?? "none"} (${provider.provider?.baseUrl ?? "n/a"})`,
  );

  // Resolve the same AgentSettings provider used by every runtime on each request.
  // so provider changes take effect without restarting the gateway
  const resolveRoute: RouteResolver = (
    _sourceProtocol: ProtocolId,
    model: string,
  ): RouteDecision[] => {
    const current = resolveModelProvider(getAgentSettings());
    if (!current.provider?.baseUrl || !current.apiKey) return [];
    const target = resolveGatewayTarget(current.provider.baseUrl);
    return [
      {
        targetProvider: current.provider.id,
        targetModel: current.model || model,
        targetProtocol: target.protocol,
        targetBaseUrl: target.baseUrl,
        apiKey: current.apiKey,
      },
    ];
  };

  // Configure pipeline
  configurePipeline({ resolveRoute });

  // Model list — re-reads AgentSettings on each request.
  const getModels = (): string[] => {
    const settings = getAgentSettings();
    const selected = resolveModelProvider(settings);
    const models = settings.providers
      .filter((item) => item.enabled !== false)
      .flatMap((item) =>
        item.models
          .filter((model) => model.enabled !== false)
          .map((model) => model.id),
      );
    if (selected.model && !models.includes(selected.model)) {
      models.unshift(selected.model);
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
