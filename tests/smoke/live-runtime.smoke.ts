import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentSettings,
  ModelOption,
  ModelProviderConfig,
} from "../../client/shared/types";
import type { RuntimeEvent } from "../../client/shared/agent-runtime";

async function main(): Promise<void> {
  const { getAgentSettings } =
    await import("../../client/main/services/config-service");
  const { closeStateDbForTests } =
    await import("../../client/main/core/storage/state-db");

  const configuredSettings = getAgentSettings();
  const liveConfig = resolveLiveConfig(configuredSettings);
  const settings = liveConfig.settings;
  const { selectedProvider, selectedModel } = liveConfig;

  if (!selectedProvider || !selectedModel) {
    console.error("LIVE_RUNTIME_CONFIG_MISSING");
    console.error(
      "No enabled provider/model is configured in the current Marloues settings.",
    );
    closeStateDbForTests();
    process.exitCode = 2;
    return;
  }
  if (!selectedProvider.apiKey && !selectedProvider.apiKeyEnv) {
    console.error("LIVE_RUNTIME_API_KEY_MISSING");
    console.error(
      `Provider ${selectedProvider.id} has no API key or apiKeyEnv configured.`,
    );
    closeStateDbForTests();
    process.exitCode = 2;
    return;
  }

  console.info("=== Marloues live runtime smoke ===");
  console.info(`Runtime:  ${settings.activeRuntimeId ?? "sdk"}`);
  console.info(`Config:   ${liveConfig.source}`);
  console.info(`Provider: ${selectedProvider.id} (${selectedProvider.name})`);
  console.info(`Model:    ${selectedModel.id}`);

  const workspace = mkdtempSync(join(tmpdir(), "marloues-live-runtime-"));
  mkdirSync(workspace, { recursive: true });
  const marker = `MARLOUES_LIVE_E2E_${Date.now()}`;
  const markerPath = join(workspace, "e2e-marker.txt");
  writeFileSync(markerPath, marker, "utf-8");
  const liveSettings = liveReadOnlySettings(settings);
  const { destroyRuntime, getRuntime, getRuntimeState, initRuntime } =
    await import("../../client/main/core/runtime/manager");

  try {
    await initRuntime();
    const runtime = getRuntime();
    const state = getRuntimeState();
    const thread = await runtime.createThread("live-runtime-smoke");
    const stream = await runtime.sendMessage({
      threadId: thread.id,
      turnId: "live-runtime-smoke-turn",
      content:
        `必须使用 Read 工具读取这个绝对路径：${markerPath}\n` +
        "不要使用 Bash、Glob、Grep、LS 或其他工具。然后只回复文件内容本身，不要解释，不要添加标点。",
      cwd: workspace,
      settingsSnapshot: liveSettings,
    });
    const events = await collect(stream);
    const text = events
      .filter(
        (event): event is Extract<RuntimeEvent, { kind: "text-chunk" }> =>
          event.kind === "text-chunk",
      )
      .map((event) => event.payload.content)
      .join("");
    const completed = events.find(
      (event): event is Extract<RuntimeEvent, { kind: "turn-complete" }> =>
        event.kind === "turn-complete",
    );
    const toolStarts = events.filter(
      (event): event is Extract<RuntimeEvent, { kind: "tool-start" }> =>
        event.kind === "tool-start",
    );
    console.info(`Active runtime: ${state.activeRuntimeId}`);
    console.info(`Events: ${events.length}`);
    console.info(
      `Tools: ${toolStarts.map((event) => event.payload.toolName).join(", ")}`,
    );
    console.info(`Text: ${text.slice(0, 200)}`);

    if (!completed || completed.payload.result !== "success") {
      throw new Error(
        `Live turn did not complete successfully: ${
          completed?.payload.error ?? completed?.payload.result ?? "missing"
        }`,
      );
    }
    if (!toolStarts.some((event) => event.payload.toolName === "Read")) {
      throw new Error("Live turn did not invoke the Read tool.");
    }
    if (!text.includes(marker)) {
      throw new Error("Live turn did not return the workspace marker.");
    }
    console.info("live runtime smoke ok");
  } finally {
    await destroyRuntime();
    closeStateDbForTests();
  }
}

