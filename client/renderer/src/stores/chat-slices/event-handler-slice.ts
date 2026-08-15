/**
 * Event handler slice — context usage, session init info, and event dispatching.
 *
 * Owns: contextUsage, turnContextUsage, sessionInitInfo, executionBySession
 *
 * handleEvent dispatches to extracted handler functions (turn-event-handlers,
 * steer-event-handlers, runtime-event-handlers) and inlines the execution.*
 * events (simple one-liner set() calls).
 * handleItemEvent is kept inline because it modifies sessions (message list)
 * directly, following a different pattern from handleEvent.
 */

import type { UIEvent } from "@shared/ui-protocol";
import type { WorkflowPlanItem } from "@shared/workflow-read-thread-contract";
import type { Message } from "../../types";
import {
  appendExecutionSubagentEvent,
  completeExecutionSubagent,
  isTurnAborted,
  upsertExecutionSubagentStart,
  upsertExecutionTask,
} from "../workflow-message-builders";
import type { ItemEvent, UnifiedChatStore } from "./types";
import {
  assistantTextFromItems,
  boundLiveMessageItems,
  clearSteersForTurn,
  hasStreamingSessions,
  mergeItems,
  updateUnreadCompletion,
} from "./helpers";
import {
  handleTurnCompleteAborted,
  handleTurnCompleteSuccess,
  handleTurnStart,
} from "./turn-event-handlers";
import {
  handleSessionTitleUpdated,
  handleSteerMessage,
} from "./steer-event-handlers";
import {
  handleContextCompaction,
  handleContextUsage,
  handleStatusEvents,
} from "./runtime-event-handlers";

type Set = (
  partial:
    | Partial<UnifiedChatStore>
    | ((state: UnifiedChatStore) => Partial<UnifiedChatStore>),
) => void;
type Get = () => UnifiedChatStore;

