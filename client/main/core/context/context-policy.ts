import type { AgentSettings, ChatSessionRecord, ContextManagementSettings, ModelOption } from "@shared/types";

export type ContextCompactionReason = "preflight" | "mid_turn" | "turn_end" | "model_switch" | "manual";
export type ContextDecisionLevel = "ok" | "warning" | "compact" | "restart" | "blocked";

export interface ContextPolicyInput {
  settings: AgentSettings;
  session?: ChatSessionRecord;
  providerId?: string;
  modelId?: string;
  model?: string;
  totalTokens?: number;
  runtimeLimitTokens?: number;
  reason: ContextCompactionReason;
  previousModelContextWindowTokens?: number;
  consecutiveCompactions?: number;
}

export interface ContextPolicyDecision {
  level: ContextDecisionLevel;
  reason: ContextCompactionReason;
  totalTokens?: number;
  contextWindowTokens: number;
  source: "model_config" | "runtime_limit" | "default";
  percentage?: number;
  targetTokens: number;
  targetPercent: number;
  warningThresholdTokens: number;
  compactThresholdTokens: number;
  restartThresholdTokens: number;
  managedByMarloues: boolean;
  fallback?: ContextFallback;
}

export interface ContextFallback {
  reason: "compaction_limit" | "context_too_large";
  largerModel?: {
    providerId: string;
    modelId: string;
    contextWindowTokens: number;
  };
  actions: Array<"switch_to_larger_model" | "create_small_model_branch" | "new_session">;
}

const DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000;
const DEFAULT_POLICY: ContextManagementSettings = {
  warningThresholdPercent: 70,
  compactThresholdPercent: 85,
  restartThresholdPercent: 92,
  autoCompactEnabled: false,
};

export function evaluateContextPolicy(input: ContextPolicyInput): ContextPolicyDecision {
  const policy = input.settings.contextManagement ?? DEFAULT_POLICY;
  const context = resolveContextWindow(input);
  const targetPercent = input.reason === "model_switch" ? 55 : 62;
  const totalTokens = input.totalTokens;
  const percentage = totalTokens === undefined ? undefined : Math.min(100, (totalTokens / context.tokens) * 100);
  const warningThresholdTokens = Math.floor(context.tokens * (policy.warningThresholdPercent / 100));
  const compactThresholdTokens = Math.floor(context.tokens * (policy.compactThresholdPercent / 100));
  const restartThresholdTokens = Math.floor(context.tokens * (policy.restartThresholdPercent / 100));
  const targetTokens = Math.floor(context.tokens * (targetPercent / 100));
  const level = resolveDecisionLevel({
    totalTokens,
    percentage,
    policy,
    consecutiveCompactions: input.consecutiveCompactions ?? 0,
  });

  return {
    level,
    reason: input.reason,
    totalTokens,
    contextWindowTokens: context.tokens,
    source: context.source,
    percentage,
    targetTokens,
    targetPercent,
    warningThresholdTokens,
    compactThresholdTokens,
    restartThresholdTokens,
    managedByMarloues: true,
    fallback:
      level === "blocked" || level === "restart"
        ? buildFallback(input.settings, context.tokens, input.providerId, input.modelId)
        : undefined,
  };
}

export function estimateSessionTokens(session: ChatSessionRecord): number {
  const text = session.messages
    .map((message) => [message.content, ...(message.timeline ?? []).map((item) => item.detail ?? item.label)].join("\n"))
    .join("\n\n");
  return estimateTextTokens(text);
}

export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  // eslint-disable-next-line no-control-regex
  const asciiChars = text.replace(/[^\x00-\x7F]/g, "").length;
  const nonAsciiChars = text.length - asciiChars;
  return Math.max(1, Math.ceil(asciiChars / 4 + nonAsciiChars / 1.5));
}

