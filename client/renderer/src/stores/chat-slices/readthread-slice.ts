/**
 * Read thread slice — read thread cache, pagination, and derived model.
 *
 * Owns: readThreads, readThreadPaging
 *
 * loadReadThread: initial load (full replace)
 * loadMoreReadThread: upward pagination (prepend older turns)
 * handleReadThread: IPC push handler (reconcile snapshot)
 * getActiveReadThreadModel: derived — returns the active session's read thread,
 *   falling back to the legacy workflowMessages adapter if no cached readThread.
 */

import type { WorkflowReadThreadResponse } from "@shared/workflow-read-thread-contract";
import { workflowMessagesToWorkflowReadThreadResponse } from "@shared/adapters/workflow-messages-to-read-thread";
import { activeWorkflowMessages } from "../workflow-message-builders";
import type { UnifiedChatStore } from "./types";
import { reconcileReadThreadSnapshot } from "./helpers";

type Set = (
  partial:
    | Partial<UnifiedChatStore>
    | ((state: UnifiedChatStore) => Partial<UnifiedChatStore>),
) => void;
type Get = () => UnifiedChatStore;

export function createReadThreadSlice(
  set: Set,
  get: Get,
): Partial<UnifiedChatStore> {
  return {
    readThreads: {},
    readThreadPaging: {},

    loadReadThread: async (sessionId) => {
      set((state) => {
        const current = state.readThreadPaging[sessionId];
        return {
          readThreadPaging: {
            ...state.readThreadPaging,
            [sessionId]: {
              cursor: current?.cursor ?? null,
              hasMore: current?.hasMore ?? false,
              loading: true,
              loadingMore: current?.loadingMore ?? false,
            },
          },
        };
      });
      try {
        const snapshot = await window.marloues.chat.readThread(sessionId);
        if (!snapshot) {
          set((state) => {
            const current = state.readThreadPaging[sessionId];
            return {
              readThreadPaging: {
                ...state.readThreadPaging,
                [sessionId]: {
                  cursor: current?.cursor ?? null,
                  hasMore: current?.hasMore ?? false,
                  loading: false,
                  loadingMore: false,
                },
              },
            };
          });
          return;
        }
        set((state) => reconcileReadThreadSnapshot(state, snapshot));
        set((state) => ({
          readThreadPaging: {
            ...state.readThreadPaging,
            [sessionId]: {
              cursor: snapshot.page.nextCursor,
              hasMore: snapshot.page.hasMore,
              loading: false,
              loadingMore: false,
            },
          },
        }));
      } catch (error) {
        console.error("[loadReadThread] Failed for session:", sessionId, error);
        set((state) => {
          const current = state.readThreadPaging[sessionId];
          return {
            readThreadPaging: {
              ...state.readThreadPaging,
              [sessionId]: {
                cursor: current?.cursor ?? null,
                hasMore: current?.hasMore ?? false,
                loading: false,
                loadingMore: false,
              },
            },
          };
        });
        // Canonical readThread is optional; legacy workflowMessages remains the fallback.
      }
    },

    loadMoreReadThread: async (sessionId) => {
      const paging = get().readThreadPaging[sessionId];
      if (!paging || paging.loadingMore || !paging.hasMore) return;

      set((state) => ({
        readThreadPaging: {
          ...state.readThreadPaging,
          [sessionId]: { ...paging, loadingMore: true },
        },
      }));

      try {
        // Marloues main process serves the full newest-first snapshot per
        // session; upward pagination is not supported yet, so reload the
        // canonical snapshot for this session.
        const snapshot = await window.marloues.chat.readThread(sessionId);
        if (!snapshot) {
          set((state) => ({
            readThreadPaging: {
              ...state.readThreadPaging,
              [sessionId]: {
                ...paging,
                loading: false,
                loadingMore: false,
                hasMore: false,
              },
            },
          }));
          return;
        }

        const existing = get().readThreads[sessionId];
        const existingTurns = existing?.turns ?? [];
        const existingIds = new Set(existingTurns.map((t) => t.id));
        const mergedTurns = [...existingTurns];
        for (const turn of snapshot.turns) {
          if (!existingIds.has(turn.id)) {
            // newest_first ordering: older pages prepend before current ones
            mergedTurns.unshift(turn);
          }
        }

        const merged: WorkflowReadThreadResponse = {
          ...snapshot,
          turns: mergedTurns,
          page: snapshot.page,
        };

        set((state) => reconcileReadThreadSnapshot(state, merged));
        set((state) => ({
          readThreadPaging: {
            ...state.readThreadPaging,
            [sessionId]: {
              cursor: snapshot.page.nextCursor,
              hasMore: snapshot.page.hasMore,
              loading: false,
              loadingMore: false,
            },
          },
        }));
      } catch (error) {
        console.error(
          "[loadMoreReadThread] Failed for session:",
          sessionId,
          error,
        );
        set((state) => ({
          readThreadPaging: {
            ...state.readThreadPaging,
            [sessionId]: { ...paging, loadingMore: false },
          },
        }));
      }
    },

    handleReadThread: (snapshot) => {
      if (!snapshot) return;
      set((state) => reconcileReadThreadSnapshot(state, snapshot));
    },

    getActiveReadThreadModel: () => {
      const state = get();
      const activeSessionId = state.activeSessionId;

      if (!activeSessionId) return null;

      const readThread = state.readThreads[activeSessionId];
      const activeSessionIsStreaming = Boolean(
        state.streamingSessionIds[activeSessionId],
      );

      // Completed/cached sessions already have the exact model the UI needs.
      // Return it before constructing the legacy fallback: that construction
      // walks and converts the entire conversation and used to block every
      // session switch even though its result was immediately discarded.
      if (readThread && !activeSessionIsStreaming) {
        return readThread;
      }

      if (readThread?.turns.some((turn) => turn.status === "running")) {
        return readThread;
      }

      // Sessions created externally (e.g., by a scheduled task) may not yet
      // be in the sessions array when the user opens them. The readThread
      // may already be cached from the main-process push broadcast; return
      // it instead of null so the UI shows content immediately.
      const session = state.sessions.find((s) => s.id === activeSessionId);
      if (!session) return readThread ?? null;

      const workflowMessages = activeWorkflowMessages(state, session);
      if (!workflowMessages.length) return readThread ?? null;
      return workflowMessagesToWorkflowReadThreadResponse(workflowMessages, {
        threadId: session.id,
        title: session.title,
        preview: session.messages.at(-1)?.content ?? session.title,
        cwd: session.workspacePath ?? null,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      });
    },
  };
}