export function createEventHandlerSlice(
  set: Set,
  get: Get,
): Partial<UnifiedChatStore> {
  return {
    contextUsage: {},
    turnContextUsage: {},
    sessionInitInfo: {},
    executionBySession: {},

    // ─── handleItemEvent ──────────────────────────────────────────
    //
    // Processes coalesced item-level events (turn.start, item.updated,
    // items.updated, turn.complete) that update the session message list
    // directly. This is the "batch apply" path.
    handleItemEvent: (event: ItemEvent) => {
      const sessionId = event.sessionId;
      if (!sessionId) return;

      // 已中止 turn 的晚到事件（尤其 turn.start）：直接丢弃，防止会话被复活。
      // turn.complete(aborted) 例外，需放行以跑收尾清理。
      if (
        "turnId" in event &&
        isTurnAborted(event.turnId) &&
        !(
          event.type === "turn.complete" &&
          (event.result === "aborted" || event.result === "interrupted")
        )
      ) {
        return;
      }

      // turn.start: create an assistant message placeholder.
      if (event.type === "turn.start") {
        set((state) => ({
          isStreaming: true,
          currentRequestId: event.turnId,
          streamingSessionIds: {
            ...state.streamingSessionIds,
            [sessionId]: true,
          },
          sessions: state.sessions.map((s) => {
            if (s.id !== sessionId) return s;
            const assistantId = `assistant-${event.turnId}`;
            const assistantMsg: Message = {
              id: assistantId,
              role: "assistant",
              content: "",
              timestamp: event.startedAt ?? Date.now(),
              status: "thinking",
              items: [],
            };
            return {
              ...s,
              messages: [
                ...s.messages,
                {
                  id: assistantMsg.id,
                  role: "assistant",
                  content: "",
                  blocks: [],
                  createdAt: assistantMsg.timestamp,
                  items: [],
                  startedAt: assistantMsg.timestamp,
                  modelId: event.modelId,
                  modelName: event.modelName,
                },
              ],
            };
          }),
        }));
        return;
      }

      // Apply a coalesced item batch with one store publication/render pass.
      if (
        (event.type === "item.updated" && event.item) ||
        (event.type === "items.updated" && event.items?.length)
      ) {
        const messageId = `assistant-${event.turnId}`;
        const updates = event.items ?? (event.item ? [event.item] : []);
        set((state) => ({
          sessions: state.sessions.map((s) => {
            if (s.id !== sessionId) return s;
            return {
              ...s,
              updatedAt: Date.now(),
              messages: s.messages.map((m) => {
                if (m.id !== messageId) return m;
                const items = boundLiveMessageItems(
                  mergeItems(m.items, updates),
                );
                const text = assistantTextFromItems(items);
                return {
                  ...m,
                  items,
                  content: text,
                  blocks: text
                    ? [{ id: `${m.id}-text`, type: "text" as const, text }]
                    : m.blocks,
                };
              }),
            };
          }),
        }));
        return;
      }

      // turn.complete: 标记 assistant message 完成
      if (event.type === "turn.complete") {
        if (event.final === false) return;
        set((state) => {
          const streamingSessionIds = { ...state.streamingSessionIds };
          delete streamingSessionIds[sessionId];
          const turnSteerKey = `${sessionId}:${event.turnId}`;
          const hadPendingSteers =
            (state.pendingSteers[sessionId] ?? []).length > 0 ||
            Boolean(state.turnSteerActivity[turnSteerKey]);
          // 手动停止或模型/runtime 失败都不能吞掉用户已持久化的输入：
          // 队列留在 Outbox 并暂停，等待用户恢复。正常完成才会由 runtime
          // boundary 消费；显式 aborted 启动取消仍按原 turn 清理。
          const isPausedByInterrupt =
            (event.result === "interrupted" || event.result === "error") &&
            hadPendingSteers;
          const steerCleanup =
            isPausedByInterrupt || !event.turnId
              ? {
                  pendingSteers: state.pendingSteers,
                  turnSteerActivity: state.turnSteerActivity,
                }
              : clearSteersForTurn(state, sessionId, event.turnId);
          const assistantMessageId = `assistant-${event.turnId}`;
          const assistantMessage = state.sessions
            .find((s) => s.id === sessionId)
            ?.messages.find((m) => m.id === assistantMessageId);
          const latestPlan = [...(assistantMessage?.items ?? [])]
            .reverse()
            .find(
              (item): item is WorkflowPlanItem =>
                item.type === "plan" &&
                item.settled === true &&
                Boolean(item.text?.trim()),
            );
          const nextPlanPrompt =
            event.result === "success" && latestPlan && !hadPendingSteers
              ? {
                  sessionId,
                  turnId: event.turnId,
                  planText: latestPlan.text ?? "",
                }
              : state.planImplementationPrompt;
          return {
            isStreaming: hasStreamingSessions(streamingSessionIds),
            currentRequestId:
              state.currentRequestId === event.turnId
                ? null
                : state.currentRequestId,
            streamingSessionIds,
            ...steerCleanup,
            steerQueuePaused: isPausedByInterrupt
              ? { ...state.steerQueuePaused, [sessionId]: true }
              : { ...state.steerQueuePaused, [sessionId]: undefined },
            planImplementationPrompt: nextPlanPrompt,
            unreadCompletedSessionIds: updateUnreadCompletion(
              state.unreadCompletedSessionIds,
              sessionId,
              state.visibleSessionId !== sessionId &&
                event.result !== "aborted" &&
                event.result !== "interrupted",
            ),
            sessions: state.sessions.map((s) => {
              if (s.id !== sessionId) return s;
              return {
                ...s,
                messages: s.messages.map((m) => {
                  if (m.id !== `assistant-${event.turnId}`) return m;
                  return {
                    ...m,
                    completedAt: event.completedAt ?? Date.now(),
                    modelId: event.modelId ?? m.modelId,
                    modelName: event.modelName ?? m.modelName,
                    usage: event.usage ?? m.usage,
                    isError: event.result === "error",
                  };
                }),
              };
            }),
          };
        });
        return;
      }
    },

    // ─── handleEvent ──────────────────────────────────────────────
    //
    // Dispatches UIEvent by type to extracted handler functions.
    // execution.* events are inlined (simple one-liner set() calls).
    // turn.complete success triggers a readThread reload side-effect.
    handleEvent: (event: UIEvent) => {
      if (!("sessionId" in event)) return;
      const sessionId = event.sessionId;
      if (!sessionId) return;

      // 已中止 turn 的晚到事件（尤其 turn.start）：直接丢弃，防止会话被复活。
      // turn.complete(aborted) 例外，需放行以跑收尾清理；steer.message(canceled)
      // 也放行，让排队 steer 能从 UI 移除。
      if (
        "turnId" in event &&
        event.turnId &&
        isTurnAborted(event.turnId) &&
        !(
          event.type === "turn.complete" &&
          (event.result === "aborted" || event.result === "interrupted")
        ) &&
        !(event.type === "steer.message" && event.status === "canceled")
      ) {
        return;
      }

      if (event.type === "session.titleUpdated") {
        set((state) => handleSessionTitleUpdated(state, event));
        return;
      }

      if (event.type === "steer.message") {
        set((state) => handleSteerMessage(state, event));
        return;
      }

      if (event.type === "turn.start") {
        set((state) => handleTurnStart(state, event));
        return;
      }

      if (
        event.type === "turn.complete" &&
        event.final !== false &&
        (event.result === "aborted" || event.result === "interrupted")
      ) {
        set((state) => handleTurnCompleteAborted(state, event));
        return;
      }

      if (event.type === "context.compaction") {
        set((state) => handleContextCompaction(state, event));
        return;
      }

      // execution.* events — simple one-liner set() calls, inlined.
      if (event.type === "execution.task.update") {
        set((state) => ({
          executionBySession: upsertExecutionTask(
            state.executionBySession,
            event,
          ),
        }));
        return;
      }

      if (event.type === "execution.subagent.start") {
        set((state) => ({
          executionBySession: upsertExecutionSubagentStart(
            state.executionBySession,
            event,
          ),
        }));
        return;
      }

      if (event.type === "execution.subagent.event") {
        set((state) => ({
          executionBySession: appendExecutionSubagentEvent(
            state.executionBySession,
            event,
          ),
        }));
        return;
      }

      if (event.type === "execution.subagent.complete") {
        set((state) => ({
          executionBySession: completeExecutionSubagent(
            state.executionBySession,
            event,
          ),
        }));
        return;
      }

      // No-op streaming events: text.chunk, thinking.chunk, tool.*, usage
      // arrive via UIEvent but their content is already delivered through
      // the item-event batch path and readThread snapshots. Short-circuit
      // here to avoid empty set() notifications 10-50x/sec.
      if (
        event.type === "text.chunk" ||
        event.type === "thinking.chunk" ||
        event.type === "tool.start" ||
        event.type === "tool.progress" ||
        event.type === "tool.complete" ||
        event.type === "usage"
      ) {
        return;
      }

      if (event.type === "context.usage") {
        set((state) => handleContextUsage(state, event));
        return;
      }

      if (
        event.type === "session.info" ||
        event.type === "mcp.status" ||
        event.type === "memory.recall" ||
        event.type === "context.warning" ||
        event.type === "runtime.status" ||
        event.type === "prompt.suggestion"
      ) {
        set((state) => handleStatusEvents(state, event));
        return;
      }

      if (
        event.type === "turn.complete" &&
        event.final !== false &&
        event.result !== "aborted" &&
        event.result !== "interrupted"
      ) {
        set((state) => handleTurnCompleteSuccess(state, event));
        void get().loadReadThread(sessionId);
      }
    },

    // ─── selectExecutionSubagent ─────────────────────────────────
    selectExecutionSubagent: (sessionId, subagentId) => {
      set((state) => {
        const current = state.executionBySession[sessionId];
        if (!current?.subagents[subagentId]) return {};
        return {
          executionBySession: {
            ...state.executionBySession,
            [sessionId]: {
              ...current,
              selectedSubagentId: subagentId,
            },
          },
        };
      });
    },

    // ─── revealExecutionSubagent ──────────────────────────────────
    revealExecutionSubagent: (sessionId, subagentId) => {
      set((state) => {
        const current = state.executionBySession[sessionId];
        if (!current?.subagents[subagentId]) return {};
        return {
          executionBySession: {
            ...state.executionBySession,
            [sessionId]: {
              ...current,
              selectedSubagentId: subagentId,
              revealSubagentSeq: (current.revealSubagentSeq ?? 0) + 1,
            },
          },
        };
      });
    },
  };
}