export function trimTextToTokenBudget(text: string, tokenBudget: number): string {
  const maxChars = Math.max(200, tokenBudget * 3);
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n...` : text;
}

export function buildStatePack(session: ChatSessionRecord, tokenBudget: number): string {
  const recentMessages = [...session.messages].slice(-8);
  const perMessageBudget = Math.max(800, Math.floor(tokenBudget / Math.max(recentMessages.length, 1)));
  const sections = [
    "# Marloues Session State Pack",
    "",
    "## Current Conversation",
    ...recentMessages.map(
      (message) =>
        `### ${message.role}\n${trimTextToTokenBudget(message.content, perMessageBudget)}`,
    ),
    "",
    "## Recovery Notes",
    "- Full fidelity history is stored in Marloues Session Store.",
    "- Use retrieval before relying on older details not present in this state pack.",
  ];
  return trimTextToTokenBudget(sections.join("\n\n"), tokenBudget);
}

function resolveDecisionLevel(params: {
  totalTokens?: number;
  percentage?: number;
  policy: ContextManagementSettings;
  consecutiveCompactions: number;
}): ContextDecisionLevel {
  if (params.totalTokens === undefined || params.percentage === undefined) return "ok";
  if (params.consecutiveCompactions >= 2 && params.percentage >= params.policy.compactThresholdPercent)
    return "blocked";
  if (params.percentage >= params.policy.restartThresholdPercent) return "restart";
  if (params.percentage >= params.policy.compactThresholdPercent) return "compact";
  if (params.percentage >= params.policy.warningThresholdPercent) return "warning";
  return "ok";
}

function resolveContextWindow(input: ContextPolicyInput): { tokens: number; source: ContextPolicyDecision["source"] } {
  const configured = resolveConfiguredModel(input.settings, input.providerId, input.modelId, input.model)?.contextWindowTokens;
  if (configured !== undefined && Number.isFinite(configured) && configured > 0) {
    return { tokens: configured, source: "model_config" };
  }
  if (input.runtimeLimitTokens !== undefined && Number.isFinite(input.runtimeLimitTokens) && input.runtimeLimitTokens > 0) {
    return { tokens: input.runtimeLimitTokens, source: "runtime_limit" };
  }
  return { tokens: DEFAULT_CONTEXT_WINDOW_TOKENS, source: "default" };
}

function resolveConfiguredModel(
  settings: AgentSettings,
  providerId?: string,
  modelId?: string,
  modelName?: string,
): ModelOption | undefined {
  const provider =
    settings.providers.find((item) => item.id === providerId) ??
    settings.providers.find((item) => item.id === settings.defaultModel.providerId) ??
    settings.providers.find((item) => item.enabled) ??
    settings.providers[0];
  return (
    provider?.models.find((item) => item.id === modelId) ??
    provider?.models.find((item) => item.id === modelName) ??
    provider?.models.find((item) => item.id === settings.defaultModel.modelId) ??
    provider?.models.find((item) => item.enabled) ??
    provider?.models[0]
  );
}

function buildFallback(
  settings: AgentSettings,
  currentWindow: number,
  providerId?: string,
  modelId?: string,
): ContextFallback {
  const larger = settings.providers
    .flatMap((provider) => provider.models.map((model) => ({ provider, model })))
    .filter(
      ({ provider, model }) =>
        provider.enabled &&
        model.enabled !== false &&
        !(provider.id === providerId && model.id === modelId) &&
        typeof model.contextWindowTokens === "number" &&
        model.contextWindowTokens > currentWindow,
    )
    .sort((a, b) => (b.model.contextWindowTokens ?? 0) - (a.model.contextWindowTokens ?? 0))[0];
  return {
    reason: "compaction_limit",
    largerModel: larger
      ? {
          providerId: larger.provider.id,
          modelId: larger.model.id,
          contextWindowTokens: larger.model.contextWindowTokens ?? currentWindow,
        }
      : undefined,
    actions: larger
      ? ["switch_to_larger_model", "create_small_model_branch", "new_session"]
      : ["create_small_model_branch", "new_session"],
  };
}