async function collect(
  stream: AsyncIterable<RuntimeEvent>,
): Promise<RuntimeEvent[]> {
  const events: RuntimeEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

function resolveLiveConfig(settings: AgentSettings): {
  settings: AgentSettings;
  selectedProvider?: ModelProviderConfig;
  selectedModel?: ModelOption;
  source: string;
} {
  const configured = selectConfiguredProvider(settings);
  if (
    configured.selectedProvider &&
    configured.selectedModel &&
    (configured.selectedProvider.apiKey ||
      configured.selectedProvider.apiKeyEnv)
  ) {
    return {
      settings,
      selectedProvider: configured.selectedProvider,
      selectedModel: configured.selectedModel,
      source: "marloues settings",
    };
  }

  const ccSwitch = loadCcSwitchClaudeProvider();
  if (!ccSwitch) {
    return {
      settings,
      selectedProvider: configured.selectedProvider,
      selectedModel: configured.selectedModel,
      source: "marloues settings",
    };
  }

  const ccSwitchSettings: AgentSettings = {
    ...settings,
    providers: [ccSwitch.provider],
    defaultModel: {
      providerId: ccSwitch.provider.id,
      modelId: ccSwitch.model.id,
    },
    activeRuntimeId: "sdk",
  };
  return {
    settings: ccSwitchSettings,
    selectedProvider: ccSwitch.provider,
    selectedModel: ccSwitch.model,
    source: "cc-switch .claude settings",
  };
}

function selectConfiguredProvider(settings: AgentSettings): {
  selectedProvider?: ModelProviderConfig;
  selectedModel?: ModelOption;
} {
  const enabledProviders = settings.providers.filter(
    (provider) => provider.enabled !== false,
  );
  const selectedProvider = enabledProviders.find(
    (provider) => provider.id === settings.defaultModel?.providerId,
  );
  const selectedModel = selectedProvider?.models.find(
    (model) =>
      model.enabled !== false && model.id === settings.defaultModel?.modelId,
  );
  return { selectedProvider, selectedModel };
}

function loadCcSwitchClaudeProvider(): {
  provider: ModelProviderConfig;
  model: ModelOption;
} | null {
  const settingsPath = join(homedir(), ".claude", "settings.json");
  if (!existsSync(settingsPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(settingsPath, "utf-8")) as {
      env?: Record<string, unknown>;
    };
    const env = parsed.env ?? {};
    const apiKey =
      stringValue(env.ANTHROPIC_AUTH_TOKEN) ??
      stringValue(env.ANTHROPIC_API_KEY);
    const baseUrl = stringValue(env.ANTHROPIC_BASE_URL);
    const modelId =
      stringValue(env.ANTHROPIC_MODEL) ??
      stringValue(env.ANTHROPIC_DEFAULT_SONNET_MODEL) ??
      stringValue(env.ANTHROPIC_DEFAULT_HAIKU_MODEL) ??
      stringValue(env.ANTHROPIC_DEFAULT_OPUS_MODEL);
    if (!apiKey || !baseUrl || !modelId) return null;
    process.env.CCSWITCH_LIVE_API_KEY = apiKey;
    const model = { id: modelId, label: modelId, enabled: true };
    return {
      model,
      provider: {
        id: "cc-switch-claude",
        name: "cc-switch Claude",
        kind: "custom",
        enabled: true,
        endpoints: [
          {
            id: "cc-switch-anthropic",
            protocol: "anthropic",
            baseUrl,
            enabled: true,
            priority: 10,
          },
        ],
        apiKeyEnv: "CCSWITCH_LIVE_API_KEY",
        purpose: "test",
        models: [model],
      },
    };
  } catch {
    return null;
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function liveReadOnlySettings(settings: AgentSettings): AgentSettings {
  return {
    ...settings,
    maxTurns: Math.max(settings.maxTurns ?? 0, 6),
    permissionMode: "default",
    sandboxEnabled: true,
    sandboxMode: "workspace-write",
    workMode: "execute",
    toolPermissionPolicy: {
      rules: [],
      allowedTools: ["Read"],
      disallowedTools: [
        "AskUserQuestion",
        "Bash",
        "Glob",
        "Grep",
        "LS",
        "Write",
        "Edit",
        "MultiEdit",
        "NotebookEdit",
        "TodoWrite",
      ],
      sensitiveToolAllowlist: ["Read"],
      requireConfirmationForSensitiveTools: true,
    },
  };
}

main()
  .then(() => {
    process.exit(process.exitCode ?? 0);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
  });
