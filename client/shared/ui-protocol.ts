/**
 * UI Protocol - stable renderer-facing contract, decoupled from internal events.
 */

export const UI_PROTOCOL_VERSION = "1.0";

import type {
  ContextActionRequest,
  ContextUsageRecord,
  MemoryRecallRecord,
  TokenUsage,
} from "./types";
import type { WorkflowUserMessageContent } from "./workflow-read-thread-contract";

/**
 * UI event types translated from internal AgentEvent values.
 */
export type UIEvent =
  | {
      type: "turn.start";
      sessionId: string;
      turnId: string;
      timestamp: number;
      /** Present when replayed from L1 event log (turn.started record). */
      modelId?: string | null;
      modelName?: string | null;
      cwd?: string | null;
    }
  | {
      type: "turn.complete";
      sessionId: string;
      turnId: string;
      result: "success" | "error" | "aborted" | "interrupted";
      content?: string;
      error?: string;
      sdkSessionId?: string;
      /** UUID of the last top-level SDK assistant message in this turn.
       * Used only by the main process to translate a Codex-style lastTurnId
       * into the message boundary required by the underlying SDK. */
      sdkAssistantMessageId?: string;
      /** False only for the intermediate boundary created by an immediate
       * steer.  Consumers must keep the runtime turn alive until a final event. */
      final?: boolean;
      timestamp: number;
    }
  | {
      type: "text.chunk";
      sessionId: string;
      turnId: string;
      content: string;
      index: number;
      /** SDK parent_tool_use_id. Present for text forwarded from a subagent. */
      parentToolId?: string;
    }
  | {
      type: "plan.delta";
      sessionId: string;
      turnId: string;
      itemId: string;
      content: string;
    }
  | {
      type: "plan.item";
      sessionId: string;
      turnId: string;
      itemId: string;
      content: string;
    }
  | {
      type: "steer.message";
      sessionId: string;
      turnId: string;
      messageId: string;
      text: string;
      content: WorkflowUserMessageContent[];
      // canceled：回合收尾时仍未注入的排队 steer，通知 UI 移除，避免卡在 "sent"。
      status?: "queued" | "sent" | "applied" | "canceled";
      timestamp: number;
    }
  | {
      type: "thinking.chunk";
      sessionId: string;
      turnId: string;
      content: string;
      /** SDK parent_tool_use_id. Present for thinking forwarded from a subagent. */
      parentToolId?: string;
    }
  | {
      type: "tool.start";
      sessionId: string;
      turnId: string;
      toolId: string;
      toolName: string;
      input: unknown;
      /** SDK parent_tool_use_id. Present when this tool runs inside a subagent. */
      parentToolId?: string;
    }
  | {
      type: "tool.progress";
      sessionId: string;
      turnId: string;
      toolId: string;
      toolName: string;
      partialInput: string;
      input?: unknown;
      isReady?: boolean;
      /** SDK parent_tool_use_id. Present when this tool runs inside a subagent. */
      parentToolId?: string;
    }
  | {
      type: "tool.complete";
      sessionId: string;
      turnId: string;
      toolId: string;
      output: unknown;
      isError: boolean;
      /** SDK parent_tool_use_id. Present when this tool runs inside a subagent. */
      parentToolId?: string;
    }
  | {
      type: "approval.request";
      requestId: string;
      toolName: string;
      reason: string;
      timeout: number;
      /** Whether an SDK-backed, policy-safe session approval is available. */
      allowSession: boolean;
    }
  | {
      type: "approval.decision";
      requestId: string;
      approved: boolean;
      scope?: "once" | "session";
      outcome?: "approved" | "denied" | "timed_out" | "canceled";
    }
  | {
      type: "context.usage";
      sessionId: string;
      turnId: string;
      phase?: "turn_start" | "turn_end";
      percentage?: number;
      limit?: number;
      usage?: ContextUsageRecord;
    }
  | {
      type: "context.warning";
      sessionId: string;
      turnId: string;
      level: "low" | "medium" | "high" | "critical";
      message: string;
      percentage?: number;
    }
  | {
      type: "context.compaction";
      sessionId: string;
      turnId?: string;
      phase: "started" | "completed" | "blocked";
      reason: "preflight" | "mid_turn" | "turn_end" | "model_switch" | "manual";
      message?: string;
      actionRequest?: ContextActionRequest;
    }
  | {
      type: "session.info";
      sessionId: string;
      turnId: string;
      skills: string[];
      slashCommands: string[];
      agents: string[];
    }
  | {
      type: "mcp.status";
      sessionId: string;
      turnId: string;
      servers: unknown[];
      tools?: string[];
    }
  | {
      type: "memory.recall";
      sessionId: string;
      turnId: string;
      mode: "select" | "synthesize";
      memories: MemoryRecallRecord[];
    }
  | {
      type: "runtime.status";
      sessionId: string;
      turnId: string;
      id?: string;
      label: string;
      detail?: string;
      status?: "pending" | "running" | "completed" | "error";
      /** SDK parent_tool_use_id. Present for a status emitted by a subagent. */
      parentToolId?: string;
    }
  | {
      type: "execution.subagent.start";
      sessionId: string;
      turnId: string;
      parentToolId: string;
      subagentId: string;
      agentType?: string;
      agentName?: string;
      description?: string;
      prompt?: string;
      title?: string;
      taskId?: string;
      ordinal?: number;
      status: "creating" | "running";
      timestamp: number;
    }
  | {
      type: "execution.subagent.event";
      sessionId: string;
      turnId: string;
      parentToolId: string;
      subagentId: string;
      event:
        | Extract<UIEvent, { type: "text.chunk" | "thinking.chunk" }>
        | Extract<
            UIEvent,
            { type: "tool.start" | "tool.progress" | "tool.complete" }
          >
        | Extract<UIEvent, { type: "runtime.status" }>;
      timestamp: number;
    }
  | {
      type: "execution.subagent.complete";
      sessionId: string;
      turnId: string;
      parentToolId: string;
      subagentId: string;
      status: "completed" | "failed";
      output?: unknown;
      timestamp: number;
    }
  | {
      type: "execution.task.update";
      sessionId: string;
      turnId: string;
      taskId: string;
      parentToolId?: string;
      ordinal?: number;
      title: string;
      detail?: string;
      status: "creating" | "running" | "completed" | "failed";
      agentType?: string;
      prompt?: string;
      taskType?: string;
      blockedBy?: string[];
      output?: unknown;
      timestamp: number;
    }
  | {
      type: "prompt.suggestion";
      sessionId: string;
      turnId: string;
      suggestion: string;
    }
  | {
      type: "usage";
      sessionId: string;
      turnId: string;
      usage: TokenUsage;
      modelId?: string;
      timestamp?: number;
    }
  | {
      type: "error";
      sessionId?: string;
      turnId?: string;
      code: string;
      message: string;
      recoverable: boolean;
    }
  | {
      type: "user.message";
      sessionId: string;
      turnId: string;
      messageId: string;
      content: string;
      userContent?: unknown[];
      timestamp: number;
    }
  | {
      type: "compact.boundary";
      sessionId: string;
      turnId: string;
      trigger: "manual" | "auto";
      preTokens: number;
      postTokens?: number;
      timestamp: number;
    }
  | { type: "session.titleUpdated"; sessionId: string; title: string };
