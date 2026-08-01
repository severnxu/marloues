/**
 * Claude Runtime Adapter.
 *
 * Bridges @anthropic-ai/claude-agent-sdk into the AgentRuntime SPI.
 * It normalizes SDK messages, streams runtime events, manages thread state,
 * and delegates tool permissions to the shared permission engine.
 */

import type {
  AgentRuntime,
  RuntimeEvent,
  Thread,
  Message,
  ToolDefinition,
  PermissionMode,
  RuntimeCapabilities,
} from "@shared/agent-runtime";
import type {
  AgentSettings,
  MemoryRecallRecord,
  ModelOption,
  TokenUsage,
} from "@shared/types";
import { queryClaude, type ClaudeQuery } from "../sdk/claude-sdk";
import { getAgentSettings, buildSdkEnv } from "../../services/config-service";
import { recordMcpRuntimeStatus } from "../../services/mcp-service";
import { evaluateContextPolicy } from "../context/context-policy";
import { resolveModelProvider } from "../config/model-provider";
import { buildClaudeRuntimeOptions } from "../config/options-builder";
import { configuredMcpTools } from "./mcp-tools";
import { configuredRuntimeModels } from "./runtime-models";
import { workflowThreadStore } from "./workflow-thread-store";
import { evaluateToolPermission } from "../permissions/tool-permission-engine";
import { ToolStormBreaker } from "./tool-storm-breaker";
import { logInfo, logWarn } from "../logging/app-logger";

// ========================
//  helpers
// ========================

function genId(): string {
  return crypto.randomUUID();
}

function now(): number {
  return Date.now();
}

function modelSnapshotFromSettings(settings: AgentSettings): {
  modelId: string;
  modelName: string;
} {
  const modelProvider = resolveModelProvider(settings);
  const modelId = modelProvider.selection.modelId || modelProvider.model;
  const model = modelProvider.provider?.models.find(
    (item) => item.id === modelId,
  );
  return {
    modelId,
    modelName: model?.label || modelId,
  };
}

interface StreamingToolBlock {
  id: string;
  name: string;
  partialInput: string;
}

const streamingToolBlocks = new Map<string, StreamingToolBlock>();
const turnsWithStreamedText = new Set<string>();
const turnsWithStreamedThinking = new Set<string>();

function streamingToolKey(
  sessionId: string,
  turnId: string,
  index: unknown,
): string {
  return `${sessionId}:${turnId}:${String(index ?? 0)}`;
}

function turnStreamKey(sessionId: string, turnId: string): string {
  return `${sessionId}:${turnId}`;
}

function clearTurnStreamState(sessionId: string, turnId: string): void {
  const keyPrefix = `${sessionId}:${turnId}:`;
  turnsWithStreamedText.delete(turnStreamKey(sessionId, turnId));
  turnsWithStreamedThinking.delete(turnStreamKey(sessionId, turnId));
  for (const key of streamingToolBlocks.keys()) {
    if (key.startsWith(keyPrefix)) streamingToolBlocks.delete(key);
  }
}

function stringifyToolInput(value: unknown): string {
  if (value === undefined) return "";
  if (isEmptyObject(value)) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function isEmptyObject(value: unknown): boolean {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0,
  );
}

