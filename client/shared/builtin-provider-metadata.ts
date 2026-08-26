export type BuiltinProviderPresetId = "deepseek" | "minimax" | "zhipu";

export interface BuiltinProviderMetadata {
  id: BuiltinProviderPresetId;
  name: string;
  models: string[];
}

export const BUILTIN_PROVIDER_METADATA: readonly BuiltinProviderMetadata[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    models: ["deepseek-v4-flash", "deepseek-v4-pro"],
  },
  {
    id: "minimax",
    name: "MiniMax",
    models: ["MiniMax-M2.7-highspeed", "MiniMax-M3"],
  },
  {
    id: "zhipu",
    name: "智谱 GLM",
    models: ["glm-5.2"],
  },
] as const;

export function builtinProviderMetadata(
  presetId: string,
): BuiltinProviderMetadata | undefined {
  return BUILTIN_PROVIDER_METADATA.find((preset) => preset.id === presetId);
}