/**
 * UI request types sent to the backend.
 */
export type UIRequest =
  | {
      type: "chat.send";
      sessionId: string;
      text: string;
      attachments?: unknown[];
    }
  | { type: "chat.abort"; turnId: string }
  | {
      type: "chat.fork";
      sessionId: string;
      lastTurnId?: string;
      title?: string;
    }
  | { type: "session.list" }
  | { type: "session.create" }
  | { type: "session.delete"; sessionId: string }
  | { type: "session.rename"; sessionId: string; title: string }
  | {
      type: "approval.respond";
      requestId: string;
      approved: boolean;
      scope: "once" | "session";
    }
  | { type: "settings.get" }
  | { type: "settings.update"; settings: Record<string, unknown> };

/**
 * UI response types returned to the renderer.
 */
export type UIResponse =
  | { type: "success"; requestId: string; data?: unknown }
  | { type: "error"; requestId: string; code: string; message: string }
  | { type: "stream.start"; streamId: string }
  | { type: "stream.event"; streamId: string; event: UIEvent }
  | { type: "stream.end"; streamId: string };

/**
 * Protocol version negotiation request.
 */
export interface ProtocolNegotiateRequest {
  clientVersion: string;
  supportedVersions: string[];
}

/**
 * Protocol version negotiation response.
 */
export interface ProtocolNegotiateResponse {
  agreedVersion: string;
  serverVersion: string;
  capabilities: string[];
}

/**
 * UI Protocol error codes.
 */
export const UIErrorCode = {
  UNKNOWN: "UNKNOWN",
  INVALID_REQUEST: "INVALID_REQUEST",
  SESSION_NOT_FOUND: "SESSION_NOT_FOUND",
  THREAD_NOT_FOUND: "THREAD_NOT_FOUND",
  TURN_NOT_FOUND: "TURN_NOT_FOUND",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  TIMEOUT: "TIMEOUT",
  ABORTED: "ABORTED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type UIErrorCode = (typeof UIErrorCode)[keyof typeof UIErrorCode];
