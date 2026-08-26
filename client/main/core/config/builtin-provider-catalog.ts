import type {
  ModelEndpointProtocol,
  ModelProviderEndpoint,
} from "@shared/types";
import type { BuiltinProviderPresetId } from "@shared/builtin-provider-metadata";

interface BuiltinEndpointDefinition {
  id: string;
  name: string;
  protocol: ModelEndpointProtocol;
  baseUrl: string;
  priority: number;
}

const BUILTIN_PROVIDER_ENDPOINTS: Record<
  BuiltinProviderPresetId,
  readonly BuiltinEndpointDefinition[]
> = {
  deepseek: [
    {
      id: "deepseek-anthropic",
      name: "Anthropic",
      protocol: "anthropic",
      baseUrl: "https://api.deepseek.com/anthropic",
      priority: 10,
    },
    {
      id: "deepseek-openai",
      name: "OpenAI Chat",
      protocol: "openai-chat",
      baseUrl: "https://api.deepseek.com",
      priority: 20,
    },
  ],
  minimax: [
    {
      id: "minimax-anthropic",
      name: "Anthropic",
      protocol: "anthropic",
      baseUrl: "https://api.minimaxi.com/anthropic",
      priority: 10,
    },
    {
      id: "minimax-openai",
      name: "OpenAI Chat",
      protocol: "openai-chat",
      baseUrl: "https://api.minimaxi.com/v1",
      priority: 20,
    },
  ],
  zhipu: [
    {
      id: "zhipu-openai",
      name: "OpenAI Chat",
      protocol: "openai-chat",
      baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
      priority: 10,
    },
  ],
};

export function builtinProviderEndpoints(
  presetId: string,
): ModelProviderEndpoint[] {
  const endpoints =
    BUILTIN_PROVIDER_ENDPOINTS[presetId as BuiltinProviderPresetId] ?? [];
  return endpoints.map((endpoint) => ({ ...endpoint, enabled: true }));
}
