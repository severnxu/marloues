import type { RuntimeEvent } from "./agent-runtime";
import type { UIEvent } from "./ui-protocol";

const textChunkCounters = new Map<string, number>();

function turnCounterKey(sessionId: string, turnId: string): string {
  return `${sessionId}:${turnId}`;
}

function nextTextChunkIndex(sessionId: string, turnId: string): number {
  const key = turnCounterKey(sessionId, turnId);
  const next = (textChunkCounters.get(key) ?? 0) + 1;
  textChunkCounters.set(key, next);
  return next;
}


export function translateRuntimeEventToUIEvent(
  evt: RuntimeEvent,
  sessionId: string,
  turnId: string,
): UIEvent | null {
  const base = { sessionId, turnId };

  switch (evt.kind) {
    case "turn-start":
      textChunkCounters.set(turnCounterKey(sessionId, turnId), 0);
      return { ...base, type: "turn.start", timestamp: evt.payload.timestamp };
    case "text-chunk":
      return { ...base, type: "text.chunk", content: evt.payload.content, index: nextTextChunkIndex(sessionId, turnId) };
    case "thinking-chunk":
      return { ...base, type: "thinking.chunk", content: evt.payload.content };
    case "tool-start":
      return {
        ...base,
        type: "tool.start",
        toolId: evt.payload.toolId,
        toolName: evt.payload.toolName,
        input: evt.payload.input,
      };
    case "tool-progress":
      return {
        ...base,
        type: "tool.progress",
        toolId: evt.payload.toolId,
        toolName: evt.payload.toolName,
        partialInput: evt.payload.partialInput ?? "",
        input: evt.payload.input,
        isReady: evt.payload.isReady,
      };
    case "tool-complete":
      return {
        ...base,
        type: "tool.complete",
        toolId: evt.payload.toolId,
        output: evt.payload.output,
        isError: evt.payload.isError,
      };
    case "turn-complete":
      textChunkCounters.delete(turnCounterKey(sessionId, turnId));
      return {
        ...base,
        type: "turn.complete",
        result: evt.payload.result,
        content: evt.payload.content,
        error: evt.payload.error,
        sdkSessionId: evt.payload.sdkSessionId,
        timestamp: Date.now(),
      };
    case "runtime-status":
      return {
        ...base,
        type: "runtime.status",
        id: evt.payload.id,
        label: evt.payload.label,
        detail: evt.payload.detail,
        status: evt.payload.status,
      };
    case "session-info":
      return {
        ...base,
        type: "session.info",
        skills: evt.payload.skills,
        slashCommands: evt.payload.slashCommands,
        agents: evt.payload.agents,
      };
    case "mcp-status":
      return {
        ...base,
        type: "mcp.status",
        servers: evt.payload.servers,
        tools: evt.payload.tools,
      };
    case "memory-recall":
      return {
        ...base,
        type: "memory.recall",
        mode: evt.payload.mode,
        memories: evt.payload.memories,
      };
    case "prompt-suggestion":
      return {
        ...base,
        type: "prompt.suggestion",
        suggestion: evt.payload.suggestion,
      };
    case "context-usage":
      return {
        ...base,
        type: "context.usage",
        phase: evt.payload.phase,
        percentage: evt.payload.percentage,
        limit: evt.payload.limit,
        usage: evt.payload.usage,
      };
    case "context-warning":
      return {
        ...base,
        type: "context.warning",
        level: evt.payload.level,
        message: evt.payload.message,
        percentage: evt.payload.percentage,
      };
    case "token-usage":
      return {
        ...base,
        type: "usage",
        usage: evt.payload.usage,
      };
    case "approval-request":
      return {
        type: "approval.request",
        requestId: evt.payload.requestId,
        toolName: evt.payload.toolName,
        reason: evt.payload.reason,
        timeout: evt.payload.timeout,
      };
    case "error":
      return {
        ...base,
        type: "error",
        code: evt.payload.code,
        message: evt.payload.message,
        recoverable: evt.payload.recoverable,
      };
    default:
      return null;
  }
}
