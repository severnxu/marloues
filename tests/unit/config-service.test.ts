import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SECRET_ENCRYPTION_UNAVAILABLE_CODE } from "../../client/shared/types";

vi.mock("electron", () => ({ app: undefined }));

let home: string;
let originalHome: string | undefined;

async function loadConfigService(): Promise<typeof import("../../client/main/services/config-service")> {
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

  it("persists under MARLOUES_HOME", async () => {
    const { getSettingsPath } = await import("../../client/main/app-paths");
    const path = getSettingsPath();
    expect(path.startsWith(home)).toBe(true);
    expect(path.endsWith("settings.json")).toBe(true);
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