function appendToolInputDelta(current: string, delta: string): string {
  if (current.trim() === "{}" && /^[\s]*[{[]/.test(delta)) return delta;
  return current + delta;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function stringifyStatusDetail(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isClosedQueryContextUsageError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /query closed before response received/i.test(message);
}

function isLikelyClaudeSessionId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function normalizeMemoryRecall(
  message: Record<string, unknown>,
): MemoryRecallRecord[] {
  const memories = message.memories;
  if (!Array.isArray(memories)) return [];
  return memories
    .filter((memory): memory is Record<string, unknown> =>
      Boolean(memory && typeof memory === "object"),
    )
    .map((memory) => ({
      path: typeof memory.path === "string" ? memory.path : "",
      scope: (memory.scope === "team"
        ? "team"
        : "personal") as MemoryRecallRecord["scope"],
      content: typeof memory.content === "string" ? memory.content : undefined,
    }))
    .filter((memory) => memory.path.trim());
}

function normalizeRuntimeStatus(
  message: Record<string, unknown>,
): Extract<RuntimeEvent, { kind: "runtime-status" }>["payload"] | null {
  const subtype = message.subtype as string | undefined;
  if (subtype === "status") {
    return {
      turnId: "",
      label: message.status ? `SDK ${String(message.status)}` : "SDK status",
      detail: stringifyStatusDetail({
        permissionMode: message.permissionMode,
        compactResult: message.compact_result,
        compactError: message.compact_error,
      }),
      status:
        message.compact_result === "failed"
          ? "error"
          : message.status === "requesting" || message.status === "compacting"
            ? "running"
            : "completed",
    };
  }
  if (subtype === "session_state_changed") {
    return {
      turnId: "",
      label: `Session ${String(message.state ?? "state changed")}`,
      status:
        message.state === "running"
          ? "running"
          : message.state === "requires_action"
            ? "pending"
            : "completed",
    };
  }
  if (subtype === "notification") {
    return {
      turnId: "",
      label: `Notification: ${String(message.key ?? "SDK")}`,
      detail: typeof message.text === "string" ? message.text : undefined,
      status:
        message.priority === "high" || message.priority === "immediate"
          ? "pending"
          : "completed",
    };
  }
  if (subtype === "permission_denied") {
    return {
      turnId: "",
      label: `Permission denied: ${String(message.tool_name ?? "tool")}`,
      detail:
        typeof message.decision_reason === "string"
          ? message.decision_reason
          : typeof message.message === "string"
            ? message.message
            : undefined,
      status: "error",
    };
  }
  return null;
}

function normalizeTaskRuntimeStatus(
  message: Record<string, unknown>,
): Extract<RuntimeEvent, { kind: "runtime-status" }>["payload"] | null {
  const subtype = message.subtype as string | undefined;
  const id = String(
    message.task_id ?? message.tool_use_id ?? `task-${Date.now()}`,
  );
  if (subtype === "task_started") {
    return {
      turnId: "",
      id,
      label:
        typeof message.description === "string"
          ? message.description
          : typeof message.workflow_name === "string"
            ? message.workflow_name
            : "Task started",
      detail: typeof message.prompt === "string" ? message.prompt : undefined,
      status: "running",
    };
  }
  if (subtype === "task_progress") {
    return {
      turnId: "",
      id,
      label:
        typeof message.summary === "string"
          ? message.summary
          : typeof message.description === "string"
            ? message.description
            : "Task progress",
      detail:
        typeof message.last_tool_name === "string"
          ? `Last tool: ${message.last_tool_name}`
          : undefined,
      status: "running",
    };
  }
  if (subtype === "task_updated") {
    const patch =
      message.patch && typeof message.patch === "object"
        ? (message.patch as Record<string, unknown>)
        : {};
    const status = patch.status;
    return {
      turnId: "",
      id,
      label:
        typeof patch.description === "string"
          ? patch.description
          : "Task updated",
      detail: typeof patch.error === "string" ? patch.error : undefined,
      status:
        status === "failed" || status === "killed"
          ? "error"
          : status === "completed"
            ? "completed"
            : status === "pending"
              ? "pending"
              : "running",
    };
  }
  if (subtype === "task_notification") {
    return {
      turnId: "",
      id,
      label:
        typeof message.summary === "string"
          ? message.summary
          : "Task completed",
      detail:
        typeof message.output_file === "string"
          ? message.output_file
          : undefined,
      status:
        message.status === "failed" || message.status === "stopped"
          ? "error"
          : "completed",
    };
  }
  return null;
}

// ========================
// SDK message normalization helpers.
// ========================

/**
 * Converts Claude SDK messages into internal RuntimeEvent records.
 */
export function normalizeSdkMessage(
  sessionId: string,
  turnId: string,
  message: unknown,
): RuntimeEvent[] {
  const events: RuntimeEvent[] = [];
  const msg = message as Record<string, unknown>;

  // ---------- System events ----------
  if (msg.type === "system") {
    const subtype = msg.subtype as string | undefined;

    if (subtype === "init") {
      events.push({
        kind: "turn-start",
        payload: { turnId, timestamp: now() },
      });
      events.push({
        kind: "session-info",
        payload: {
          turnId,
          skills: stringArray(msg.skills),
          slashCommands: stringArray(msg.slash_commands),
          agents: stringArray(msg.agents),
        },
      });
    }

    if (subtype === "memory_recall") {
      events.push({
        kind: "memory-recall",
        payload: {
          turnId,
          mode: msg.mode === "synthesize" ? "synthesize" : "select",
          memories: normalizeMemoryRecall(msg),
        },
      });
    }

    if (Array.isArray(msg.mcp_servers)) {
      events.push({
        kind: "mcp-status",
        payload: {
          turnId,
          servers: msg.mcp_servers,
          tools: stringArray(msg.tools),
        },
      });
    }

    const runtimeStatus = normalizeRuntimeStatus(msg);
    if (runtimeStatus) {
      events.push({
        kind: "runtime-status",
        payload: { ...runtimeStatus, turnId },
      });
    }

    const taskStatus = normalizeTaskRuntimeStatus(msg);
    if (taskStatus) {
      events.push({
        kind: "runtime-status",
        payload: { ...taskStatus, turnId },
      });
    }

    return events;
  }

  if (msg.type === "tool_progress") {
    events.push({
      kind: "runtime-status",
      payload: {
        turnId,
        id: String(
          msg.task_id ?? msg.tool_use_id ?? `tool-progress-${Date.now()}`,
        ),
        label: `${String(msg.tool_name ?? "Tool")} running`,
        detail: `${String(msg.elapsed_time_seconds ?? 0)}s elapsed`,
        status: "running",
      },
    });
    return events;
  }

  if (msg.type === "tool_use_summary") {
    events.push({
      kind: "runtime-status",
      payload: {
        turnId,
        label: "Tool use summary",
        detail: typeof msg.summary === "string" ? msg.summary : undefined,
        status: "completed",
      },
    });
    return events;
  }

  if (msg.type === "prompt_suggestion") {
    events.push({
      kind: "prompt-suggestion",
      payload: {
        turnId,
        suggestion: typeof msg.suggestion === "string" ? msg.suggestion : "",
      },
    });
    return events;
  }

  // ---------- Stream events ----------
  if (msg.type === "stream_event") {
    const event = msg.event as Record<string, unknown> | undefined;
    if (!event) return events;

    // Flatten stream_event payloads that may be nested by SDK transport.
    if (event.type === "content_block_delta") {
      const delta = event.delta as Record<string, unknown> | undefined;
      if (delta?.type === "text_delta") {
        turnsWithStreamedText.add(turnStreamKey(sessionId, turnId));
        events.push({
          kind: "text-chunk",
          payload: { turnId, content: String(delta.text ?? "") },
        });
      }
      // thinking delta
      if (delta?.type === "thinking_delta") {
        turnsWithStreamedThinking.add(turnStreamKey(sessionId, turnId));
        events.push({
          kind: "thinking-chunk",
          payload: { turnId, content: String(delta.thinking ?? "") },
        });
      }
      // tool input delta
      if (delta?.type === "input_json_delta") {
        const block = streamingToolBlocks.get(
          streamingToolKey(sessionId, turnId, event.index),
        );
        if (!block) return events;
        block.partialInput = appendToolInputDelta(
          block.partialInput,
          String((delta as Record<string, unknown>).partial_json ?? ""),
        );
        events.push({
          kind: "tool-progress",
          payload: {
            turnId,
            toolId: block.id,
            toolName: block.name,
            partialInput: block.partialInput,
            input: tryParseJson(block.partialInput),
          },
        });
      }
    }

    // content_block_start opens text, tool, or reasoning blocks.
    if (event.type === "content_block_start") {
      const block = event.content_block as Record<string, unknown> | undefined;
      if (block?.type === "tool_use") {
        const toolId = String(block.id ?? `tool-${Date.now()}`);
        const toolName = String(block.name ?? "unknown");
        const initialInput = stringifyToolInput(block.input);
        streamingToolBlocks.set(
          streamingToolKey(sessionId, turnId, event.index),
          {
            id: toolId,
            name: toolName,
            partialInput: initialInput,
          },
        );
        events.push({
          kind: "tool-start",
          payload: {
            turnId,
            toolId,
            toolName,
            input: tryParseJson(initialInput) ?? {},
          },
        });
      }
    }

    // content_block_stop finalizes the current content block.
    if (event.type === "content_block_stop") {
      // Some SDK versions emit final text on block stop.
      const block = streamingToolBlocks.get(
        streamingToolKey(sessionId, turnId, event.index),
      );
      if (block) {
        events.push({
          kind: "tool-progress",
          payload: {
            turnId,
            toolId: block.id,
            toolName: block.name,
            partialInput: block.partialInput,
            input: tryParseJson(block.partialInput),
            isReady: true,
          },
        });
        streamingToolBlocks.delete(
          streamingToolKey(sessionId, turnId, event.index),
        );
      }
    }

    return events;
  }

  // ---------- Assistant messages ----------
  if (msg.type === "assistant") {
    const content = msg.message
      ? (msg.message as Record<string, unknown>).content
      : undefined;
    const streamKey = turnStreamKey(sessionId, turnId);
    if (Array.isArray(content)) {
      for (const block of content as Array<Record<string, unknown>>) {
        if (
          block.type === "text" &&
          block.text &&
          !turnsWithStreamedText.has(streamKey)
        ) {
          events.push({
            kind: "text-chunk",
            payload: { turnId, content: String(block.text) },
          });
        }
        if (
          block.type === "thinking" &&
          block.thinking &&
          !turnsWithStreamedThinking.has(streamKey)
        ) {
          events.push({
            kind: "thinking-chunk",
            payload: { turnId, content: String(block.thinking) },
          });
        }
        if (block.type === "tool_use") {
          events.push({
            kind: "tool-start",
            payload: {
              turnId,
              toolId: String(block.id ?? genId()),
              toolName: String(block.name ?? "unknown"),
              input: block.input ?? {},
            },
          });
        }
      }
    }
    return events;
  }

  // ---------- User messages ----------
  if (msg.type === "user") {
    const content = msg.message
      ? (msg.message as Record<string, unknown>).content
      : undefined;
    if (Array.isArray(content)) {
      for (const block of content as Array<Record<string, unknown>>) {
        if (block.type === "tool_result") {
          events.push({
            kind: "tool-complete",
            payload: {
              turnId,
              toolId: String(
                (block as Record<string, unknown>).tool_use_id ?? "unknown",
              ),
              output: block.content ?? "",
              isError: Boolean((block as Record<string, unknown>).is_error),
            },
          });
        }
      }
    }
    return events;
  }

  // ---------- Result messages ----------
  if (msg.type === "result") {
    const isError =
      Boolean(msg.is_error) ||
      (msg.subtype as string) === "error_during_execution" ||
      (msg.subtype as string) === "error_max_turns";
    const usage = normalizeTokenUsage(msg.usage);

    if (usage) {
      events.push({
        kind: "token-usage",
        payload: { turnId, usage },
      });
    }

    if (isError) {
      const errorMessage = resultErrorMessage(msg);
      events.push({
        kind: "error",
        payload: {
          code: "SDK_ERROR",
          message: errorMessage,
          recoverable: false,
        },
      });
      events.push({
        kind: "turn-complete",
        payload: { turnId, result: "error", error: errorMessage },
      });
    } else {
      events.push({
        kind: "turn-complete",
        payload: {
          turnId,
          result: "success",
          content: typeof msg.result === "string" ? msg.result : undefined,
          sdkSessionId:
            typeof msg.session_id === "string" ? msg.session_id : undefined,
        },
      });
    }
    clearTurnStreamState(sessionId, turnId);
    return events;
  }

  // ---------- Fallback messages ----------
  return events;
}

function resultErrorMessage(msg: Record<string, unknown>): string {
  if (typeof msg.result === "string" && msg.result.trim()) {
    return msg.result;
  }
  if ((msg.subtype as string) === "error_max_turns") {
    return "Reached the maximum turn limit. Send another message to continue.";
  }
  return (
    stringifyStatusDetail(msg.errors) ??
    "Model response interrupted unexpectedly."
  );
}

function normalizeTokenUsage(usage: unknown): TokenUsage | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const record = usage as Record<string, unknown>;
  const normalized: TokenUsage = {
    inputTokens:
      readNumber(record.input_tokens) ?? readNumber(record.inputTokens),
    outputTokens:
      readNumber(record.output_tokens) ?? readNumber(record.outputTokens),
    cacheCreationInputTokens:
      readNumber(record.cache_creation_input_tokens) ??
      readNumber(record.cacheCreationInputTokens),
    cacheReadInputTokens:
      readNumber(record.cache_read_input_tokens) ??
      readNumber(record.cacheReadInputTokens),
    limitTokens:
      readNumber(record.limit_tokens) ??
      readNumber(record.limitTokens) ??
      readNumber(record.max_tokens) ??
      readNumber(record.maxTokens),
    raw: usage,
  };
  normalized.totalTokens =
    readNumber(record.total_tokens) ??
    readNumber(record.totalTokens) ??
    sumNumbers(
      normalized.inputTokens,
      normalized.outputTokens,
      normalized.cacheCreationInputTokens,
      normalized.cacheReadInputTokens,
    );
  return normalized;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function normalizeContextUsage(
  value: unknown,
): {
  usage: import("@shared/types").ContextUsageRecord;
  percentage: number;
  limit: number;
} | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const usage = {
    totalTokens: readNumber(record.totalTokens),
    maxTokens: readNumber(record.maxTokens),
    percentage: readNumber(record.percentage),
    model: typeof record.model === "string" ? record.model : undefined,
    categories: readContextCategories(record.categories),
    memoryFiles: readContextMemoryFiles(record.memoryFiles),
    mcpTools: readContextMcpTools(record.mcpTools),
    raw: value,
  };
  const limit = usage.maxTokens ?? 0;
  const percentage =
    usage.percentage ??
    (usage.totalTokens !== undefined && limit > 0
      ? (usage.totalTokens / limit) * 100
      : undefined);
  if (percentage === undefined && limit <= 0) return null;
  return { usage, percentage: percentage ?? 0, limit };
}

export function buildContextPolicyWarningEvent(
  settings: AgentSettings,
  turnId: string,
  usage: import("@shared/types").ContextUsageRecord,
): RuntimeEvent | null {
  const totalTokens = resolveContextTotalTokens(usage);
  if (totalTokens === undefined) return null;
  const decision = evaluateContextPolicy({
    settings,
    providerId: settings.defaultModel.providerId,
    modelId: settings.defaultModel.modelId,
    model: usage.model,
    totalTokens,
    runtimeLimitTokens: usage.maxTokens,
    reason: "turn_end",
  });
  if (decision.level === "ok") return null;
  const level =
    decision.level === "warning"
      ? "medium"
      : decision.level === "compact"
        ? "high"
        : "critical";
  const source = contextSourceLabel(decision.source);
  const percentage = decision.percentage ?? usage.percentage;
  const rounded = percentage !== undefined ? Math.round(percentage) : undefined;
  const message =
    decision.level === "warning"
      ? `Context usage is ${rounded ?? "above the warning threshold"}% of ${source}; Marloues is monitoring this session.`
      : decision.level === "compact"
        ? `Context usage is ${rounded ?? "above the compact threshold"}% of ${source}; consider compacting or starting a branch.`
        : `Context usage is ${rounded ?? "above the restart threshold"}% of ${source}; start a new session or switch to a larger context model soon.`;
  return {
    kind: "context-warning",
    payload: {
      turnId,
      level,
      message,
      percentage,
    },
  };
}

function resolveContextTotalTokens(
  usage: import("@shared/types").ContextUsageRecord,
): number | undefined {
  if (usage.totalTokens !== undefined) return usage.totalTokens;
  if (usage.percentage !== undefined && usage.maxTokens !== undefined) {
    return Math.round((usage.percentage / 100) * usage.maxTokens);
  }
  return undefined;
}

function contextSourceLabel(
  source: "model_config" | "runtime_limit" | "default",
): string {
  if (source === "model_config") return "the configured model context";
  if (source === "runtime_limit") return "the SDK runtime budget";
  return "the default context window";
}
function readContextCategories(
  value: unknown,
): import("@shared/types").ContextUsageRecord["categories"] {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name : undefined;
    const tokens = readNumber(record.tokens);
    if (!name || tokens === undefined) return [];
    return [
      {
        name,
        tokens,
        isDeferred:
          typeof record.isDeferred === "boolean"
            ? record.isDeferred
            : undefined,
      },
    ];
  });
}

