import type { ChatMessageRecord, ChatSessionRecord } from "@shared/types";
import {
  estimateTextTokens,
  trimTextToTokenBudget,
} from "../core/context/context-policy";
import type { ResolvedModelProvider } from "../core/config/model-provider";
import { configuredProviderEndpoints } from "../core/config/provider-routing";
import { buildProviderEndpointUrl } from "../core/config/provider-endpoint-url";
import { encodeRequest, parseResponse } from "../gateway/protocol";
import type { IrRequest, IrResponse } from "../gateway/types";
import { logWarn } from "../core/logging/app-logger";
import {
  recordSessionArtifact,
  recordSessionCheckpoint,
} from "./session-store";

export interface SessionCompactionInput {
  session: ChatSessionRecord;
  modelProvider: ResolvedModelProvider;
  targetTokens: number;
  currentUserMessageId?: string;
}

export interface SessionCompactionResult {
  statePack: string;
  summaryText: string;
  afterTokens: number;
  source: "model_summary" | "deterministic_state_pack";
  error?: string;
}

export interface RecordSessionCompactionInput extends SessionCompactionInput {
  turnId?: string;
  messageId?: string;
  reason: "preflight" | "mid_turn" | "turn_end" | "model_switch" | "manual";
  totalTokens?: number;
  contextWindowTokens?: number;
  createdAt?: number;
}

export interface RecordedSessionCompactionResult extends SessionCompactionResult {
  checkpointId: string;
  artifactId: string;
}

export function prependStatePackToPrompt(
  statePack: string,
  userText: string,
): string {
  const trimmedPack = statePack.trim();
  const trimmedUserText = userText.trim();
  if (!trimmedPack) return userText;
  if (!trimmedUserText) return trimmedPack;
  return [
    trimmedPack,
    "",
    "---",
    "",
    "Continue from the compressed session state above and answer this latest user message:",
    "",
    trimmedUserText,
  ].join("\n");
}
const RECENT_MESSAGE_COUNT = 8;

