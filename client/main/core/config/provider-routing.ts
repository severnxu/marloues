import type {
  AgentSettings,
  ModelEndpointProtocol,
  ModelProviderConfig,
  ModelProviderEndpoint,
  ModelSelection,
  RuntimeKind,
} from "@shared/types";
import { builtinProviderEndpoints } from "./builtin-provider-catalog";
import { resolveModelProvider } from "./model-provider";

export interface ResolvedProviderRoute {
  providerId: string;
  providerName: string;
  endpointId: string;
  endpointName: string;
  protocol: ModelEndpointProtocol;
  baseUrl: string;
  apiKey: string;
  model: string;
  priority: number;
}

export interface RuntimeProviderRoutePlan {
  sourceProtocol: ModelEndpointProtocol;
  routes: ResolvedProviderRoute[];
  directRoute?: ResolvedProviderRoute;
  requiresGateway: boolean;
}

export function runtimeSourceProtocol(
  runtimeId: RuntimeKind,
): ModelEndpointProtocol {
  if (runtimeId === "sdk") return "anthropic";
  if (runtimeId === "binary") return "openai-responses";
  return "openai-chat";
}

export function configuredProviderEndpoints(
  provider: ModelProviderConfig,
): ModelProviderEndpoint[] {
  if (provider.kind === "builtin") {
    return builtinProviderEndpoints(provider.presetId);
  }
  return provider.endpoints
    .filter((endpoint) => endpoint.enabled)
    .map((endpoint) => ({ ...endpoint }));
}

export function resolveRuntimeProviderRoutes(
  settings: AgentSettings,
  input: {
    runtimeId?: RuntimeKind;
    sourceProtocol?: ModelEndpointProtocol;
    selection?: Partial<ModelSelection> | null;
    requestedModel?: string;
  } = {},
): RuntimeProviderRoutePlan {
  const resolved = resolveModelProvider(settings, input.selection);
  const sourceProtocol =
    input.sourceProtocol ??
    runtimeSourceProtocol(input.runtimeId ?? settings.activeRuntimeId ?? "sdk");
  const endpoints = configuredProviderEndpoints(resolved.provider);
  const apiKey = resolved.apiKey?.trim() ?? "";
  const model = input.requestedModel?.trim() || resolved.model;

  const routes = endpoints
    .filter((endpoint) => endpoint.enabled && endpoint.baseUrl.trim() && apiKey)
    .map((endpoint): ResolvedProviderRoute => ({
      providerId: resolved.provider.id,
      providerName: resolved.provider.name,
      endpointId: endpoint.id,
      endpointName: endpoint.name?.trim() || endpoint.protocol,
      protocol: endpoint.protocol,
      baseUrl: endpoint.baseUrl.trim(),
      apiKey,
      model,
      priority: normalizedPriority(endpoint.priority),
    }))
    .sort((left, right) => {
      const protocolOrder =
        protocolRank(sourceProtocol, left.protocol) -
        protocolRank(sourceProtocol, right.protocol);
      if (protocolOrder !== 0) return protocolOrder;
      const priorityOrder = left.priority - right.priority;
      if (priorityOrder !== 0) return priorityOrder;
      return left.endpointId.localeCompare(right.endpointId);
    });

  const exactRoutes = routes.filter(
    (route) => route.protocol === sourceProtocol,
  );
  const directRoute = exactRoutes.length === 1 ? exactRoutes[0] : undefined;
  return {
    sourceProtocol,
    routes,
    directRoute,
    requiresGateway: !directRoute,
  };
}

function protocolRank(
  source: ModelEndpointProtocol,
  target: ModelEndpointProtocol,
): number {
  if (source === target) return 0;
  if (source === "openai-responses") {
    return target === "openai-chat" ? 1 : 2;
  }
  if (source === "anthropic") {
    return target === "openai-chat" ? 1 : 2;
  }
  return target === "openai-responses" ? 1 : 2;
}

function normalizedPriority(priority: number): number {
  return Number.isFinite(priority) && priority >= 0
    ? Math.trunc(priority)
    : Number.MAX_SAFE_INTEGER;
}
