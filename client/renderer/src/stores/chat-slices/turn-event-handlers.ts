/**
 * Turn lifecycle event handlers extracted from handleEvent.
 *
 * Each function receives the current state and the UIEvent, and returns
 * a partial state patch (or {} for no-op).
 *
 * Streaming data arrives via item events and readThread snapshots,
 * item events and readThread snapshots, which the page renders from.
 * These handlers only manage streaming flags, request IDs, steer cleanup,
 * and session metadata.
 */

import type { UIEvent } from "@shared/ui-protocol";
import {
  clearSteersForTurn,
  hasStreamingSessions,
  patchSessionMeta,
  updateUnreadCompletion,
} from "./helpers";
import type { UnifiedChatStore } from "./types";

type Patch = Partial<UnifiedChatStore>;

/**
 * turn.start — mark the session as streaming.
 */
export function handleTurnStart(
  state: UnifiedChatStore,
  event: Extract<UIEvent, { type: "turn.start" }>,
): Patch {
  const sessionId = event.sessionId;
  return {
    currentRequestId: event.turnId,
    isStreaming: true,
    streamingSessionIds: { ...state.streamingSessionIds, [sessionId]: true },
  };
}

/**
 * turn.complete with result "aborted" or "interrupted" — abort path.
 */
export function handleTurnCompleteAborted(
  state: UnifiedChatStore,
  event: Extract<UIEvent, { type: "turn.complete" }>,
): Patch {
  const sessionId = event.sessionId;
  const streamingSessionIds = { ...state.streamingSessionIds };
  delete streamingSessionIds[sessionId];
  // 路径④：interrupted + 队列非空 → 暂停（不清队列，置 paused）。
  // aborted 及 interrupted 空队列 → 按 turnId 精确清。
  const queueLen = (state.pendingSteers[sessionId] ?? []).length;
  const isPausedByInterrupt = event.result === "interrupted" && queueLen > 0;
  const steerCleanup =
    isPausedByInterrupt || !event.turnId
      ? {
          pendingSteers: state.pendingSteers,
          turnSteerActivity: state.turnSteerActivity,
        }
      : clearSteersForTurn(state, sessionId, event.turnId);
  return {
    isStreaming: hasStreamingSessions(streamingSessionIds),
    currentRequestId: null,
    ...steerCleanup,
    steerQueuePaused: isPausedByInterrupt
      ? { ...state.steerQueuePaused, [sessionId]: true }
      : { ...state.steerQueuePaused, [sessionId]: undefined },
    streamingSessionIds,
  };
}

/**
 * turn.complete with result "success" or "error" — normal completion path.
 */
export function handleTurnCompleteSuccess(
  state: UnifiedChatStore,
  event: Extract<UIEvent, { type: "turn.complete" }>,
): Patch {
  const sessionId = event.sessionId;
  const streamingSessionIds = { ...state.streamingSessionIds };
  delete streamingSessionIds[sessionId];
  const pendingSteers = { ...state.pendingSteers };
  delete pendingSteers[sessionId];
  const turnSteerActivity = { ...state.turnSteerActivity };
  delete turnSteerActivity[`${sessionId}:${event.turnId}`];
  return {
    isStreaming: hasStreamingSessions(streamingSessionIds),
    currentRequestId:
      state.currentRequestId === event.turnId ? null : state.currentRequestId,
    streamingSessionIds,
    pendingSteers,
    turnSteerActivity,
    unreadCompletedSessionIds: updateUnreadCompletion(
      state.unreadCompletedSessionIds,
      sessionId,
      state.visibleSessionId !== sessionId,
    ),
    allSessions: patchSessionMeta(state.allSessions, sessionId, {
      updatedAt: Date.now(),
    }),
    sessions: state.sessions.map((session) =>
      session.id === sessionId
        ? {
            ...session,
            sdkSessionId:
              event.result === "success"
                ? (event.sdkSessionId ?? session.sdkSessionId)
                : session.sdkSessionId,
            messages: session.messages.map((message) =>
              message.id === `assistant-${event.turnId}`
                ? {
                    ...message,
                    isError: event.result === "error",
                  }
                : message,
            ),
            updatedAt: Date.now(),
          }
        : session,
    ),
  };
}