export async function compactSessionState(
  input: SessionCompactionInput,
): Promise<SessionCompactionResult> {
  const messages = input.session.messages.filter(
    (message) => message.id !== input.currentUserMessageId,
  );
  const recentMessages = messages.slice(-RECENT_MESSAGE_COUNT);
  const olderMessages = messages.slice(
    0,
    Math.max(0, messages.length - RECENT_MESSAGE_COUNT),
  );
  const targetTokens = Math.max(1, input.targetTokens);
  const summaryBudget = Math.max(1_200, Math.floor(targetTokens * 0.45));

  try {
    const summaryText = olderMessages.length
      ? await summarizeOlderMessages({
          modelProvider: input.modelProvider,
          messages: olderMessages,
          tokenBudget: summaryBudget,
        })
      : "No older conversation needed compaction.";
    const statePack = buildStatePackFromSummary(
      input.session,
      summaryText,
      recentMessages,
      targetTokens,
    );
    return {
      statePack,
      summaryText,
      afterTokens: estimateTextTokens(statePack),
      source: "model_summary",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarn("context.compaction.modelSummaryFailed", {
      sessionId: input.session.id,
      model: input.modelProvider.model,
      error: message,
    });
    const summaryText = deterministicOlderSummary(olderMessages, summaryBudget);
    const statePack = buildStatePackFromSummary(
      input.session,
      summaryText,
      recentMessages,
      targetTokens,
    );
    return {
      statePack,
      summaryText,
      afterTokens: estimateTextTokens(statePack),
      source: "deterministic_state_pack",
      error: message,
    };
  }
}

export async function compactAndRecordSessionState(
  input: RecordSessionCompactionInput,
): Promise<RecordedSessionCompactionResult> {
  const compacted = await compactSessionState(input);
  const createdAt = input.createdAt ?? Date.now();
  const artifactId = recordSessionArtifact({
    sessionId: input.session.id,
    turnId: input.turnId,
    messageId: input.messageId,
    kind: "state_pack",
    title: "Context State Pack",
    summary: compacted.summaryText,
    contentText: compacted.statePack,
    contentJson: {
      source: compacted.source,
      error: compacted.error,
      afterTokens: compacted.afterTokens,
    },
    createdAt,
  });
  const checkpointId = recordSessionCheckpoint({
    sessionId: input.session.id,
    turnId: input.turnId,
    messageId: input.messageId,
    kind: "state_pack",
    reason: input.reason,
    model: input.modelProvider.model,
    contextWindowTokens: input.contextWindowTokens,
    beforeTokens: input.totalTokens,
    afterTokens: compacted.afterTokens,
    targetTokens: Math.max(1, input.targetTokens),
    summaryText: compacted.summaryText,
    statePack: {
      source: compacted.source,
      error: compacted.error,
      artifactId,
      statePack: compacted.statePack,
    },
    artifactRefs: [{ artifactId, role: "state_pack" }],
    createdAt,
  });
  return {
    ...compacted,
    checkpointId,
    artifactId,
  };
}

function buildStatePackFromSummary(
  session: ChatSessionRecord,
  summaryText: string,
  recentMessages: ChatMessageRecord[],
  tokenBudget: number,
): string {
  const recentBudget = Math.max(
    800,
    Math.floor(tokenBudget / Math.max(RECENT_MESSAGE_COUNT, 1)),
  );
  const sections = [
    "# Marloues Session State Pack",
    "",
    "## Session",
    `- Session ID: ${session.id}`,
    `- Title: ${session.title}`,
    session.workspacePath ? `- Workspace: ${session.workspacePath}` : undefined,
    "",
    "## Compressed Long-Term State",
    trimTextToTokenBudget(
      summaryText,
      Math.max(800, Math.floor(tokenBudget * 0.5)),
    ),
    "",
    "## Recent Conversation",
    ...recentMessages.map((message) =>
      [
        `### ${message.role}`,
        trimTextToTokenBudget(
          renderMessageForCompaction(message),
          recentBudget,
        ),
      ].join("\n"),
    ),
    "",
    "## Operating Notes",
    "- Treat this state pack as the authoritative condensed history for this restarted runtime.",
    "- Full-fidelity events, artifacts, tool outputs, and checkpoints remain in Marloues Session Store.",
    "- If a needed old detail is absent, reason from the compressed state and ask for clarification only when required.",
  ].filter((item): item is string => typeof item === "string");
  return trimTextToTokenBudget(sections.join("\n\n"), tokenBudget);
}

async function summarizeOlderMessages(input: {
  modelProvider: ResolvedModelProvider;
  messages: ChatMessageRecord[];
  tokenBudget: number;
}): Promise<string> {
  const apiKey = input.modelProvider.apiKey?.trim();
  if (!apiKey) throw new Error("Model provider is missing API Key.");
  const endpoints = configuredProviderEndpoints(
    input.modelProvider.provider,
  ).sort((left, right) => left.priority - right.priority);
  if (!endpoints.length)
    throw new Error("Model provider has no enabled endpoint.");

  const transcript = trimTextToTokenBudget(
    input.messages.map(renderMessageForCompaction).join("\n\n---\n\n"),
    Math.max(4_000, input.tokenBudget * 2),
  );
  const system = [
    "You compress long agent conversations into a durable state pack.",
    "Preserve user goals, decisions, constraints, open tasks, files touched, model/provider choices, bugs, and exact implementation commitments.",
    "Do not invent facts. Prefer concise structured Chinese when the transcript is Chinese.",
  ].join("\n");
  const prompt = [
    `Target summary budget: about ${input.tokenBudget} tokens.`,
    "Summarize the older conversation below for a coding agent that will continue from this state.",
    "",
    transcript,
  ].join("\n");
  let lastError = "unknown endpoint error";
  for (const endpoint of endpoints) {
    const requestId = `compaction-${Date.now()}-${endpoint.id}`;
    const request: IrRequest = {
      model: input.modelProvider.model,
      system,
      messages: [{ role: "user", content: prompt }],
      generation: {
        maxTokens: Math.min(
          8192,
          Math.max(1024, Math.floor(input.tokenBudget * 0.8)),
        ),
      },
      stream: false,
      meta: {
        sourceProtocol: endpoint.protocol,
        requestId,
        originalModel: input.modelProvider.model,
      },
    };
    const encoded = encodeRequest(endpoint.protocol, request);
    try {
      const response = await fetch(
        buildProviderEndpointUrl(endpoint.baseUrl, encoded.path),
        {
          method: "POST",
          headers: {
            ...encoded.headers,
            ...(endpoint.protocol === "anthropic"
              ? { "x-api-key": apiKey }
              : { authorization: `Bearer ${apiKey}` }),
          },
          body: JSON.stringify(encoded.body),
          signal: AbortSignal.timeout(45_000),
        },
      );
      const body = await response.text();
      if (!response.ok) {
        lastError = `HTTP ${response.status} ${body.slice(0, 500)}`;
        continue;
      }
      const parsed = JSON.parse(body) as unknown;
      const irResponse = parseResponse(
        endpoint.protocol,
        parsed,
        requestId,
        input.modelProvider.model,
      );
      return (
        responseText(irResponse) ||
        deterministicOlderSummary(input.messages, input.tokenBudget)
      );
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(`Compaction model request failed: ${lastError}`);
}

function responseText(response: IrResponse): string {
  const content = response.choices[0]?.message.content;
  if (typeof content === "string") return content.trim();
  return (content ?? [])
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text)
    .join("\n\n")
    .trim();
}

function deterministicOlderSummary(
  messages: ChatMessageRecord[],
  tokenBudget: number,
): string {
  if (!messages.length) return "No older conversation needed compaction.";
  const lines = messages.map((message) => {
    const text = message.content.replace(/\s+/g, " ").trim();
    return `- ${message.role}: ${text}`;
  });
  return trimTextToTokenBudget(lines.join("\n"), tokenBudget);
}

function renderMessageForCompaction(message: ChatMessageRecord): string {
  const timeline = message.timeline?.length
    ? `\nTimeline:\n${message.timeline
        .map(
          (item) =>
            `- ${item.type}: ${item.label}${item.detail ? `\n  ${item.detail}` : ""}`,
        )
        .join("\n")}`
    : "";
  return `[${message.role} | ${new Date(message.createdAt).toISOString()}]\n${message.content}${timeline}`;
}
