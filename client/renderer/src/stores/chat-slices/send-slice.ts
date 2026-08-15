/**
 * Send slice — message sending, context action, abort, and compact.
 *
 * Owns: contextActionRequest
 *
 * Note: sendMessage, continueContextAction, abort, and compactSession all
 * modify isStreaming/currentRequestId/streamingSessionIds (owned by other
 * slices) via set(). This is the standard zustand slice pattern: any slice
 * can modify any field.
 */

import type { ChatSendReceipt } from "@shared/types";
import { trackMessageSend } from "@/lib/analytics";
import { notify } from "@/lib/notifications";
import { STRINGS } from "@shared/strings.zh";
import type { Message } from "../../types";
import type { UnifiedChatStore } from "./types";
import {
  buildUserContent,
  genId,
  hasStreamingSessions,
  isDefaultSessionTitle,
  patchSessionMeta,
  persistActiveSession,
} from "./helpers";
import {
  consumePendingAbort,
  markTurnAborted,
  markPendingAbort,
} from "../workflow-message-builders";
import { useWorkspaceStore } from "../workspace-store";

type Set = (
  partial:
    | Partial<UnifiedChatStore>
    | ((state: UnifiedChatStore) => Partial<UnifiedChatStore>),
) => void;
type Get = () => UnifiedChatStore;

