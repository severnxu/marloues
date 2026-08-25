import { getRuntimeConfigDir } from "../../app-paths";
import type { AgentSettings, ModelSelection } from "@shared/types";
import { resolveModelProvider } from "./model-provider";

export function buildSdkEnv(
  settings: AgentSettings,
  selection?: Partial<ModelSelection> | null,
  connection?: { baseUrl: string; apiKey: string; model?: string },
): Record<string, string | undefined> {
  const resolved = resolveModelProvider(settings, selection);
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      key.startsWith("ANTHROPIC_") ||
      key.startsWith("OPENAI_") ||
      key.startsWith("CLAUDE_")
    ) {
      delete env[key];
    }
  }
  return {
    ...env,
    ANTHROPIC_API_KEY: connection?.apiKey ?? resolved.apiKey,
    ANTHROPIC_AUTH_TOKEN: connection?.apiKey ?? resolved.apiKey,
    ANTHROPIC_BASE_URL: connection?.baseUrl,
    ANTHROPIC_MODEL: connection?.model ?? resolved.model,
    CLAUDE_CONFIG_DIR: settings.runtimeConfigDir || getRuntimeConfigDir(),
    DISABLE_TELEMETRY: "1",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  };
}