function readContextMemoryFiles(
  value: unknown,
): import("@shared/types").ContextUsageRecord["memoryFiles"] {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const path = typeof record.path === "string" ? record.path : undefined;
    const type = typeof record.type === "string" ? record.type : "memory";
    const tokens = readNumber(record.tokens);
    if (!path || tokens === undefined) return [];
    return [{ path, type, tokens }];
  });
}

function readContextMcpTools(
  value: unknown,
): import("@shared/types").ContextUsageRecord["mcpTools"] {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name : undefined;
    const serverName =
      typeof record.serverName === "string"
        ? record.serverName
        : typeof record.server_name === "string"
          ? record.server_name
          : "unknown";
    const tokens = readNumber(record.tokens);
    if (!name || tokens === undefined) return [];
    return [
      {
        name,
        serverName,
        tokens,
        isLoaded:
          typeof record.isLoaded === "boolean" ? record.isLoaded : undefined,
      },
    ];
  });
}

function sumNumbers(...values: Array<number | undefined>): number | undefined {
  const present = values.filter(
    (value): value is number => typeof value === "number",
  );
  return present.length
    ? present.reduce((sum, value) => sum + value, 0)
    : undefined;
}
function tryParseJson(text: string): unknown {
  if (!text || text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

// ========================
// Runtime implementation backed by Claude SDK.
// ========================

const threads = new Map<string, Thread>();

function ensureThread(id: string): Thread {
  let t = threads.get(id);
  if (!t) {
    t = {
      id,
      title: "New chat",
      messages: [],
      createdAt: now(),
      updatedAt: now(),
    };
    threads.set(id, t);
  }
  return t;
}

function pushMessage(threadId: string, msg: Message): void {
  const t = ensureThread(threadId);
  t.messages.push(msg);
  t.updatedAt = now();
}

// ========================
// ClaudeRuntime
// ========================

export class ClaudeRuntime implements AgentRuntime {
  readonly name = "Claude";
  readonly capabilities: RuntimeCapabilities = {
    forkThread: true,
    interruptTurn: true,
    setModel: true,
    setPermissionMode: true,
    registerTool: false,
    cancelTool: false,
    editMessage: true,
    sandbox: false,
  };

  private activeQuery: ClaudeQuery | null = null;
  private activeTurnId: string | null = null;
  private pendingApprovals = new Map<
    string,
    { resolve: (approved: boolean) => void; toolName: string }
  >();
  private toolStormBreaker = new ToolStormBreaker();
  private sessionApprovedTools = new Set<string>();

  // ---------- Session lifecycle ----------

  async initialize(): Promise<void> {
    try {
      await import("@anthropic-ai/claude-agent-sdk");
    } catch {
      // The first query will surface a missing optional SDK dependency.
    }
  }

  async destroy(): Promise<void> {
    if (this.activeQuery?.close) {
      this.activeQuery.close();
    }
    this.activeQuery = null;
    this.resolvePendingApprovals(false);
    this.sessionApprovedTools.clear();
  }

  // ---------- Thread API ----------

  async listThreads(): Promise<Thread[]> {
    return Array.from(threads.values()).sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );
  }

  async createThread(title?: string): Promise<Thread> {
    const t: Thread = {
      id: genId(),
      title: title ?? "New chat",
      messages: [],
      createdAt: now(),
      updatedAt: now(),
    };
    threads.set(t.id, t);
    workflowThreadStore.ensureThread(t.id, { title: t.title });
    return t;
  }

  async deleteThread(threadId: string): Promise<void> {
    threads.delete(threadId);
    workflowThreadStore.deleteThread(threadId);
  }

  async forkThread(threadId: string, upToMessageId?: string): Promise<Thread> {
    // MVP: create a local thread record when the SDK does not return one.
    const src = threads.get(threadId);
    const t: Thread = {
      id: genId(),
      title: `Forked: ${src?.title ?? threadId.slice(0, 8)}`,
      messages: src ? [...src.messages] : [],
      createdAt: now(),
      updatedAt: now(),
    };
    threads.set(t.id, t);
    workflowThreadStore.cloneThread(threadId, t.id, {
      title: t.title,
      upToMessageId,
    });
    return t;
  }

  async truncateThread(
    threadId: string,
    opts: { fromMessageId: string; includeMessage?: boolean },
  ): Promise<Thread> {
    const thread = threads.get(threadId);
    if (!thread) throw new Error(`Thread not found: ${threadId}`);
    const index = thread.messages.findIndex(
      (message) => message.id === opts.fromMessageId,
    );
    if (index < 0) throw new Error(`Message not found: ${opts.fromMessageId}`);
    const end = opts.includeMessage ? index + 1 : index;
    thread.messages = thread.messages.slice(0, end);
    thread.updatedAt = now();
    workflowThreadStore.truncateFromUserMessage(
      threadId,
      opts.fromMessageId,
      opts.includeMessage,
    );
    return thread;
  }

  // ---------- Message sending ----------

  async sendMessage(opts: {
    threadId: string;
    turnId?: string;
    content: string;
    displayContent?: string;
    cwd?: string;
    attachments?: unknown[];
    messageId?: string;
    runtimeThreadId?: string;
    settingsSnapshot?: AgentSettings;
  }): Promise<AsyncIterable<RuntimeEvent>> {
    ensureThread(opts.threadId);
    const turnId = opts.turnId ?? genId();
    this.activeTurnId = turnId;
    this.toolStormBreaker.resetTurn(turnId);
    const displayContent = opts.displayContent ?? opts.content;

    // Build the request context and effective settings for this turn.
    const userMsg: Message = {
      id: opts.messageId ?? genId(),
      role: "user",
      content: displayContent,
      timestamp: now(),
    };
    pushMessage(opts.threadId, userMsg);
    const settings = opts.settingsSnapshot ?? getAgentSettings();
    const modelSnapshot = modelSnapshotFromSettings(settings);
    workflowThreadStore.startTurn({
      threadId: opts.threadId,
      turnId,
      content: displayContent,
      attachments: opts.attachments,
      userMessageId: userMsg.id,
      startedAt: userMsg.timestamp,
      cwd: opts.cwd ?? null,
      modelId: modelSnapshot.modelId,
      modelName: modelSnapshot.modelName,
    });

    // Apply context policy before sending.
    const sdkEnv = buildSdkEnv(settings);
    const queue = new RuntimeEventQueue();

    // Prepare tool permission callbacks for SDK canUseTool.
    const options = buildClaudeRuntimeOptions({
      settings,
      cwd: opts.cwd || process.cwd(),
      env: sdkEnv,
      canUseTool: async (
        toolName: string,
        input: Record<string, unknown>,
        context: Record<string, unknown>,
      ) => {
        const toolUseId =
          typeof context.toolUseID === "string" ? context.toolUseID : genId();
        const requestId = `sdk-approval-${toolUseId}`;
        const storm = this.toolStormBreaker.check(turnId, toolName, input);
        if (storm.action === "deny") {
          return {
            behavior: "deny",
            message: storm.message ?? "Repeated tool call blocked.",
            interrupt: false,
            toolUseID: toolUseId,
          };
        }
        const decision = evaluateToolPermission({
          toolName,
          input,
          permissionMode:
            settings.workMode === "plan" ? "plan" : settings.permissionMode,
          policy: settings.toolPermissionPolicy,
          sessionAllowedTools: this.sessionApprovedTools,
        });
        if (decision.action === "allow") {
          return { behavior: "allow", toolUseID: toolUseId };
        }
        if (decision.action === "deny") {
          return {
            behavior: "deny",
            message: decision.reason,
            interrupt: false,
            toolUseID: toolUseId,
          };
        }
        const reason = JSON.stringify(
          {
            decision: decision.reason,
            matchedRule: decision.matchedRule,
            toolStorm: storm.action === "warn" ? storm.message : undefined,
            title:
              typeof context.title === "string" ? context.title : undefined,
            displayName:
              typeof context.displayName === "string"
                ? context.displayName
                : undefined,
            description:
              typeof context.description === "string"
                ? context.description
                : undefined,
            blockedPath:
              typeof context.blockedPath === "string"
                ? context.blockedPath
                : undefined,
            decisionReason:
              typeof context.decisionReason === "string"
                ? context.decisionReason
                : undefined,
            input,
          },
          null,
          2,
        );
        queue.push({
          kind: "approval-request",
          payload: {
            requestId,
            toolName,
            reason,
            timeout: settings.permissionApprovalTimeoutMs,
          },
        });
        const approved = await this.waitForApproval(
          requestId,
          toolName,
          settings.permissionApprovalTimeoutMs,
        );
        if (approved) return { behavior: "allow", toolUseID: toolUseId };
        return {
          behavior: "deny",
          message: "Tool execution denied by user.",
          interrupt: false,
          toolUseID: toolUseId,
        };
      },
    });
    if (opts.runtimeThreadId && isLikelyClaudeSessionId(opts.runtimeThreadId)) {
      logInfo("claude.resume", { runtimeThreadId: opts.runtimeThreadId });
      options.resume = opts.runtimeThreadId;
    } else if (opts.runtimeThreadId) {
      logWarn("claude.resumeSkipped", {
        reason: "invalid_session_id",
        runtimeThreadId: opts.runtimeThreadId,
      });
    }

    // Emit the user message before the SDK response starts.
    const query = await queryClaude(opts.content, options);
    this.activeQuery = query;

    // Start the SDK query and stream normalized events.
    async function* wrapStream(): AsyncIterable<RuntimeEvent> {
      // Feed SDK messages through the normalizer.
      yield {
        kind: "turn-start",
        payload: { turnId, timestamp: now() },
      };

      let assistantText = "";
      let sawTurnComplete = false;

      async function getContextUsageEvent(
        phase: "turn_start" | "turn_end",
      ): Promise<RuntimeEvent | null> {
        if (!query.getContextUsage) return null;
        try {
          const normalized = normalizeContextUsage(
            await query.getContextUsage(),
          );
          if (!normalized) return null;
          return {
            kind: "context-usage",
            payload: {
              turnId,
              phase,
              percentage: normalized.percentage,
              limit: normalized.limit,
              usage: normalized.usage,
            },
          };
        } catch (error) {
          if (isClosedQueryContextUsageError(error)) return null;
          logWarn("sdk.contextUsage.failed", {
            turnId,
            phase,
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        }
      }

      try {
        const iterator = query[Symbol.asyncIterator]();
        let nextSdk = iterator.next();
        let nextQueue = queue.next();
        let sdkDone = false;
        while (!sdkDone) {
          const result = await Promise.race([
            nextSdk.then((value) => ({ source: "sdk" as const, value })),
            nextQueue.then((value) => ({ source: "queue" as const, value })),
          ]);

          if (result.source === "queue") {
            nextQueue = queue.next();
            workflowThreadStore.applyRuntimeEvent(
              opts.threadId,
              turnId,
              result.value,
            );
            yield result.value;
            continue;
          }

          const sdkResult = result.value;
          sdkDone = Boolean(sdkResult.done);
          if (sdkDone) break;
          nextSdk = iterator.next();
          const sdkMsg = sdkResult.value;
          const events = normalizeSdkMessage(opts.threadId, turnId, sdkMsg);
          for (const event of events) {
            // Ignore callbacks that arrive after the turn has closed.
            if (event.kind === "text-chunk") {
              assistantText += event.payload.content;
            }
            workflowThreadStore.applyRuntimeEvent(opts.threadId, turnId, event);
            yield event;
            if (event.kind === "mcp-status") {
              recordMcpRuntimeStatus(
                event.payload.servers,
                event.payload.tools,
              );
            }
            if (event.kind === "session-info") {
              const contextUsageEvent =
                await getContextUsageEvent("turn_start");
              if (contextUsageEvent) {
                workflowThreadStore.applyRuntimeEvent(
                  opts.threadId,
                  turnId,
                  contextUsageEvent,
                );
                yield contextUsageEvent;
              }
            }
            if (event.kind === "turn-complete") {
              sawTurnComplete = true;
              const contextUsageEvent = await getContextUsageEvent("turn_end");
              if (contextUsageEvent) {
                workflowThreadStore.applyRuntimeEvent(
                  opts.threadId,
                  turnId,
                  contextUsageEvent,
                );
                yield contextUsageEvent;
                if (
                  contextUsageEvent.kind === "context-usage" &&
                  contextUsageEvent.payload.usage
                ) {
                  const policyEvent = buildContextPolicyWarningEvent(
                    settings,
                    turnId,
                    contextUsageEvent.payload.usage,
                  );
                  if (policyEvent) {
                    workflowThreadStore.applyRuntimeEvent(
                      opts.threadId,
                      turnId,
                      policyEvent,
                    );
                    yield policyEvent;
                  }
                }
              }
            }
          }
        }
        yield* queue.drainSync();
        if (!sawTurnComplete) {
          const contextUsageEvent = await getContextUsageEvent("turn_end");
          if (contextUsageEvent) {
            workflowThreadStore.applyRuntimeEvent(
              opts.threadId,
              turnId,
              contextUsageEvent,
            );
            yield contextUsageEvent;
          }
          const completeEvent: RuntimeEvent = {
            kind: "turn-complete",
            payload: { turnId, result: "success" },
          };
          workflowThreadStore.applyRuntimeEvent(
            opts.threadId,
            turnId,
            completeEvent,
          );
          yield completeEvent;
        }
      } catch (err) {
        yield* queue.drainSync();
        // Track SDK query completion.
        const errorEvent: RuntimeEvent = {
          kind: "error",
          payload: {
            code: "SDK_QUERY_ERROR",
            message: err instanceof Error ? err.message : String(err),
            recoverable: false,
          },
        };
        workflowThreadStore.applyRuntimeEvent(
          opts.threadId,
          turnId,
          errorEvent,
        );
        yield errorEvent;
        const completeEvent: RuntimeEvent = {
          kind: "turn-complete",
          payload: {
            turnId,
            result: "error",
            error: err instanceof Error ? err.message : String(err),
          },
        };
        workflowThreadStore.applyRuntimeEvent(
          opts.threadId,
          turnId,
          completeEvent,
        );
        yield completeEvent;
      }

      // Persist final assistant state.
      if (assistantText.trim()) {
        pushMessage(opts.threadId, {
          id: genId(),
          role: "assistant",
          content: assistantText,
          timestamp: now(),
        });
      }

      // Record token usage and status metadata.
      // Finish the turn once all streamed events are handled.
    }

    return wrapStream();
  }

  // ---------- Turn control ----------

  async interruptTurn(turnId: string): Promise<void> {
    if (this.activeQuery?.interrupt) {
      await this.activeQuery.interrupt();
    }
    if (this.activeTurnId === turnId) {
      this.activeTurnId = null;
    }
  }

  // ---------- Model selection ----------

  async setModel(_modelId: string): Promise<void> {
    // MVP: store runtime model preference in settings.
    // Claude SDK reads the model from query options.
  }

  async getAvailableModels(): Promise<ModelOption[]> {
    return configuredRuntimeModels();
  }

  async setPermissionMode(_mode: PermissionMode): Promise<void> {
    // Permission mode is currently enforced by canUseTool callbacks.
  }

  // ---------- Tool ----------

  async listTools(): Promise<ToolDefinition[]> {
    return configuredMcpTools();
  }

  registerTool(
    _tool: ToolDefinition,
    _handler: (args: unknown) => Promise<unknown>,
  ): void {
    throw new Error(
      "ClaudeRuntime does not support dynamic tool registration. Configure tools through MCP or Settings.",
    );
  }

  async readThread(
    input: import("@shared/workflow-thread-data-source").WorkflowReadThreadInput,
  ) {
    return workflowThreadStore.readThread(input);
  }

  subscribeThread(
    input: import("@shared/workflow-thread-data-source").WorkflowSubscribeThreadInput,
  ) {
    return workflowThreadStore.subscribeThread(input);
  }

  // ---------- Approval handling ----------

  respondApproval(
    requestId: string,
    approved: boolean,
    scope: "once" | "session",
    _reason?: string,
  ): void {
    const pending = this.pendingApprovals.get(requestId);
    if (!pending) return;
    this.pendingApprovals.delete(requestId);
    if (approved && scope === "session")
      this.sessionApprovedTools.add(pending.toolName);
    pending.resolve(approved);
  }

  private waitForApproval(
    requestId: string,
    toolName: string,
    timeoutMs: number,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingApprovals.delete(requestId);
        resolve(false);
      }, timeoutMs);
      this.pendingApprovals.set(requestId, {
        toolName,
        resolve: (approved) => {
          clearTimeout(timeout);
          resolve(approved);
        },
      });
    });
  }

  private resolvePendingApprovals(approved: boolean): void {
    for (const [requestId, pending] of this.pendingApprovals) {
      this.pendingApprovals.delete(requestId);
      pending.resolve(approved);
    }
  }
}

class RuntimeEventQueue {
  private events: RuntimeEvent[] = [];
  private waiters: Array<(event: RuntimeEvent) => void> = [];

  push(event: RuntimeEvent): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(event);
      return;
    }
    this.events.push(event);
  }

  next(): Promise<RuntimeEvent> {
    const event = this.events.shift();
    if (event) return Promise.resolve(event);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  *drainSync(): Iterable<RuntimeEvent> {
    while (this.events.length) {
      const event = this.events.shift();
      if (event) yield event;
    }
  }
}
