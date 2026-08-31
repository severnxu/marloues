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
  ChatSendReceipt,
  MemoryRecallRecord,
  ModelOption,
  OutboxSnapshot,
  SteerActionReceipt,
  TokenUsage,
} from "@shared/types";
import { applySecurityMode } from "@shared/security-policy";
import type { WorkflowUserMessageContent } from "@shared/workflow-read-thread-contract";
import {
  queryClaude,
  forkClaudeSession,
  type ClaudeQuery,
} from "../sdk/claude-sdk";
import {
  getAgentSettings,
  saveAgentSettings,
  buildSdkEnv,
} from "../../services/config-service";
import { recordMcpRuntimeStatus } from "../../services/mcp-service";
import { evaluateContextPolicy } from "../context/context-policy";
import { resolveModelProvider } from "../config/model-provider";
import { resolveRuntimeProviderRoutes } from "../config/provider-routing";
import { buildClaudeRuntimeOptions } from "../config/options-builder";
import { configuredMcpTools } from "./mcp-tools";
import { configuredRuntimeModels } from "./runtime-models";
import { workflowThreadStore } from "./workflow-thread-store";
import { ToolStormBreaker } from "./tool-storm-breaker";
import { logInfo, logWarn } from "../logging/app-logger";
import { SteerQueue } from "./steer-queue";
import { createMessageChannel } from "./message-channel";
import { buildSdkUserContent } from "./sdk-content";
import {
  createRuntimeSecurityHost,
  type SecurityHost,
} from "../security/security-host";
import type { SecurityOperation } from "../security/operation-factory";
import {
  guardianReviewDetail,
  runGuardianReview,
} from "../security/guardian-reviewer";
import type { SandboxProfile } from "../security/sandbox-broker";
import {
  canonicalSdkSecurityToolName,
  SDK_SANDBOX_SERVER_NAME,
  SDK_SANDBOX_TOOL_NAME,
  SdkCommandSandbox,
} from "./sdk-command-sandbox";
import {
  canonicalTerminalToolName,
  createSdkTerminalServer,
  SDK_TERMINAL_SERVER_NAME,
} from "./sdk-terminal-mcp";
import {
  canonicalBrowserToolName,
  createSdkBrowserServer,
  SDK_BROWSER_SERVER_NAME,
} from "./sdk-browser-mcp";
import { SessionApprovalTracker } from "../security/session-approval-tracker";
import { terminalService } from "../../services/terminal-service";
import { cdpBrowserService } from "../../services/cdp-browser-service";
import {
  RuntimeEventQueue,
  createTurnLifetime,
  type ActiveTurn,
  type SteerDeliveryRecord,
} from "./turn-state";
import { recoverApplyingOutbox } from "../../services/outbox-service";
import { startGateway } from "../../gateway";

/** 可续终态：query.interrupt() / apply steer 触发的软中断，不走 error 收尾。 */
const CONTINUABLE_TERMINAL_REASONS = new Set([
  "aborted_streaming",
  "aborted_tools",
  "stop_hook_prevented",
  "hook_stopped",
  "tool_deferred",
]);

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

