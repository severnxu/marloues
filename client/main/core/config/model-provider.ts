import type {
  AgentSettings,
  ModelProviderConfig,
  ModelSelection,
} from "@shared/types";

export interface ResolvedModelProvider {
  provider: ModelProviderConfig;
  selection: ModelSelection;
  model: string;
  apiKey?: string;
}

export function resolveModelProvider(
  settings: AgentSettings,
  selection?: Partial<ModelSelection> | null,
): ResolvedModelProvider {
  const selectedProviderId =
    selection?.providerId || settings.defaultModel.providerId;
  const selectedModelId = selection?.modelId || settings.defaultModel.modelId;
  const provider =
    settings.providers.find(
      (item) => item.id === selectedProviderId && item.enabled,
    ) ??
    settings.providers.find((item) => item.enabled) ??
    settings.providers[0];

  const model =
    provider?.models.find(
      (item) => item.id === selectedModelId && item.enabled,
    ) ??
    provider?.models.find((item) => item.enabled) ??
    provider?.models[0];

  return {
    provider,
    selection: {
      providerId: provider?.id ?? selectedProviderId,
      modelId: model?.id ?? selectedModelId,
    },
    model: model?.id ?? selectedModelId,
    apiKey: resolveProviderApiKey(provider),
  };
}

export function resolveProviderApiKey(
  provider: Pick<ModelProviderConfig, "apiKey" | "apiKeyEnv"> | undefined,
): string | undefined {
  const direct = provider?.apiKey?.trim();
  if (direct) return direct;
  const envName = provider?.apiKeyEnv?.trim();
  if (!envName) return undefined;
  const value = process.env[envName]?.trim();
  return value || undefined;
}
