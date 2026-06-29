/**
 * UI Protocol - stable renderer-facing contract, decoupled from internal events.
 */

export const UI_PROTOCOL_VERSION = "1.0";

import type { ContextActionRequest, ContextUsageRecord, MemoryRecallRecord, TokenUsage } from "./types";

/**
 * UI event types translated from internal AgentEvent values.
 */
export type UIEvent =
  | { type: "turn.start"; sessionId: string; turnId: string; timestamp: number }
  | {
      type: "turn.complete";
      sessionId: string;
      turnId: string;
      result: "success" | "error" | "aborted";
      content?: string;
      error?: string;
      sdkSessionId?: string;
      timestamp: number;
    }
  | { type: "text.chunk"; sessionId: string; turnId: string; content: string; index: number }
  | { type: "thinking.chunk"; sessionId: string; turnId: string; content: string }
  | { type: "tool.start"; sessionId: string; turnId: string; toolId: string; toolName: string; input: unknown }
  | {
      type: "tool.progress";
      sessionId: string;
      turnId: string;
      toolId: string;
      toolName: string;
      partialInput: string;
      input?: unknown;
      isReady?: boolean;
    }
  | { type: "tool.complete"; sessionId: string; turnId: string; toolId: string; output: unknown; isError: boolean }
  | { type: "approval.request"; requestId: string; toolName: string; reason: string; timeout: number }
  | { type: "approval.decision"; requestId: string; approved: boolean; scope: "once" | "session" }
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
  | { type: "mcp.status"; sessionId: string; turnId: string; servers: unknown[]; tools?: string[] }
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
    }
  | { type: "prompt.suggestion"; sessionId: string; turnId: string; suggestion: string }
  | { type: "usage"; sessionId: string; turnId: string; usage: TokenUsage }
  | { type: "error"; sessionId?: string; turnId?: string; code: string; message: string; recoverable: boolean };

/**
 * UI request types sent to the backend.
 */
export type UIRequest =
  | { type: "chat.send"; sessionId: string; text: string; attachments?: unknown[] }
  | { type: "chat.abort"; turnId: string }
  | { type: "chat.fork"; sessionId: string; upToMessageId?: string; title?: string }
  | { type: "session.list" }
  | { type: "session.create" }
  | { type: "session.delete"; sessionId: string }
  | { type: "session.rename"; sessionId: string; title: string }
  | { type: "approval.respond"; requestId: string; approved: boolean; scope: "once" | "session" }
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

/* PRD 2.4 — Renderer 消费的内容契约：MessageContent / ContentBlock。
 * 现有 UIEvent 流通过 adapter 映射为这些内容块。blocks 顺序即渲染顺序。 */
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "code"; language: string; code: string }
  | { type: "image"; src: string; alt?: string }
  | {
      type: "tool-card";
      toolCallId: string;
      toolName: string;
      status: "pending" | "running" | "done";
      result?: unknown;
    }
  | { type: "diff"; filePath: string; patch: string }
  | { type: "file-link"; path: string; action: "read" | "write" | "create" | "delete" };

export interface MessageContent {
  text?: string;
  blocks: ContentBlock[];
}

/* PRD 2.4 — UiEvent 语义事件名（连字符风格），与现有 UIEvent 等价映射。
 * 保留现有点号命名 UIEvent 以兼容已落地的渲染链；新增 PRD 规范命名作为对外契约。 */
export type UiEvent =
  | { kind: "agent-message"; content: MessageContent; messageId: string }
  | { kind: "tool-call"; toolName: string; toolCallId: string; input: unknown }
  | { kind: "tool-result"; toolCallId: string; output: unknown; isError?: boolean }
  | { kind: "thinking"; content: string }
  | { kind: "approval-request"; toolCallId: string; toolName: string; description: string }
  | { kind: "status"; status: "idle" | "generating" | "executing" | "paused" }
  | { kind: "done"; threadId: string; usage?: TokenUsage }
  | { kind: "error"; code: string; message: string; recoverable: boolean };