export function createSendSlice(set: Set, get: Get): Partial<UnifiedChatStore> {
  return {
    contextActionRequest: null,

    sendMessage: async (text, attachments = [], clientMessageId, options) => {
      let sessionId = get().activeSessionId;
      const deliveryMode = options?.deliveryMode ?? "normal";
      let prestartedReceipt: ChatSendReceipt | undefined;
      if (deliveryMode === "steer") {
        if (sessionId && Boolean(get().streamingSessionIds[sessionId])) {
          const messageId = clientMessageId ?? genId("steer");
          const createdAt = Date.now();
          set((state) => ({
            pendingSteers: {
              ...state.pendingSteers,
              [sessionId!]: [
                ...(state.pendingSteers[sessionId!] ?? []),
                {
                  id: messageId,
                  sessionId: sessionId!,
                  turnId: get().currentRequestId,
                  text,
                  createdAt,
                  status: "queued",
                  attachments: attachments ?? undefined,
                },
              ],
            },
          }));
          try {
            const receipt = await window.marloues.chat.send({
              sessionId,
              text,
              attachments: buildUserContent(text, attachments),
              clientMessageId: messageId,
              deliveryMode: "steer",
              workMode: options?.workMode,
              permissionMode: options?.permissionMode,
            });
            if (receipt.status === "queued" && receipt.turnId) {
              set((state) => ({
                pendingSteers: {
                  ...state.pendingSteers,
                  [sessionId!]: (state.pendingSteers[sessionId!] ?? []).map(
                    (item) =>
                      item.id === messageId
                        ? { ...item, turnId: receipt.turnId, status: "queued" }
                        : item,
                  ),
                },
              }));
              return { ok: true };
            }
            set((state) => ({
              pendingSteers: {
                ...state.pendingSteers,
                [sessionId!]: (state.pendingSteers[sessionId!] ?? []).filter(
                  (item) => item.id !== messageId,
                ),
              },
            }));
            if (receipt.status === "fallback" && receipt.turnId) {
              // Main crossed the boundary atomically and already started the
              // normal turn with this same message id.  Continue only with the
              // optimistic normal-message state; never send the payload twice.
              prestartedReceipt = receipt;
            } else {
              notify({
                title: STRINGS.chat.append.failedTitle,
                description:
                  receipt.error || STRINGS.chat.append.failedNoReceipt,
                tone: "error",
              });
              return { ok: false, reason: "steer-rejected" };
            }
          } catch (error) {
            set((state) => ({
              pendingSteers: {
                ...state.pendingSteers,
                [sessionId!]: (state.pendingSteers[sessionId!] ?? []).filter(
                  (item) => item.id !== messageId,
                ),
              },
            }));
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            notify({
              title: STRINGS.chat.append.failedTitle,
              description: errorMessage || STRINGS.chat.append.failedGeneric,
              tone: "error",
            });
            return { ok: false, reason: "steer-rejected" };
          }
        }
        // steer 不可用（无会话 / turn 已结束）：降级为 normal 投递（新 turn），消息不丢。
        if (sessionId) {
          notify({
            title: STRINGS.chat.steerRejected.title,
            description: STRINGS.chat.steerRejected.description,
            tone: "info",
          });
        }
        // 不 return：继续走下方 normal 路径
      }
      if (!sessionId) {
        // 首次发送时才真正创建并落库（新建会话仅导航，发送才实例化）。
        try {
          const session = await window.marloues.chat.createSession();
          set((state) => ({
            sessions: [session, ...state.sessions],
            allSessions: [session, ...state.allSessions],
            activeSessionId: session.id,
            inputText: state.inputDrafts[session.id] ?? "",
          }));
          persistActiveSession(session.id);
          sessionId = session.id;
          // 会话真正落库后才展开工作空间，避免新建会话即展开。
          const ws = useWorkspaceStore.getState().current;
          if (ws) useWorkspaceStore.getState().expandWorkspace(ws.path);
        } catch {
          return { ok: false, reason: "create-failed" };
        }
      }

      // 立即追加用户消息
      const userContent = buildUserContent(text, attachments);
      const userMsg: Message = {
        id: clientMessageId ?? genId("user"),
        role: "user",
        content: text,
        userContent,
        timestamp: Date.now(),
        items: [],
      };

      const currentSession = get().sessions.find((s) => s.id === sessionId);
      const newTitle =
        currentSession && isDefaultSessionTitle(currentSession.title)
          ? text.slice(0, 40) ||
            (attachments.length ? "Image message" : currentSession.title)
          : undefined;

      set((state) => ({
        isStreaming: true,
        streamingSessionIds: {
          ...state.streamingSessionIds,
          [sessionId]: true,
        },
        allSessions: patchSessionMeta(state.allSessions, sessionId, {
          updatedAt: Date.now(),
          ...(newTitle ? { title: newTitle } : {}),
        }),
        sessions: state.sessions.map((s) =>
          s.id === sessionId
            ? {
                ...s,
                title: isDefaultSessionTitle(s.title)
                  ? text.slice(0, 40) ||
                    (attachments.length ? "Image message" : s.title)
                  : s.title,
                updatedAt: Date.now(),
                messages: [
                  ...s.messages,
                  {
                    id: userMsg.id,
                    role: "user",
                    content: userMsg.content,
                    userContent,
                    blocks: userMsg.content
                      ? [
                          {
                            id: `${userMsg.id}-text`,
                            type: "text" as const,
                            text: userMsg.content,
                          },
                        ]
                      : [],
                    createdAt: userMsg.timestamp,
                    items: [],
                  },
                ],
              }
            : s,
        ),
      }));

      try {
        trackMessageSend({
          conversationId: sessionId,
          textLength: text.length,
        });
        const receipt =
          prestartedReceipt ??
          (await window.marloues.chat.send({
            sessionId,
            text,
            attachments: userContent,
            clientMessageId: userMsg.id,
            deliveryMode: "normal",
            workMode: options?.workMode,
            permissionMode: options?.permissionMode,
          }));
        if (receipt.status === "failed" || !receipt.turnId) {
          throw new Error(receipt.error || "Message delivery was rejected");
        }
        const requestId = receipt.turnId;
        // 若用户在 send resolve 前（pending 阶段）已点停止：不要重新标记 streaming，
        // 否则会话会被"复活"成 streaming。改为用刚拿到的真实 turnId 补发 abort。
        if (consumePendingAbort(sessionId!)) {
          markTurnAborted(requestId);
          try {
            await window.marloues.chat.abort(requestId);
          } catch {
            // ignore
          }
          set((state) => {
            const streamingSessionIds = { ...state.streamingSessionIds };
            delete streamingSessionIds[sessionId!];
            return {
              isStreaming: hasStreamingSessions(streamingSessionIds),
              currentRequestId:
                state.currentRequestId === requestId
                  ? null
                  : state.currentRequestId,
              streamingSessionIds,
            };
          });
          return { ok: true };
        }
        set(() => ({ currentRequestId: requestId }));
      } catch {
        notify({
          title: STRINGS.chat.send.failedTitle,
          description: STRINGS.chat.send.failedDescription,
          tone: "error",
        });
        set((state) => {
          const streamingSessionIds = { ...state.streamingSessionIds };
          delete streamingSessionIds[sessionId!];
          return {
            isStreaming: hasStreamingSessions(streamingSessionIds),
            currentRequestId: null,
            streamingSessionIds,
          };
        });
        return { ok: false, reason: "send-failed" };
      }
      return { ok: true };
    },

    continueContextAction: async () => {
      const state = get();
      const request = state.contextActionRequest;
      const sessionId = request?.sessionId ?? state.activeSessionId;
      const session = state.sessions.find((item) => item.id === sessionId);
      const userMessage = [...(session?.messages ?? [])]
        .reverse()
        .find((message) => message.role === "user");
      if (
        !sessionId ||
        !userMessage ||
        Boolean(state.streamingSessionIds[sessionId])
      )
        return;

      set((current) => ({
        isStreaming: true,
        contextActionRequest: null,
        streamingSessionIds: {
          ...current.streamingSessionIds,
          [sessionId]: true,
        },
      }));

      try {
        const receipt = await window.marloues.chat.send({
          sessionId,
          text: userMessage.content,
          clientMessageId: userMessage.id,
          forceSend: true,
        });
        if (receipt.status === "failed" || !receipt.turnId) {
          throw new Error(receipt.error || "Message delivery was rejected");
        }
        const requestId = receipt.turnId;
        // 与 sendMessage 同：pending 阶段被停止则补发 abort，不重新标记 streaming。
        if (consumePendingAbort(sessionId)) {
          markTurnAborted(requestId);
          try {
            await window.marloues.chat.abort(requestId);
          } catch {
            // ignore
          }
          set((current) => {
            const streamingSessionIds = { ...current.streamingSessionIds };
            delete streamingSessionIds[sessionId];
            return {
              isStreaming: hasStreamingSessions(streamingSessionIds),
              currentRequestId:
                current.currentRequestId === requestId
                  ? null
                  : current.currentRequestId,
              streamingSessionIds,
            };
          });
          return;
        }
        set(() => ({ currentRequestId: requestId }));
      } catch {
        set((current) => {
          const streamingSessionIds = { ...current.streamingSessionIds };
          delete streamingSessionIds[sessionId];
          return {
            isStreaming: hasStreamingSessions(streamingSessionIds),
            currentRequestId: null,
            streamingSessionIds,
          };
        });
      }
    },

    clearContextActionRequest: () =>
      set((state) => {
        const request = state.contextActionRequest;
        if (!request) return { contextActionRequest: null };
        // If the session is still streaming, just clear the request.
        if (state.streamingSessionIds[request.sessionId]) {
          return { contextActionRequest: null };
        }
        const streamingSessionIds = { ...state.streamingSessionIds };
        delete streamingSessionIds[request.sessionId];
        return { contextActionRequest: null, streamingSessionIds };
      }),

    abort: async (sessionId) => {
      const state = get();
      const targetSessionId = sessionId ?? state.activeSessionId;
      const requestId = state.currentRequestId;

      if (targetSessionId) {
        if (requestId) {
          // 已知 turnId：登记为已中止，拦截晚到的同 turn 事件（turn.start 复活）。
          markTurnAborted(requestId);
        } else {
          // pending 阶段（turnId 未定，chat.send 尚未 resolve）：登记会话级标记，
          // 拦截 send resolve 后的 streaming 重新标记。
          markPendingAbort(targetSessionId);
        }
      }

      // 只在有真实 turnId 时调用 IPC abort。绝不用 sessionId 冒充 requestId——
      // 主进程 interruptTurn 按 turnId 匹配，传 sessionId 会静默失效。
      if (requestId) {
        try {
          await window.marloues.chat.abort(requestId);
        } catch {
          // ignore
        }
      }

      set((current) => {
        if (!targetSessionId)
          return { isStreaming: false, currentRequestId: null };
        const streamingSessionIds = { ...current.streamingSessionIds };
        delete streamingSessionIds[targetSessionId];
        const clearCurrent = current.currentRequestId === requestId;
        return {
          isStreaming: hasStreamingSessions(streamingSessionIds),
          streamingSessionIds,
          currentRequestId: clearCurrent ? null : current.currentRequestId,
        };
      });
    },

    compactSession: async (sessionId) => {
      const targetSessionId = sessionId ?? get().activeSessionId;
      if (!targetSessionId) {
        notify({
          title: STRINGS.chat.compact.cannotTitle,
          description: STRINGS.chat.compact.cannotDescription,
          tone: "warning",
        });
        return;
      }
      try {
        await window.marloues.chat.compact(targetSessionId);
      } catch (error) {
        notify({
          title: STRINGS.chat.compact.failedTitle,
          description: error instanceof Error ? error.message : String(error),
          tone: "error",
        });
      }
    },
  };
}
