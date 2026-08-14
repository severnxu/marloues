/**
 * Config service for ~/.marloues-dev/config/settings.json.
 * API keys are encrypted with Electron safeStorage in providers[].apiKey.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  AgentSettings,
  ContextManagementSettings,
  ModelProviderConfig,
  McpServerConfig,
  ModelOption,
  ModelSelection,
  ToolProfile,
} from "@shared/types";
import { getEnterpriseConfigPath, getLegacyStorePath, getSettingsPath, getRuntimeConfigDir } from "../app-paths";
import { decryptSecret, encryptSecret, isEncryptedSecret } from "./secure-storage.service";
import { logInfo, logWarn } from "../core/logging/app-logger";
import { resolveModelProvider } from "../core/config/model-provider";
import { setRedactionRules } from "../core/security/redaction";

const DEFAULT_MODEL = "local-loop";
type ToolPermissionRuleConfig = { pattern: string; action: "deny" | "ask" | "allow"; description?: string };
type ExtendedToolPermissionPolicy = NonNullable<AgentSettings["toolPermissionPolicy"]> & {
  rules?: ToolPermissionRuleConfig[];
};
type LegacyAgentSettings = Partial<AgentSettings> & {
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  apiKeyEnv?: string;
};

interface EnterpriseConfig {
  agentSettings?: LegacyAgentSettings;
  skillRoots?: unknown;
  policy?: AgentSettings["enterprisePolicy"];
}

function defaultProviders(): ModelProviderConfig[] {
  return [
    {
      id: "default-endpoint",
      name: "Default Endpoint",
      type: "openai-compatible",
      enabled: true,
      purpose: "prod",
      models: [
        normalizeModelOption({ id: DEFAULT_MODEL, label: "Local Loop", enabled: true }),
      ],
    },
  ];
}

function defaultAgentSettings(): AgentSettings {
  return {
    providers: defaultProviders(),
    defaultModel: {
      providerId: "default-endpoint",
      modelId: DEFAULT_MODEL,
    },
    activeRuntimeId: "self-built",
    maxTurns: 50,
    workMode: "execute",
    permissionMode: "default",
    permissionApprovalTimeoutMs: 120_000,
    desktopNotificationsEnabled: true,
    friendlyTone: true,
    customInstructions: "",
    memoryMode: "workspace",
    contextManagement: {
      warningThresholdPercent: 70,
      compactThresholdPercent: 85,
      restartThresholdPercent: 92,
      autoCompactEnabled: false,
    },
    autoMemoryEnabled: true,
    thinkingEnabled: true,
    maxThinkingTokens: 10240,
    activeToolProfileId: "default-tool-policy",
    toolPermissionPolicy: {
      rules: [
        { pattern: "AskUserQuestion", action: "deny", description: "Marloues handles user questions through chat UI." },
        { pattern: "Read", action: "allow" },
        { pattern: "Glob", action: "allow" },
        { pattern: "Grep", action: "allow" },
        { pattern: "LS", action: "allow" },
        { pattern: "TodoWrite", action: "allow" },
      ],
      allowedTools: ["Read", "Glob", "Grep", "LS", "TodoWrite"],
      disallowedTools: ["AskUserQuestion"],
      sensitiveToolAllowlist: ["Read", "Glob", "Grep", "LS", "TodoWrite"],
      requireConfirmationForSensitiveTools: true,
    } satisfies ExtendedToolPermissionPolicy,
    toolProfiles: [
      {
        id: "default-tool-policy",
        name: "Default",
        description: "Default tool policy",
        permissionMode: "default",
        allowedTools: ["Read", "Glob", "Grep", "TodoWrite"],
        disallowedTools: [],
      },
    ],
    mcpServers: [],
    skillDirectories: [],
    disabledSkills: [],
  };
}

interface StoreShape {
  agentSettings: AgentSettings;
}

function readStore(): StoreShape {
  const settingsPath = getSettingsPath();
  migrateSettingsIfNeeded(settingsPath);
  if (!existsSync(settingsPath)) {
    return { agentSettings: defaultAgentSettings() };
  }
  try {
    const raw = readFileSync(settingsPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<StoreShape>;
    const settings = normalizeAgentSettings(decryptAgentSettings(parsed.agentSettings));
    return { agentSettings: settings };
  } catch (error) {
    logWarn("config.readFailed", {
      settingsPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return { agentSettings: defaultAgentSettings() };
  }
}

function migrateSettingsIfNeeded(settingsPath: string): void {
  if (existsSync(settingsPath)) return;
  const legacyStorePath = getLegacyStorePath();
  if (!existsSync(legacyStorePath)) return;
  try {
    mkdirSync(dirname(settingsPath), { recursive: true });
    const legacy = readSettingsFromLegacy(readFileSync(legacyStorePath, "utf-8"));
    writeFileSync(settingsPath, JSON.stringify({ agentSettings: encryptAgentSettings(legacy.agentSettings) }, null, 2), "utf-8");
    logInfo("config.settings.migrated", { legacyStorePath, settingsPath });
  } catch (error) {
    logWarn("config.settings.migrationFailed", {
      legacyStorePath,
      settingsPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function readSettingsFromLegacy(rawStore: string): StoreShape {
  const parsed = JSON.parse(rawStore) as Partial<Omit<StoreShape, "agentSettings">> & {
    agentSettings?: LegacyAgentSettings;
  };
  return { agentSettings: normalizeAgentSettings(decryptAgentSettings(parsed.agentSettings)) };
}
function writeStore(store: StoreShape): void {
  const settingsPath = getSettingsPath();
  try {
    mkdirSync(dirname(settingsPath), { recursive: true });
    const forDisk = { agentSettings: encryptAgentSettings(store.agentSettings) };
    writeFileSync(settingsPath, JSON.stringify(forDisk, null, 2), "utf-8");
  } catch (error) {
    logWarn("config.writeFailed", {
      settingsPath,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function readEnterpriseConfig(): EnterpriseConfig | null {
  const enterprisePath = getEnterpriseConfigPath();
  if (!existsSync(enterprisePath)) return null;
  try {
    const parsed = JSON.parse(stripUtf8Bom(readFileSync(enterprisePath, "utf-8"))) as EnterpriseConfig;
    return {
      ...parsed,
      agentSettings: decryptAgentSettings(parsed.agentSettings),
    };
  } catch (error) {
    logWarn("config.enterprise.readFailed", {
      enterprisePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export function getEnterpriseSkillRoots(): string[] {
  const skillRoots = readEnterpriseConfig()?.skillRoots;
  return Array.isArray(skillRoots)
    ? skillRoots.filter((root): root is string => typeof root === "string" && root.trim().length > 0)
    : [];
}

function applyEnterprisePolicy(settings: AgentSettings): AgentSettings {
  const merged = applyEnterpriseConfigToAgentSettings(settings, readEnterpriseConfig());
  // Inject enterprise redaction rules into the redaction module so every
  // redactSensitiveText/Value call honors policy.redactionRules. Idempotent
  // (setRedactionRules skips when unchanged), safe on the hot getAgentSettings path.
  setRedactionRules(merged.enterprisePolicy?.redactionRules);
  return merged;
}

export function applyEnterpriseConfigToAgentSettings(
  local: AgentSettings,
  enterpriseConfig: EnterpriseConfig | null,
): AgentSettings {
  const enterprise = enterpriseConfig?.agentSettings;
  if (!enterprise) {
    return enterpriseConfig?.policy ? { ...local, enterprisePolicy: enterpriseConfig.policy } : local;
  }

  const enterpriseProviders = enterprise.providers?.length ? normalizeEnterpriseProviders(enterprise.providers) : [];
  const enterpriseMcpServers = enterprise.mcpServers?.length ? enterprise.mcpServers : [];
  const enterpriseToolProfiles = enterprise.toolProfiles?.length ? enterprise.toolProfiles : [];
  const merged: AgentSettings = {
    ...local,
    ...stripUndefined({
      activeRuntimeId: enterprise.activeRuntimeId,
      runtimeConfigDir: enterprise.runtimeConfigDir,
      defaultModel: enterprise.defaultModel,
      maxTurns: enterprise.maxTurns,
      workMode:
        enterprise.workMode !== undefined || (enterprise.permissionMode as unknown) === "plan"
          ? normalizeWorkMode(enterprise.workMode, enterprise.permissionMode)
          : undefined,
      permissionMode:
        enterprise.permissionMode !== undefined ? normalizePermissionMode(enterprise.permissionMode) : undefined,
      permissionApprovalTimeoutMs:
        enterprise.permissionApprovalTimeoutMs === undefined
          ? undefined
          : normalizePermissionApprovalTimeoutMs(enterprise.permissionApprovalTimeoutMs),
      desktopNotificationsEnabled: enterprise.desktopNotificationsEnabled,
      friendlyTone: enterprise.friendlyTone,
      customInstructions: enterprise.customInstructions,
      memoryMode: enterprise.memoryMode,
      contextManagement: enterprise.contextManagement,
      toolPermissionPolicy: enterprise.toolPermissionPolicy,
      autoMemoryEnabled: enterprise.autoMemoryEnabled,
      autoMemoryDirectory: enterprise.autoMemoryDirectory,
      autoDreamEnabled: enterprise.autoDreamEnabled,
      thinkingEnabled: enterprise.thinkingEnabled,
      maxThinkingTokens: enterprise.maxThinkingTokens,
      activeToolProfileId: enterprise.activeToolProfileId,
      skillDirectories: enterprise.skillDirectories,
      disabledSkills: enterprise.disabledSkills,
    }),
    providers: enterpriseProviders.length
      ? mergeProviders(local.providers, enterpriseProviders.map(markEnterpriseProvider))
      : local.providers,
    mcpServers: enterpriseMcpServers.length
      ? mergeMcpServers(local.mcpServers, enterpriseMcpServers.map(markEnterpriseMcpServer))
      : local.mcpServers,
    toolProfiles: enterpriseToolProfiles.length
      ? mergeToolProfiles(local.toolProfiles, enterpriseToolProfiles.map(markEnterpriseToolProfile))
      : local.toolProfiles,
  };

  return {
    ...normalizeAgentSettings(merged),
    enterprisePolicy: enterpriseConfig?.policy,
    enterpriseControlledSettings: Object.keys(enterprise).filter(
      (key) => (enterprise as Record<string, unknown>)[key] !== undefined,
    ),
  };
}

function stripUtf8Bom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}
function decryptAgentSettings(settings: LegacyAgentSettings | undefined): LegacyAgentSettings {
  if (!settings) return {};
  return {
    ...settings,
    apiKey: decryptSecret(settings.apiKey),
    providers: settings.providers?.map((provider) => ({
      ...provider,
      apiKey: decryptSecret(provider.apiKey),
    })),
  };
}

function encryptAgentSettings(settings: AgentSettings): AgentSettings {
  const { enterprisePolicy: _enterprisePolicy, enterpriseControlledSettings: _enterpriseControlledSettings, ...settingsForDisk } = settings;
  return {
    ...settingsForDisk,
    providers: settingsForDisk.providers.map(materializeProviderForDisk),
    mcpServers: settingsForDisk.mcpServers.map(stripMcpServerForDisk),
    toolProfiles: settingsForDisk.toolProfiles.map(stripPolicyMetadata),
  };
}

function materializeProviderForDisk(provider: ModelProviderConfig): ModelProviderConfig {
  const stripped = stripPolicyMetadata(provider);
  return stripUndefined({
    ...stripped,
    apiKey: encryptSecret(stripped.apiKey),
  }) as ModelProviderConfig;
}

function stripMcpServerForDisk(server: AgentSettings["mcpServers"][number]): AgentSettings["mcpServers"][number] {
  return stripUndefined(stripPolicyMetadata(server)) as AgentSettings["mcpServers"][number];
}

function stripPolicyMetadata<T extends { source?: unknown; locked?: unknown }>(value: T): Omit<T, "source" | "locked"> {
  const { source: _source, locked: _locked, ...rest } = value;
  return rest;
}

function stripUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;
}

function normalizeEnterpriseProviders(providers: ModelProviderConfig[]): ModelProviderConfig[] {
  return normalizeAgentSettings({ providers }).providers;
}

function mergeProviders(local: ModelProviderConfig[], enterprise: ModelProviderConfig[]): ModelProviderConfig[] {
  const enterpriseKeys = new Set(enterprise.flatMap((provider) => [provider.id, provider.name]));
  return [
    ...enterprise,
    ...local.filter((provider) => !enterpriseKeys.has(provider.id) && !enterpriseKeys.has(provider.name)),
  ];
}

function markEnterpriseProvider(provider: ModelProviderConfig): ModelProviderConfig {
  return { ...provider, source: "enterprise", locked: true };
}

function markEnterpriseMcpServer(server: McpServerConfig): McpServerConfig {
  return { ...server, source: "enterprise", locked: true };
}

function markEnterpriseToolProfile(profile: ToolProfile): ToolProfile {
  return { ...profile, source: "enterprise", locked: true };
}

function mergeMcpServers(local: McpServerConfig[], enterprise: McpServerConfig[]): McpServerConfig[] {
  const enterpriseKeys = new Set(enterprise.flatMap((server) => [server.id, server.name]));
  return [
    ...enterprise,
    ...local.filter((server) => !enterpriseKeys.has(server.id) && !enterpriseKeys.has(server.name)),
  ];
}

function mergeToolProfiles(local: ToolProfile[], enterprise: ToolProfile[]): ToolProfile[] {
  const enterpriseKeys = new Set(enterprise.map((profile) => profile.id));
  return [...enterprise, ...local.filter((profile) => !enterpriseKeys.has(profile.id))];
}
function normalizeAgentSettings(settings: LegacyAgentSettings | undefined): AgentSettings {
  const defaults = defaultAgentSettings();
  if (!settings) return defaults;
  const legacyRuntimeConfigDir = (settings as Partial<AgentSettings> & Record<string, unknown>)['clau' + 'deConfigDir'];

  const providers = normalizeProviders(settings, defaults.providers);
  const defaultModel = normalizeDefaultModel(settings, providers, defaults.defaultModel);
  const toolProfiles = settings.toolProfiles?.length ? settings.toolProfiles : defaults.toolProfiles;
  const activeToolProfileId = resolveActiveToolProfileId(toolProfiles, settings.activeToolProfileId);
  const activeToolProfile = toolProfiles.find((profile) => profile.id === activeToolProfileId);

  return {
    ...defaults,
    ...settings,
    runtimeConfigDir: settings.runtimeConfigDir ?? (typeof legacyRuntimeConfigDir === "string" ? legacyRuntimeConfigDir : undefined),
    providers,
    defaultModel,
    workMode: normalizeWorkMode(settings.workMode, settings.permissionMode),
    permissionMode: normalizePermissionMode(settings.permissionMode),
    permissionApprovalTimeoutMs: normalizePermissionApprovalTimeoutMs(settings.permissionApprovalTimeoutMs),
    memoryMode: normalizeMemoryMode(settings.memoryMode),
    contextManagement: normalizeContextManagementSettings(settings.contextManagement),
    activeToolProfileId,
    toolProfiles,
    toolPermissionPolicy: normalizeToolPermissionPolicy(settings.toolPermissionPolicy, activeToolProfile),
    mcpServers: settings.mcpServers ?? [],
    skillDirectories: settings.skillDirectories ?? [],
    disabledSkills: settings.disabledSkills ?? [],
  };
}

function normalizeProviders(settings: LegacyAgentSettings, defaults: ModelProviderConfig[]): ModelProviderConfig[] {
  if (settings.providers?.length) {
    return settings.providers.map((p) => ({
      ...p,
      type: normalizeProviderType(p.type),
      enabled: p.enabled !== false,
      models: p.models?.length ? p.models.map(normalizeModelOption) : [],
    }));
  }

  if (!settings.model && !settings.baseUrl && !settings.apiKey && !settings.apiKeyEnv) {
    return defaults;
  }

  const modelId = settings.model || DEFAULT_MODEL;
  const providerId = modelId.toLowerCase().includes("minimax") ? "minimax" : "legacy-endpoint";
  const providerName = providerId === "minimax" ? "MiniMax Test Endpoint" : "Legacy Endpoint";
  return [
    {
      id: providerId,
      name: providerName,
      type: "openai-compatible",
      enabled: true,
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      apiKeyEnv: settings.apiKeyEnv,
      purpose: providerId === "minimax" ? "test" : "prod",
      models: [normalizeModelOption({ id: modelId, label: modelId, enabled: true })],
    },
    ...defaults.filter((provider) => provider.id !== providerId).map((provider) => ({ ...provider, enabled: false })),
  ];
}

function normalizeDefaultModel(
  settings: LegacyAgentSettings,
  providers: ModelProviderConfig[],
  fallback: ModelSelection,
): ModelSelection {
  if (settings.providers?.length && settings.defaultModel) return settings.defaultModel;
  if (!providers.length) return settings.defaultModel ?? fallback;
  const requested = settings.defaultModel;
  const provider =
    providers.find((item) => item.id === requested?.providerId && item.enabled) ??
    providers.find((item) => item.models.some((model) => model.id === (requested?.modelId || settings.model))) ??
    providers.find((item) => item.enabled) ??
    providers[0];
  const model =
    provider.models.find((item) => item.id === requested?.modelId && item.enabled) ??
    provider.models.find((item) => item.id === settings.model && item.enabled) ??
    provider.models.find((item) => item.enabled) ??
    provider.models[0];
  return {
    providerId: provider.id,
    modelId: model?.id ?? settings.model ?? fallback.modelId,
  };
}
function resolveActiveToolProfileId(toolProfiles: ToolProfile[], requestedId: string | undefined): string {
  if (requestedId && toolProfiles.some((profile) => profile.id === requestedId)) return requestedId;
  return toolProfiles[0]?.id ?? "default-tool-policy";
}

function normalizeToolPermissionPolicy(
  policy: AgentSettings["toolPermissionPolicy"],
  fallbackProfile: ToolProfile | undefined,
): AgentSettings["toolPermissionPolicy"] {
  const defaults = defaultAgentSettings().toolPermissionPolicy as ExtendedToolPermissionPolicy;
  const rules = (policy as ExtendedToolPermissionPolicy | undefined)?.rules ?? defaults.rules;
  return {
    rules,
    allowedTools: normalizeToolList(policy?.allowedTools) ?? fallbackProfile?.allowedTools ?? defaults.allowedTools,
    disallowedTools: normalizeToolList(policy?.disallowedTools) ?? fallbackProfile?.disallowedTools ?? defaults.disallowedTools,
    sensitiveToolAllowlist:
      normalizeToolList(policy?.sensitiveToolAllowlist) ?? defaults.sensitiveToolAllowlist,
    requireConfirmationForSensitiveTools:
      policy?.requireConfirmationForSensitiveTools ?? defaults.requireConfirmationForSensitiveTools,
  };
}

function normalizeToolList(tools: unknown): string[] | undefined {
  if (!Array.isArray(tools)) return undefined;
  const normalized = tools
    .filter((tool): tool is string => typeof tool === "string")
    .map((tool) => tool.trim())
    .filter(Boolean);
  return normalized.length ? Array.from(new Set(normalized)) : [];
}

function normalizeProviderType(type: unknown): ModelProviderConfig["type"] {
  const legacyProviderType = ["anthropic", "compatible"].join("-");
  return type === "openai-compatible" || type === legacyProviderType ? "openai-compatible" : "openai-compatible";
}
function normalizePermissionMode(mode: unknown): AgentSettings["permissionMode"] {
  return mode === "acceptEdits" || mode === "bypassPermissions" ? mode : "default";
}

function normalizeWorkMode(mode: unknown, legacyPermissionMode: unknown): AgentSettings["workMode"] {
  return mode === "plan" || legacyPermissionMode === "plan" ? "plan" : "execute";
}

function normalizeMemoryMode(mode: unknown): AgentSettings["memoryMode"] {
  return mode === "session" || mode === "off" ? mode : "workspace";
}

function defaultContextManagementSettings(): ContextManagementSettings {
  return defaultAgentSettings().contextManagement as ContextManagementSettings;
}

function normalizeContextManagementSettings(value: unknown): ContextManagementSettings {
  const defaults = defaultContextManagementSettings();
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaults;
  const record = value as Record<string, unknown>;
  return {
    warningThresholdPercent: normalizePercent(record.warningThresholdPercent, defaults.warningThresholdPercent),
    compactThresholdPercent: normalizePercent(record.compactThresholdPercent, defaults.compactThresholdPercent),
    restartThresholdPercent: normalizePercent(record.restartThresholdPercent, defaults.restartThresholdPercent),
    autoCompactEnabled: record.autoCompactEnabled === true,
  };
}

function normalizePercent(value: unknown, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, 1), 99);
}

function normalizePermissionApprovalTimeoutMs(value: unknown): number {
  const timeout = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(timeout)) return 120_000;
  return Math.min(Math.max(Math.trunc(timeout), 10_000), 3_600_000);
}

function normalizeModelOption(model: Partial<ModelOption>): ModelOption {
  const id = model.id ?? "";
  const preset = modelMetadataPreset(id);
  return {
    id,
    label: model.label ?? id,
    enabled: model.enabled !== false,
    contextWindowTokens: normalizePositiveInteger(model.contextWindowTokens) ?? preset.contextWindowTokens,
    maxOutputTokens: normalizePositiveInteger(model.maxOutputTokens) ?? preset.maxOutputTokens,
    supportsVision: model.supportsVision ?? preset.supportsVision,
    supportsThinking: model.supportsThinking ?? preset.supportsThinking,
  };
}

function modelMetadataPreset(modelId: string): Partial<ModelOption> {
  const id = modelId.toLowerCase();
  if (id === "deepseek-v4-flash" || id === "deepseek-v4-pro") {
    return {
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 384_000,
      supportsThinking: true,
      supportsVision: false,
    };
  }
  return {};
}

function normalizePositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const normalized = Math.trunc(value);
  return normalized > 0 ? normalized : undefined;
}

function readRawAgentSettings(): Partial<AgentSettings> | undefined {
  try {
    const raw = readFileSync(getSettingsPath(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<StoreShape>;
    return parsed.agentSettings;
  } catch {
    return undefined;
  }
}

function preserveExistingEncryptedProviderSecrets(
  settings: AgentSettings,
  rawSettings: Partial<AgentSettings> | undefined,
): AgentSettings {
  if (!rawSettings?.providers?.length) return settings;
  return {
    ...settings,
    providers: settings.providers.map((provider) => {
      const rawProvider = rawSettings.providers?.find((item) => item.id === provider.id || item.name === provider.name);
      const encryptedApiKey = rawProvider?.apiKey;
      if (!isEncryptedSecret(encryptedApiKey)) return provider;
      if (provider.apiKey !== undefined && provider.apiKey.trim() !== "") return provider;
      return { ...provider, apiKey: encryptedApiKey };
    }),
  };
}
export function getAgentSettings(): AgentSettings {
  return applyEnterprisePolicy(readStore().agentSettings);
}

export function saveAgentSettings(settings: AgentSettings): void {
  const normalized = preserveExistingEncryptedProviderSecrets(
    normalizeAgentSettings(
      sanitizeLocalAgentSettingsForSave(settings, readStore().agentSettings, readEnterpriseConfig()),
    ),
    readRawAgentSettings(),
  );
  writeStore({ agentSettings: normalized });
  logInfo("config.saved", { settingsPath: getSettingsPath() });
}


export function sanitizeLocalAgentSettingsForSave(
  submitted: AgentSettings,
  currentLocal: AgentSettings,
  enterpriseConfig: EnterpriseConfig | null,
): AgentSettings {
  if (!enterpriseConfig) {
    return stripTransientPolicyFields(submitted);
  }

  const enterprise = enterpriseConfig.agentSettings ?? {};
  const policy = enterpriseConfig.policy ?? {};
  const enterpriseProviders = enterprise.providers?.length ? normalizeEnterpriseProviders(enterprise.providers) : [];
  const enterpriseMcpServers = enterprise.mcpServers?.length ? enterprise.mcpServers : [];
  const enterpriseToolProfiles = enterprise.toolProfiles ?? [];
  const next = stripTransientPolicyFields(submitted);

  return {
    ...next,
    ...preserveEnterpriseControlledScalars(next, currentLocal, enterprise),
    providers:
      policy.allowLocalEndpointProfiles === false
        ? currentLocal.providers
        : filterEnterpriseItems(next.providers, enterpriseProviders, (item) => [item.id, item.name]),
    mcpServers:
      policy.allowLocalMcpServers === false
        ? currentLocal.mcpServers
        : filterEnterpriseItems(next.mcpServers, enterpriseMcpServers, (item) => [item.id, item.name]),
    toolProfiles:
      policy.allowLocalToolProfiles === false
        ? currentLocal.toolProfiles
        : filterEnterpriseItems(next.toolProfiles, enterpriseToolProfiles, (item) => [item.id]),
    disabledSkills: policy.allowLocalSkillDisable === false ? currentLocal.disabledSkills : next.disabledSkills,
  };
}

function stripTransientPolicyFields(settings: AgentSettings): AgentSettings {
  const {
    enterprisePolicy: _enterprisePolicy,
    enterpriseControlledSettings: _enterpriseControlledSettings,
    ...settingsWithoutPolicy
  } = settings;
  return {
    ...settingsWithoutPolicy,
    providers: settingsWithoutPolicy.providers.map(stripPolicyMetadata),
    mcpServers: settingsWithoutPolicy.mcpServers.map(stripPolicyMetadata),
    toolProfiles: settingsWithoutPolicy.toolProfiles.map(stripPolicyMetadata),
  };
}

function preserveEnterpriseControlledScalars(
  submitted: AgentSettings,
  currentLocal: AgentSettings,
  enterprise: Partial<AgentSettings>,
): Partial<AgentSettings> {
  const preserved: Partial<AgentSettings> = {};
  for (const key of [
    "activeRuntimeId",
    "runtimeConfigDir",
    "defaultModel",
    "maxTurns",
    "workMode",
    "permissionMode",
    "permissionApprovalTimeoutMs",
    "desktopNotificationsEnabled",
    "friendlyTone",
    "customInstructions",
    "memoryMode",
    "contextManagement",
    "toolPermissionPolicy",
    "autoMemoryEnabled",
    "autoMemoryDirectory",
    "autoDreamEnabled",
    "thinkingEnabled",
    "maxThinkingTokens",
    "activeToolProfileId",
    "skillDirectories",
  ] as const) {
    preserved[key] = (enterprise[key] !== undefined ? currentLocal[key] : submitted[key]) as never;
  }
  return preserved;
}

function filterEnterpriseItems<T>(submittedItems: T[], enterpriseItems: T[], keyReader: (item: T) => string[]): T[] {
  const enterpriseKeys = new Set(enterpriseItems.flatMap(keyReader));
  return submittedItems.filter((item) => {
    const maybePolicyItem = item as { source?: unknown; locked?: unknown };
    if (maybePolicyItem.source === "enterprise" || maybePolicyItem.locked === true) return false;
    return keyReader(item).every((key) => !enterpriseKeys.has(key));
  });
}
export function buildSdkEnv(
  settings: AgentSettings,
  selection?: Partial<ModelSelection> | null,
): Record<string, string | undefined> {
  const resolved = resolveModelProvider(settings, selection);

  const env: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("ANTHROPIC_") && !key.startsWith("OPENAI_") && !key.startsWith("CLAUDE_")) {
      env[key] = value;
    }
  }

  return {
    ...env,
    ANTHROPIC_API_KEY: resolved.apiKey,
    ANTHROPIC_AUTH_TOKEN: resolved.apiKey,
    ANTHROPIC_BASE_URL: resolved.baseUrl,
    ANTHROPIC_MODEL: resolved.model,
    CLAUDE_CONFIG_DIR: settings.runtimeConfigDir || getRuntimeConfigDir(),
    DISABLE_TELEMETRY: "1",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  };
}
