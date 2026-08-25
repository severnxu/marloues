import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SECRET_ENCRYPTION_UNAVAILABLE_CODE } from "../../client/shared/types";

vi.mock("electron", () => ({ app: undefined }));

let home: string;
let originalHome: string | undefined;

async function loadConfigService(): Promise<
  typeof import("../../client/main/services/config-service")
> {
  return await import("../../client/main/services/config-service");
}

beforeAll(() => {
  originalHome = process.env.MARLOUES_HOME;
  home = mkdtempSync(join(tmpdir(), "marloues-config-test-"));
  process.env.MARLOUES_HOME = home;
});

afterAll(() => {
  if (originalHome === undefined) {
    delete process.env.MARLOUES_HOME;
  } else {
    process.env.MARLOUES_HOME = originalHome;
  }
  rmSync(home, { recursive: true, force: true });
});

describe("config-service", () => {
  it("provides default settings with providers and defaultModel", async () => {
    const { getAgentSettings } = await loadConfigService();
    const settings = getAgentSettings();
    expect(Array.isArray(settings.providers)).toBe(true);
    expect(settings.defaultModel).toBeDefined();
  });

  it("round-trips saved settings", async () => {
    const { getAgentSettings, saveAgentSettings } = await loadConfigService();
    const before = getAgentSettings();
    saveAgentSettings({ ...before, activeRuntimeId: "binary" });
    const after = getAgentSettings();
    expect(after.activeRuntimeId).toBe("binary");
  });

  it("never persists endpoint addresses on built-in providers", async () => {
    const { getAgentSettings, saveAgentSettings } = await loadConfigService();
    const { getSettingsPath } = await import("../../client/main/app-paths");
    const before = getAgentSettings();
    const pollutedProvider = {
      id: "deepseek-builtin",
      name: "DeepSeek",
      kind: "builtin" as const,
      presetId: "deepseek",
      enabled: true,
      models: [{ id: "deepseek-v4-flash", enabled: true }],
      baseUrl: "https://must-not-persist.example/v1",
      endpoints: [
        {
          id: "must-not-persist",
          protocol: "openai-chat" as const,
          baseUrl: "https://must-not-persist.example/v1",
          enabled: true,
          priority: 10,
        },
      ],
    };

    saveAgentSettings({
      ...before,
      providers: [pollutedProvider],
      defaultModel: {
        providerId: pollutedProvider.id,
        modelId: pollutedProvider.models[0].id,
      },
    });

    const persisted = JSON.parse(readFileSync(getSettingsPath(), "utf8")) as {
      agentSettings: { providers: Array<Record<string, unknown>> };
    };
    expect(persisted.agentSettings.providers[0]).not.toHaveProperty("baseUrl");
    expect(persisted.agentSettings.providers[0]).not.toHaveProperty(
      "endpoints",
    );
  });

  it("persists under MARLOUES_HOME", async () => {
    const { getSettingsPath } = await import("../../client/main/app-paths");
    const path = getSettingsPath();
    expect(path.startsWith(home)).toBe(true);
    expect(path.endsWith("settings.json")).toBe(true);
  });

  it("routes the SDK environment through the gateway base URL when provided", async () => {
    const { buildSdkEnv, getAgentSettings } = await loadConfigService();
    const settings = getAgentSettings();
    const provider = settings.providers[0];
    const routedSettings = {
      ...settings,
      providers: [
        {
          ...provider,
          kind: "custom" as const,
          endpoints: [
            {
              id: "provider-anthropic",
              protocol: "anthropic" as const,
              baseUrl: "https://provider.example",
              enabled: true,
              priority: 10,
            },
          ],
          apiKey: "provider-key",
        },
      ],
    };

    expect(
      buildSdkEnv(routedSettings, null, {
        baseUrl: "http://127.0.0.1:45678",
        apiKey: "gateway-token",
      }).ANTHROPIC_BASE_URL,
    ).toBe("http://127.0.0.1:45678");
    expect(
      buildSdkEnv(routedSettings, null, {
        baseUrl: "http://127.0.0.1:45678",
        apiKey: "gateway-token",
      }).ANTHROPIC_API_KEY,
    ).toBe("gateway-token");
  });

  it("propagates encryption failures without overwriting the existing config", async () => {
    const { getAgentSettings, saveAgentSettings } = await loadConfigService();
    const { getSettingsPath } = await import("../../client/main/app-paths");
    const before = getAgentSettings();
    saveAgentSettings(before);
    const diskBefore = readFileSync(getSettingsPath(), "utf8");
    const providers = before.providers.map((provider, index) =>
      index === 0 ? { ...provider, apiKey: "sk-must-not-fall-back" } : provider,
    );

    expect(() => saveAgentSettings({ ...before, providers })).toThrow(
      new RegExp(SECRET_ENCRYPTION_UNAVAILABLE_CODE),
    );
    expect(readFileSync(getSettingsPath(), "utf8")).toBe(diskBefore);
  });
});
