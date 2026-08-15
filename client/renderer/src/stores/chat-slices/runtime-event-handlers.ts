/**
 * Runtime event handlers extracted from handleEvent.
 *
 * Handles: context.compaction, context.usage, session.info/mcp.status.
 *
 * text.chunk, thinking.chunk, tool.*, usage are short-circuited in
 * handleEvent before reaching the store — their data arrives via the
 * item-event batch path and readThread snapshots, which the page
 * renders from.
 */

import type { UIEvent } from "@shared/ui-protocol";
import { hasStreamingSessions } from "./helpers";
import type { UnifiedChatStore } from "./types";

type Patch = Partial<UnifiedChatStore>;

function readRuntimeServers(
  value: unknown,
): Array<{ name: string; status?: string; error?: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    if (typeof record.name !== "string") return [];
    return [
      {
        name: record.name,
        status: typeof record.status === "string" ? record.status : undefined,
        error: typeof record.error === "string" ? record.error : undefined,
      },
    ];
  });
}

/**
 * context.compaction — handle context compaction phases (started/completed/blocked).
 */
export function handleContextCompaction(
  state: UnifiedChatStore,
  event: Extract<UIEvent, { type: "context.compaction" }>,
): Patch {
  const sessionId = event.sessionId;
  if (event.phase === "blocked") {
    const streamingSessionIds = { ...state.streamingSessionIds };
    delete streamingSessionIds[sessionId];
    return {
      isStreaming: hasStreamingSessions(streamingSessionIds),
      currentRequestId: null,
      streamingSessionIds,
      contextActionRequest: event.actionRequest ?? state.contextActionRequest,
    };
  }
  return {
    isStreaming: event.phase === "started" ? true : state.isStreaming,
    streamingSessionIds:
      event.phase === "started"
        ? { ...state.streamingSessionIds, [sessionId]: true }
        : state.streamingSessionIds,
  };
}

/**
 * context.usage — store context usage independently of turn lifecycle.
 */
export function handleContextUsage(
  state: UnifiedChatStore,
  event: Extract<UIEvent, { type: "context.usage" }>,
): Patch {
  const sessionId = event.sessionId;
  const next: Patch = {
    contextUsage: { ...state.contextUsage, [sessionId]: event.usage },
  };
  // The turn_end probe returns a real ContextUsageRecord (top-level
  // totalTokens). The turn_start synthetic uses a different shape
  // ({ total: { tokens } }) and must not be pinned to a message.
  if (event.turnId && event.usage && event.usage.totalTokens !== undefined) {
    // Pin under BOTH keys: the live fallback path keys assistant
    // messages as `assistant-<turnId>`, but the main-process readThread
    // (shown after turn.complete reloads) uses the raw turnId. Without
    // both, the ring vanishes when the readThread replaces the fallback.
    const sessionMap = state.turnContextUsage[sessionId] ?? {};
    const pinned = {
      ...sessionMap,
      [`assistant-${event.turnId}`]: event.usage,
      [event.turnId]: event.usage,
    };
    next.turnContextUsage = {
      ...state.turnContextUsage,
      [sessionId]: pinned,
    };
  }
  return next;
}

/**
 * Status-type events: session.info, mcp.status, memory.recall,
 * context.warning, runtime.status, prompt.suggestion.
 *
 * Only session.info and mcp.status carry side effects (sessionInitInfo);
 * the rest are no-ops — their data arrives via item events and readThread
 * snapshots.
 */
export function handleStatusEvents(
  state: UnifiedChatStore,
  event:
    | Extract<UIEvent, { type: "session.info" }>
    | Extract<UIEvent, { type: "mcp.status" }>
    | Extract<UIEvent, { type: "memory.recall" }>
    | Extract<UIEvent, { type: "context.warning" }>
    | Extract<UIEvent, { type: "runtime.status" }>
    | Extract<UIEvent, { type: "prompt.suggestion" }>,
): Patch {
  const sessionId = event.sessionId;

  let nextSessionInitInfo = state.sessionInitInfo;
  if (event.type === "session.info") {
    const prev = state.sessionInitInfo[sessionId];
    nextSessionInitInfo = {
      ...state.sessionInitInfo,
      [sessionId]: {
        slashCommands: Array.from(
          new Set([...(prev?.slashCommands ?? []), ...event.slashCommands]),
        ),
        skills: Array.from(new Set([...(prev?.skills ?? []), ...event.skills])),
        agents: Array.from(new Set([...(prev?.agents ?? []), ...event.agents])),
        mcpTools: prev?.mcpTools,
        mcpServers: prev?.mcpServers,
        mcpUpdatedAt: prev?.mcpUpdatedAt,
      },
    };
  }
  if (event.type === "mcp.status") {
    const prev = state.sessionInitInfo[sessionId];
    nextSessionInitInfo = {
      ...state.sessionInitInfo,
      [sessionId]: {
        slashCommands: prev?.slashCommands ?? [],
        skills: prev?.skills ?? [],
        agents: prev?.agents ?? [],
        mcpTools: event.tools ?? [],
        mcpServers: readRuntimeServers(event.servers),
        mcpUpdatedAt: Date.now(),
      },
    };
  }

  return nextSessionInitInfo === state.sessionInitInfo
    ? {}
    : { sessionInitInfo: nextSessionInitInfo };
}
