/**
 * Steer and session event handlers extracted from handleEvent.
 */

import type { UIEvent } from "@shared/ui-protocol";
import { patchSessionMeta } from "./helpers";
import type { PendingSteerPreview, UnifiedChatStore } from "./types";

type Patch = Partial<UnifiedChatStore>;

/**
 * session.titleUpdated — update session title in both sessions and allSessions.
 */
export function handleSessionTitleUpdated(
  state: UnifiedChatStore,
  event: Extract<UIEvent, { type: "session.titleUpdated" }>,
): Patch {
  const updatedAt = Date.now();
  return {
    sessions: patchSessionMeta(state.sessions, event.sessionId, {
      title: event.title,
      updatedAt,
    }),
    allSessions: patchSessionMeta(state.allSessions, event.sessionId, {
      title: event.title,
      updatedAt,
    }),
  };
}

/**
 * steer.message — handle sent/applied/canceled/queued steer states.
 */
export function handleSteerMessage(
  state: UnifiedChatStore,
  event: Extract<UIEvent, { type: "steer.message" }>,
): Patch {
  const sessionId = event.sessionId;
  const current = state.pendingSteers[sessionId] ?? [];
  const status = event.status ?? "sent";
  const turnSteerActivity = {
    ...state.turnSteerActivity,
    [`${sessionId}:${event.turnId}`]: true as const,
  };

  // canceled：回合收尾时仍未注入的排队 steer，仅从待发列表移除，
  // 不落入会话消息（它从未真正发给 agent）。
  if (status === "canceled") {
    return {
      pendingSteers: {
        ...state.pendingSteers,
        [sessionId]: current.filter((item) => item.id !== event.messageId),
      },
    };
  }

  if (status === "sent" || status === "applied") {
    // Both boundary-delivered and immediately-applied steers are distinct
    // chronological user inputs in the conversation transcript.
    return {
      pendingSteers: {
        ...state.pendingSteers,
        [sessionId]: current.filter((item) => item.id !== event.messageId),
      },
      turnSteerActivity,
      allSessions: patchSessionMeta(state.allSessions, sessionId, {
        updatedAt: Date.now(),
      }),
      sessions: state.sessions.map((session) => {
        if (session.id !== sessionId) return session;
        if (
          session.messages.some((message) => message.id === event.messageId)
        ) {
          return session;
        }
        return {
          ...session,
          updatedAt: Date.now(),
          messages: [
            ...session.messages,
            {
              id: event.messageId,
              role: "user",
              content: event.text,
              userContent: event.content,
              blocks: event.text
                ? [
                    {
                      id: `${event.messageId}-text`,
                      type: "text" as const,
                      text: event.text,
                    },
                  ]
                : [],
              createdAt: event.timestamp,
              items: [],
            },
          ],
        };
      }),
    };
  }

  const exists = current.some((item) => item.id === event.messageId);
  // 防死复活：steer 的生命周期状态由 IPC/乐观更新驱动，显示事件不创建新状态。
  // 若该 steer 不存在且 turn 已结束（streaming 已清），说明是晚到的死事件，
  // 不插入（否则 turn.complete 清空后又被重新插入，此后无收尾清理 → 卡住）。
  if (!exists && !state.streamingSessionIds[sessionId]) {
    return {};
  }
  const next: PendingSteerPreview[] = exists
    ? current.map((item) =>
        item.id === event.messageId
          ? {
              ...item,
              turnId: event.turnId,
              text: event.text,
              status: "queued" as const,
            }
          : item,
      )
    : [
        ...current,
        {
          id: event.messageId,
          sessionId,
          turnId: event.turnId,
          text: event.text,
          createdAt: event.timestamp,
          status: "queued" as const,
        },
      ];
  return {
    pendingSteers: { ...state.pendingSteers, [sessionId]: next },
    turnSteerActivity,
  };
}