function commandFromToolInput(
  input: Record<string, unknown>,
): string | undefined {
  const command = input.command ?? input.cmd;
  return typeof command === "string" && command.trim() ? command : undefined;
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
    const terminalReason =
      typeof msg.terminal_reason === "string"
        ? (msg.terminal_reason as string)
        : undefined;
    const isInterrupted =
      terminalReason !== undefined &&
      CONTINUABLE_TERMINAL_REASONS.has(terminalReason);
    const isError =
      !isInterrupted &&
      (Boolean(msg.is_error) ||
        (msg.subtype as string) === "error_during_execution" ||
        (msg.subtype as string) === "error_max_turns");
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
    } else if (isInterrupted) {
      events.push({
        kind: "turn-complete",
        payload: {
          turnId,
          result: "interrupted",
          content: typeof msg.result === "string" ? msg.result : undefined,
          sdkSessionId:
            typeof msg.session_id === "string" ? msg.session_id : undefined,
        },
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

export function normalizeContextUsage(value: unknown): {
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

async function* canceledTurnStream(
  threadId: string,
  turnId: string,
): AsyncIterable<RuntimeEvent> {
  yield {
    kind: "turn-start",
    payload: { turnId, timestamp: now() },
  };
  yield {
    kind: "turn-complete",
    payload: { turnId, result: "aborted" },
  };
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
    sandbox: true,
  };

  private activeTurns = new Map<string, ActiveTurn>();
  forwardDeferredEvent?: (event: RuntimeEvent) => void;
  private steerQueue = new SteerQueue({
    getActiveTurn: (threadId) => this.activeTurns.get(threadId),
    pushMessage: (threadId, message) => pushMessage(threadId, message),
  });
  private pendingApprovals = new Map<
    string,
    {
      resolve: (approved: boolean) => void;
      toolName: string;
      operation?: SecurityOperation;
      elevationProfile?: SandboxProfile;
    }
  >();
  private toolStormBreaker = new ToolStormBreaker();
  private securityHost: SecurityHost = createRuntimeSecurityHost("sdk");
  /** 运行时模型覆盖（setModel 设置，sendMessage 时优先生效）。 */
  private modelOverride: string | null = null;
  /** 运行时权限模式覆盖（setPermissionMode 设置，canUseTool 时生效）。 */
  private permissionModeOverride: PermissionMode | null = null;
  /** threadId → SDK sessionId 映射（forkThread 走 SDK forkSession 用）。 */
  private threadSdkSession = new Map<string, string>();
  /** Per-thread approval tracker (survives across turns, cleared on thread delete). */
  private approvalTracker = new SessionApprovalTracker();

  // ---------- Session lifecycle ----------

  async initialize(): Promise<void> {
    recoverApplyingOutbox();
    cdpBrowserService.setSecurityRulesGetter(
      () => getAgentSettings().securityRules,
    );
    try {
      await import("@anthropic-ai/claude-agent-sdk");
    } catch {
      // The first query will surface a missing optional SDK dependency.
    }
  }

  async destroy(): Promise<void> {
    for (const [threadId, entry] of this.activeTurns) {
      if (entry.channel && !entry.channel.isClosed()) entry.channel.close();
      if (entry.query?.close) {
        try {
          entry.query.close();
        } catch {
          /* best-effort */
        }
      }
      this.activeTurns.delete(threadId);
      entry.finish();
    }
    this.resolvePendingApprovals(false);
    this.forwardDeferredEvent = undefined;
    this.securityHost.clearGrants();
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
    const active = this.activeTurns.get(threadId);
    if (active) {
      active.canceled = true;
      active.acceptingSteers = false;
      if (active.channel && !active.channel.isClosed()) active.channel.close();
      if (active.query?.close) {
        try {
          active.query.close();
        } catch {
          /* best-effort */
        }
      }
      this.activeTurns.delete(threadId);
      active.finish();
    }
    threads.delete(threadId);
    workflowThreadStore.deleteThread(threadId);
    this.approvalTracker.clear();
    terminalService.killByThread(threadId);
    void cdpBrowserService.closeByThread(threadId);
  }

  async clearThread(threadId: string): Promise<void> {
    const active = this.activeTurns.get(threadId);
    if (active) {
      active.stopRequested = true;
      active.acceptingSteers = false;
      if (active.channel && !active.channel.isClosed()) active.channel.close();
      if (active.query?.close) {
        try {
          active.query.close();
        } catch {
          /* best-effort */
        }
      }
      this.activeTurns.delete(threadId);
      active.finish();
    }
    const thread = ensureThread(threadId);
    thread.messages = [];
    thread.updatedAt = now();
    this.threadSdkSession.delete(threadId);
    this.resolvePendingApprovals(false, "canceled", threadId);
    for (const snapshot of this.steerQueue.listSnapshots(
      threadId,
      () => true,
    )) {
      for (const item of snapshot.items) {
        await this.steerQueue.cancel(threadId, item.messageId);
      }
    }
    workflowThreadStore.clearThread(threadId);
  }

  async forkThread(threadId: string, upToMessageId?: string): Promise<Thread> {
    const src = threads.get(threadId);
    const t: Thread = {
      id: genId(),
      title: `Forked: ${src?.title ?? threadId.slice(0, 8)}`,
      messages: src ? [...src.messages] : [],
      createdAt: now(),
      updatedAt: now(),
    };
    // 真实 SDK fork：有已记录的 sdkSessionId 且 SDK 支持时，创建独立 SDK 会话
    // 继承原线程上下文；失败或不可用时回退本地复制壳。
    const sdkSessionId = this.threadSdkSession.get(threadId);
    if (sdkSessionId) {
      try {
        const forked = await forkClaudeSession(sdkSessionId, {
          resume: upToMessageId,
        });
        if (forked?.sessionId) {
          this.threadSdkSession.set(t.id, forked.sessionId);
        }
      } catch (error) {
        logWarn("claude.forkSdkFailed", {
          threadId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
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
    if (this.activeTurns.has(opts.threadId)) {
      throw new Error(
        `会话正在运行中（thread=${opts.threadId}），请等待当前回合结束后再发送。`,
      );
    }
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
    const effectiveSettings: AgentSettings = this.modelOverride
      ? {
          ...settings,
          defaultModel: {
            ...settings.defaultModel,
            modelId: this.modelOverride,
          },
        }
      : settings;
    const modelSnapshot = modelSnapshotFromSettings(effectiveSettings);
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
    const routePlan = resolveRuntimeProviderRoutes(effectiveSettings, {
      runtimeId: "sdk",
    });
    if (!routePlan.routes.length) {
      throw new Error("当前供应商没有可用于 SDK 运行时的模型端点");
    }
    const directRoute = routePlan.directRoute;
    const connection = directRoute
      ? {
          baseUrl: directRoute.baseUrl,
          apiKey: directRoute.apiKey,
          model: directRoute.model,
        }
      : await startGateway().then((gateway) => ({
          baseUrl: gateway.baseUrl,
          apiKey: gateway.token,
          model: routePlan.routes[0].model,
        }));
    const sdkEnv = buildSdkEnv(effectiveSettings, undefined, connection);
    const channel = createMessageChannel();
    const entry: ActiveTurn = {
      turnId,
      query: null,
      channel,
      eventQueue: new RuntimeEventQueue(),
      pendingSteers: [],
      canceled: false,
      stopRequested: false,
      applyInterruptPhase: "idle",
      acceptingSteers: true,
      ...createTurnLifetime(),
      status: "running",
    };
    this.activeTurns.set(opts.threadId, entry);
    const queue = entry.eventQueue!;
    const sdkCommandSandbox = new SdkCommandSandbox();
    const sdkTerminalServer = createSdkTerminalServer(this.approvalTracker);
    const sdkBrowserServer = createSdkBrowserServer(
      this.approvalTracker,
      opts.threadId,
    );

    // Prepare tool permission callbacks for SDK canUseTool.
    const options = buildClaudeRuntimeOptions({
      settings: effectiveSettings,
      cwd: opts.cwd || process.cwd(),
      env: sdkEnv,
      sdkMcpServers: {
        [SDK_SANDBOX_SERVER_NAME]: sdkCommandSandbox.server,
        [SDK_TERMINAL_SERVER_NAME]: sdkTerminalServer.server,
        [SDK_BROWSER_SERVER_NAME]: sdkBrowserServer.server,
      },
      toolAliases: { Bash: SDK_SANDBOX_TOOL_NAME },
      canUseTool: async (
        toolName: string,
        input: Record<string, unknown>,
        context: Record<string, unknown>,
      ) => {
        const securityToolName = canonicalTerminalToolName(
          canonicalBrowserToolName(canonicalSdkSecurityToolName(toolName)),
        );
        const toolUseId =
          typeof context.toolUseID === "string" ? context.toolUseID : genId();
        const requestId = `sdk-approval-${toolUseId}`;
        const storm = this.toolStormBreaker.check(
          turnId,
          securityToolName,
          input,
        );
        if (storm.action === "deny") {
          return {
            behavior: "deny",
            message: storm.message ?? "Repeated tool call blocked.",
            interrupt: false,
            toolUseID: toolUseId,
          };
        }
        // ── Terminal/browser short-circuit: approved session/page → allow ──
        if (
          securityToolName === "terminal.write" ||
          securityToolName === "terminal.read" ||
          securityToolName === "terminal.resize"
        ) {
          const sessionId =
            typeof input.sessionId === "string" ? input.sessionId : "";
          if (sessionId && this.approvalTracker.isSessionApproved(sessionId)) {
            return {
              behavior: "allow",
              toolUseID: toolUseId,
              updatedInput: input,
            };
          }
        }
        if (
          securityToolName.startsWith("browser.") &&
          securityToolName !== "browser.navigate"
        ) {
          const pageId =
            (typeof input.pageId === "string" ? input.pageId : undefined) ??
            cdpBrowserService.getActivePageId(opts.threadId);
          if (pageId && this.approvalTracker.isPageApproved(pageId)) {
            return {
              behavior: "allow",
              toolUseID: toolUseId,
              updatedInput: input,
            };
          }
        }
        const decision = this.securityHost.evaluate({
          threadId: opts.threadId,
          turnId,
          toolName: securityToolName,
          input,
          workspaceRoot: opts.cwd || process.cwd(),
          permissionMode:
            effectiveSettings.workMode === "plan"
              ? "plan"
              : this.permissionModeOverride
                ? this.permissionModeOverride === "bypass"
                  ? "bypassPermissions"
                  : this.permissionModeOverride
                : effectiveSettings.permissionMode,
          settings: effectiveSettings,
        });
        if (decision.action === "allow") {
          if (securityToolName === "Bash") {
            const command = commandFromToolInput(input);
            if (!command || !decision.permit) {
              return {
                behavior: "deny",
                message:
                  "Bash execution requires a command and a SecurityHost permit.",
                interrupt: false,
                toolUseID: toolUseId,
              };
            }
            sdkCommandSandbox.authorize(command, decision.permit);
          }
          if (securityToolName === "terminal.exec") {
            const command =
              typeof input.command === "string" ? input.command : "";
            if (!command || !decision.permit) {
              return {
                behavior: "deny",
                message:
                  "terminal.exec requires a command and a SecurityHost permit.",
                interrupt: false,
                toolUseID: toolUseId,
              };
            }
            sdkTerminalServer.authorize(command, decision.permit);
          }
          if (securityToolName === "browser.navigate") {
            const url = typeof input.url === "string" ? input.url : "";
            if (!url || !decision.permit) {
              return {
                behavior: "deny",
                message:
                  "browser.navigate requires a URL and a SecurityHost permit.",
                interrupt: false,
                toolUseID: toolUseId,
              };
            }
            sdkBrowserServer.authorize(url, decision.permit);
          }
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
        let reviewerReason: string | undefined;
        if (effectiveSettings.securityMode === "auto-review") {
          queue.push({
            kind: "runtime-status",
            payload: {
              turnId,
              label: "安全审查",
              detail: "正在隔离审查会话中评估该操作",
              status: "running",
            },
          });
          const review = await runGuardianReview(decision, effectiveSettings, {
            trustedUserRequest: opts.content,
          });
          reviewerReason = guardianReviewDetail(review);
          queue.push({
            kind: "runtime-status",
            payload: {
              turnId,
              label: "安全审查",
              detail: reviewerReason,
              status: review.action === "deny" ? "error" : "completed",
            },
          });
          if (review.action === "deny") {
            return {
              behavior: "deny",
              message: `自动审查拒绝：${review.reason}`,
              interrupt: false,
              toolUseID: toolUseId,
            };
          }
          if (review.action === "allow") {
            if (securityToolName === "Bash") {
              const command = commandFromToolInput(input);
              if (!command) {
                return {
                  behavior: "deny",
                  message: "Bash execution requires a command.",
                  interrupt: false,
                  toolUseID: toolUseId,
                };
              }
              sdkCommandSandbox.authorize(
                command,
                this.securityHost.issueApprovedPermit(
                  decision.operation,
                  effectiveSettings,
                  decision.elevationProfile,
                ),
              );
            }
            if (securityToolName === "terminal.exec") {
              const command =
                typeof input.command === "string" ? input.command : "";
              if (!command) {
                return {
                  behavior: "deny",
                  message: "terminal.exec requires a command.",
                  interrupt: false,
                  toolUseID: toolUseId,
                };
              }
              sdkTerminalServer.authorize(
                command,
                this.securityHost.issueApprovedPermit(
                  decision.operation,
                  effectiveSettings,
                  decision.elevationProfile,
                ),
              );
            }
            if (securityToolName === "browser.navigate") {
              const url = typeof input.url === "string" ? input.url : "";
              if (!url) {
                return {
                  behavior: "deny",
                  message: "browser.navigate requires a URL.",
                  interrupt: false,
                  toolUseID: toolUseId,
                };
              }
              sdkBrowserServer.authorize(
                url,
                this.securityHost.issueApprovedPermit(
                  decision.operation,
                  effectiveSettings,
                  decision.elevationProfile,
                ),
              );
            }
            return { behavior: "allow", toolUseID: toolUseId };
          }
        }
        const reason = JSON.stringify(
          {
            decision: decision.reason,
            automaticReview: reviewerReason,
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
            toolName: securityToolName,
            reason,
            timeout: settings.permissionApprovalTimeoutMs,
            allowSession: decision.allowSession,
          },
        });
        const approved = await this.waitForApproval(
          requestId,
          securityToolName,
          settings.permissionApprovalTimeoutMs,
          decision.operation,
          decision.elevationProfile,
        );
        if (approved) {
          if (securityToolName === "Bash") {
            const command = commandFromToolInput(input);
            if (!command) {
              return {
                behavior: "deny",
                message: "Bash execution requires a command.",
                interrupt: false,
                toolUseID: toolUseId,
              };
            }
            sdkCommandSandbox.authorize(
              command,
              this.securityHost.issueApprovedPermit(
                decision.operation,
                effectiveSettings,
                decision.elevationProfile,
              ),
            );
          }
          if (securityToolName === "terminal.exec") {
            const command =
              typeof input.command === "string" ? input.command : "";
            if (!command) {
              return {
                behavior: "deny",
                message: "terminal.exec requires a command.",
                interrupt: false,
                toolUseID: toolUseId,
              };
            }
            sdkTerminalServer.authorize(
              command,
              this.securityHost.issueApprovedPermit(
                decision.operation,
                effectiveSettings,
                decision.elevationProfile,
              ),
            );
          }
          if (securityToolName === "browser.navigate") {
            const url = typeof input.url === "string" ? input.url : "";
            if (!url) {
              return {
                behavior: "deny",
                message: "browser.navigate requires a URL.",
                interrupt: false,
                toolUseID: toolUseId,
              };
            }
            sdkBrowserServer.authorize(
              url,
              this.securityHost.issueApprovedPermit(
                decision.operation,
                effectiveSettings,
                decision.elevationProfile,
              ),
            );
          }
          return { behavior: "allow", toolUseID: toolUseId };
        }
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

    const provider = resolveModelProvider(effectiveSettings);
    const supportsVision =
      provider.provider?.models?.find((m) => m.id === provider.model)
        ?.supportsVision ?? false;
    const sdkContent = buildSdkUserContent(
      opts.content,
      opts.attachments,
      supportsVision,
    );

    let query: ClaudeQuery;
    try {
      query = await queryClaude(channel.generator, options);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      // startTurn() has already published an active workflow snapshot. If SDK
      // startup fails before an event stream exists (for example, a missing
      // packaged Claude executable), no generator catch block can finalize it.
      // Explicitly settle the snapshot here so the renderer does not keep the
      // timer and stop button alive indefinitely.
      workflowThreadStore.applyRuntimeEvent(opts.threadId, turnId, {
        kind: "error",
        payload: {
          code: "SDK_STARTUP_ERROR",
          message: errorMessage,
          recoverable: false,
        },
      });
      workflowThreadStore.applyRuntimeEvent(opts.threadId, turnId, {
        kind: "turn-complete",
        payload: { turnId, result: "error", error: errorMessage },
      });
      sdkCommandSandbox.clear();
      sdkTerminalServer.clear();
      sdkBrowserServer.clear();
      this.activeTurns.delete(opts.threadId);
      entry.finish();
      throw err;
    }
    if (entry.canceled) {
      try {
        query.close?.();
      } catch {
        /* best-effort */
      }
      sdkCommandSandbox.clear();
      sdkTerminalServer.clear();
      sdkBrowserServer.clear();
      this.activeTurns.delete(opts.threadId);
      entry.finish();
      return canceledTurnStream(opts.threadId, turnId);
    }
    entry.query = query;

    // Enqueue the initial user message into the persistent channel.
    channel.enqueue({
      type: "user",
      message: { role: "user", content: sdkContent },
      parent_tool_use_id: null,
    });
    // 捕获实例引用供 wrapStream 使用（普通函数生成器不绑定 this）。
    const threadSdkSession = this.threadSdkSession;
    const activeTurns = this.activeTurns;
    const getDeferredEventSink = () => this.forwardDeferredEvent;
    const clearDeferredEventSink = (
      sink: ((event: RuntimeEvent) => void) | undefined,
    ) => {
      if (this.forwardDeferredEvent === sink) {
        this.forwardDeferredEvent = undefined;
      }
    };
    const flushNextPendingSteerAtBoundary =
      this.flushNextPendingSteerAtBoundary.bind(this);

    // Start the SDK query and stream normalized events.
    async function* wrapStream(): AsyncIterable<RuntimeEvent> {
      // Feed SDK messages through the normalizer.
      yield {
        kind: "turn-start",
        payload: { turnId, timestamp: now() },
      };

      let assistantText = "";
      let yieldedTerminal = false;

      async function getContextUsageEvent(): Promise<RuntimeEvent | null> {
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
              phase: "turn_end",
              percentage: normalized.percentage,
              limit: normalized.limit,
              usage: normalized.usage,
            },
          };
        } catch (error) {
          if (isClosedQueryContextUsageError(error)) return null;
          logWarn("sdk.contextUsage.failed", {
            turnId,
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        }
      }

      const emitDeferredContextUsage = (): void => {
        // The SDK probe issues several token-count requests and can take
        // seconds. Never let it block streaming or turn teardown.
        const deferredSink = getDeferredEventSink();
        void getContextUsageEvent()
          .then((contextUsageEvent) => {
            if (!contextUsageEvent) return;
            try {
              workflowThreadStore.applyRuntimeEvent(
                opts.threadId,
                turnId,
                contextUsageEvent,
              );
              deferredSink?.(contextUsageEvent);
            } catch (error) {
              logWarn("sdk.contextUsage.deferredFailed", {
                turnId,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          })
          .finally(() => clearDeferredEventSink(deferredSink));
      };

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
          let flushedSteer = false;
          for (const event of events) {
            if (event.kind === "text-chunk") {
              assistantText += event.payload.content;
            }

            if (event.kind === "turn-complete") {
              if (
                "sdkSessionId" in event.payload &&
                typeof event.payload.sdkSessionId === "string" &&
                event.payload.sdkSessionId
              ) {
                // 记录 threadId → SDK sessionId，供 forkThread 走 SDK forkSession。
                threadSdkSession.set(opts.threadId, event.payload.sdkSessionId);
              }
              const resultVal = event.payload.result;
              if (resultVal === "success") {
                // Natural boundary: FIFO inject the next queued steer (if any)
                // and keep this same runtime turn alive instead of closing.
                if (flushNextPendingSteerAtBoundary(opts.threadId, entry)) {
                  logInfo("claude.turn.steer.flushPending", {
                    threadId: opts.threadId,
                    turnId,
                    remainingSteers: entry.pendingSteers.length,
                  });
                  flushedSteer = true;
                  break;
                }
                entry.acceptingSteers = false;
                const terminalEvent: RuntimeEvent = {
                  ...event,
                  payload: { ...event.payload, final: true },
                };
                workflowThreadStore.applyRuntimeEvent(
                  opts.threadId,
                  turnId,
                  terminalEvent,
                );
                yield terminalEvent;
                yieldedTerminal = true;
                emitDeferredContextUsage();
                channel.close();
                sdkDone = true;
                break;
              } else if (resultVal === "interrupted") {
                // Soft boundary from an immediate steer (apply-now): keep the
                // loop alive; the priority:"now" message continues the query.
                const interruptedEvent: RuntimeEvent = {
                  ...event,
                  payload: { ...event.payload, final: false },
                };
                workflowThreadStore.applyRuntimeEvent(
                  opts.threadId,
                  turnId,
                  interruptedEvent,
                );
                yield interruptedEvent;
              } else {
                entry.acceptingSteers = false;
                workflowThreadStore.applyRuntimeEvent(
                  opts.threadId,
                  turnId,
                  event,
                );
                yield event;
                yieldedTerminal = true;
                channel.close();
                sdkDone = true;
                break;
              }
              continue;
            }

            workflowThreadStore.applyRuntimeEvent(opts.threadId, turnId, event);
            yield event;
            if (event.kind === "mcp-status") {
              recordMcpRuntimeStatus(
                event.payload.servers,
                event.payload.tools,
              );
            }
            // Do not call getContextUsage() on session-info. The SDK handles
            // that control request as several token-count probes, which can
            // block this consumer loop and delay every streamed token.
          }
          if (flushedSteer) continue;
        }
        yield* queue.drainSync();
        if (!yieldedTerminal) {
          emitDeferredContextUsage();
          const resultVal = entry.canceled
            ? "aborted"
            : entry.stopRequested
              ? "interrupted"
              : "success";
          const completeEvent: RuntimeEvent = {
            kind: "turn-complete",
            payload: { turnId, result: resultVal },
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
      } finally {
        sdkCommandSandbox.clear();
        sdkTerminalServer.clear();
        sdkBrowserServer.clear();
        if (!channel.isClosed()) channel.close();
        try {
          query.close?.();
        } catch {
          /* best-effort */
        }
        if (activeTurns.get(opts.threadId) === entry) {
          activeTurns.delete(opts.threadId);
        }
        entry.finish();
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
    let targetThreadId: string | undefined;
    let target: ActiveTurn | undefined;
    for (const [threadId, entry] of this.activeTurns) {
      if (entry.turnId === turnId) {
        targetThreadId = threadId;
        target = entry;
        break;
      }
    }
    if (!target) return;
    target.stopRequested = true;
    target.acceptingSteers = false;
    if (target.query?.interrupt) {
      try {
        await target.query.interrupt();
      } catch {
        /* best-effort */
      }
    }
    if (target.channel && !target.channel.isClosed()) {
      target.channel.close();
    }
    this.resolvePendingApprovals(false, "canceled", targetThreadId);
  }

  // ---------- Steer surface ----------

  async steerTurn(opts: {
    threadId: string;
    content: string;
    displayContent?: string;
    userContent?: WorkflowUserMessageContent[];
    attachments?: unknown[];
    messageId?: string;
  }): Promise<ChatSendReceipt> {
    return this.steerQueue.queue(opts);
  }

  async applyPendingSteerNow(
    threadId: string,
    messageId: string,
  ): Promise<SteerActionReceipt> {
    return this.steerQueue.applyNow(threadId, messageId);
  }

  async cancelSteerMessage(
    threadId: string,
    messageId: string,
  ): Promise<SteerActionReceipt> {
    return this.steerQueue.cancel(threadId, messageId);
  }

  async reorderSteers(
    threadId: string,
    orderedMessageIds: string[],
  ): Promise<SteerActionReceipt> {
    return this.steerQueue.reorder(threadId, orderedMessageIds);
  }

  getOutboxSnapshots(sessionId?: string): OutboxSnapshot[] {
    return this.steerQueue.listSnapshots(sessionId, (active) =>
      Boolean(
        active?.channel &&
        !active.channel.isClosed() &&
        active.acceptingSteers &&
        !active.canceled,
      ),
    );
  }

  private rememberSteerDelivery(
    record: Omit<SteerDeliveryRecord, "updatedAt">,
    options: { persist?: boolean } = {},
  ): void {
    this.steerQueue.rememberDelivery(record, options);
  }

  private flushNextPendingSteerAtBoundary(
    threadId: string,
    entry: ActiveTurn,
  ): boolean {
    return this.steerQueue.flushNextAtBoundary(threadId, entry);
  }

  // ---------- Model selection ----------

  async setModel(modelId: string): Promise<void> {
    // 记录运行时覆盖，sendMessage 构造选项时优先生效；
    // 持久化由 manager.setRuntimeModel 写回 settings.defaultModel。
    this.modelOverride = modelId;
  }

  async getAvailableModels(): Promise<ModelOption[]> {
    return configuredRuntimeModels();
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    this.permissionModeOverride = mode;
    const settings = getAgentSettings();
    saveAgentSettings(
      applySecurityMode(
        settings,
        mode === "bypass" ? "full-access" : "request",
      ),
    );
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
    if (approved && scope === "session" && pending.operation) {
      this.securityHost.createGrant({
        operation: pending.operation,
        scope: "session",
        sourceRequestId: requestId,
        elevationProfile: pending.elevationProfile,
      });
    }
    pending.resolve(approved);
  }

  private waitForApproval(
    requestId: string,
    toolName: string,
    timeoutMs: number,
    operation?: SecurityOperation,
    elevationProfile?: SandboxProfile,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingApprovals.delete(requestId);
        resolve(false);
      }, timeoutMs);
      this.pendingApprovals.set(requestId, {
        toolName,
        operation,
        elevationProfile,
        resolve: (approved) => {
          clearTimeout(timeout);
          resolve(approved);
        },
      });
    });
  }

  private resolvePendingApprovals(
    approved: boolean,
    _scope?: string,
    _threadId?: string,
  ): void {
    for (const [requestId, pending] of this.pendingApprovals) {
      this.pendingApprovals.delete(requestId);
      pending.resolve(approved);
    }
  }
}
