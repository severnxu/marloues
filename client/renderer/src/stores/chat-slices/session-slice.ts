/**
 * Session slice — session list state, CRUD operations, and input text.
 *
 * Owns: sessions, activeSessionId, visibleSessionId, unreadCompletedSessionIds,
 *       allSessions, inputDrafts, inputText, isStreaming, currentRequestId,
 *       planImplementationPrompt
 */

import { notify } from "@/lib/notifications";
import { STRINGS } from "@shared/strings.zh";
import type { UnifiedChatStore } from "./types";
import {
  genId,
  hasStreamingSessions,
  localSessionRecord,
  patchSessionMeta,
  persistActiveSession,
  persistUnreadCompletedSessions,
  readPersistedActiveSession,
  readPersistedUnreadCompletedSessions,
  readThreadCacheRecency,
  touchReadThreadCache,
  updateUnreadCompletion,
} from "./helpers";
type Set = (
  partial:
    | Partial<UnifiedChatStore>
    | ((state: UnifiedChatStore) => Partial<UnifiedChatStore>),
) => void;
type Get = () => UnifiedChatStore;

export function createSessionSlice(
  set: Set,
  get: Get,
): Partial<UnifiedChatStore> {
  return {
    sessions: [],
    activeSessionId: null,
    visibleSessionId: null,
    unreadCompletedSessionIds: readPersistedUnreadCompletedSessions(),
    isStreaming: false,
    currentRequestId: null,
    streamingSessionIds: {},
    allSessions: [],
    inputDrafts: {},
    inputText: "",
    composerEpoch: 0,
    planImplementationPrompt: null,

    loadAllSessions: async () => {
      try {
        const allSessions = await window.marloues.chat.listAllSessions();
        set((state) => {
          const knownSessionIds = new Set(
            allSessions.map((session) => session.id),
          );
          const unreadCompletedSessionIds = new Set(
            [...state.unreadCompletedSessionIds].filter((id) =>
              knownSessionIds.has(id),
            ),
          );
          if (
            unreadCompletedSessionIds.size !==
            state.unreadCompletedSessionIds.size
          ) {
            persistUnreadCompletedSessions(unreadCompletedSessionIds);
          }
          return { allSessions, unreadCompletedSessionIds };
        });
      } catch {
        // ignore: tree stays on last-known snapshot
      }
    },

    load: async (options?: { preserveActiveSession?: boolean }) => {
      try {
        const sessions = await window.marloues.chat.listSessions();
        if (sessions.length === 0) {
          // 工作空间选中不等于立即开始会话；保持空会话状态，
          // 由用户首次发送消息时（sendMessage 兜底）再创建会话。
          set({
            sessions: [],
            activeSessionId: null,
            contextActionRequest: null,
          });
        } else {
          const persisted = readPersistedActiveSession();
          const current = get().activeSessionId;
          const restored =
            options?.preserveActiveSession &&
            current &&
            sessions.some((s) => s.id === current)
              ? current
              : persisted && sessions.some((s) => s.id === persisted)
                ? persisted
                : sessions[0].id;
          set({
            sessions,
            activeSessionId: restored,
          });
          // Skip re-fetching if the readThread is already cached — the IPC
          // push (onReadThread) keeps cached sessions in sync, so the cache
          // is authoritative for previously-loaded sessions.
          if (!get().readThreads[restored]) {
            void get().loadReadThread(restored);
          }
        }
      } catch {
        // If loading fails, create a local session.
        const id = genId("session");
        set({ sessions: [localSessionRecord(id)], activeSessionId: id });
        void get().loadReadThread(id);
      }
    },

    createSession: async () => {
      // 新建会话仅导航到空会话页面，不落库、不调 IPC；
      // 真正创建发生在用户首次发送消息时（见 sendMessage 兜底）。
      set((state) => ({
        activeSessionId: null,
        inputText: "",
        composerEpoch: state.composerEpoch + 1,
      }));
      persistActiveSession(null);
    },

    setActiveSession: (id) => {
      set((state) => ({
        activeSessionId: id,
        inputText: state.inputDrafts[id] ?? "",
      }));
      persistActiveSession(id);
      touchReadThreadCache(id);

      // Sessions created externally (e.g., by a scheduled task) may not be
      // in the current sessions list. Without the session in the list,
      // getActiveReadThreadModel() returns null and handleItemEvent silently
      // drops real-time events for this session. Fetch and inject it.
      if (!get().sessions.some((s) => s.id === id)) {
        void (async () => {
          try {
            // Try the current workspace's sessions first, then fall back to
            // the all-workspaces list (the session may belong to a different
            // workspace than the one currently active).
            let found = (await window.marloues.chat.listSessions()).find(
              (s) => s.id === id,
            );
            if (!found) {
              found = (await window.marloues.chat.listAllSessions()).find(
                (s) => s.id === id,
              );
            }
            if (found) {
              set((state) => ({
                sessions: state.sessions.some((s) => s.id === id)
                  ? state.sessions
                  : [found!, ...state.sessions],
              }));
            }
          } catch {
            // best-effort; readThread loading below will still attempt
          }
        })();
      }
    },

    setVisibleSession: (id) => {
      set((state) => ({
        visibleSessionId: id,
        unreadCompletedSessionIds: id
          ? updateUnreadCompletion(state.unreadCompletedSessionIds, id, false)
          : state.unreadCompletedSessionIds,
      }));
    },

    deleteSession: async (id) => {
      // 删除前先中止进行中的 turn，避免后台孤儿 turn 收尾时把已删会话写回库（复活竞态）。
      if (get().streamingSessionIds[id]) {
        await get().abort(id);
      }
      try {
        await window.marloues.chat.deleteSession(id);
      } catch (error) {
        notify({
          title: STRINGS.chat.session.deleteFailedTitle,
          description: error instanceof Error ? error.message : String(error),
          tone: "error",
        });
        throw error;
      }
      set((state) => {
        const sessions = state.sessions.filter((s) => s.id !== id);
        const activeSessionId =
          state.activeSessionId === id
            ? (sessions[0]?.id ?? null)
            : state.activeSessionId;
        const streamingSessionIds = { ...state.streamingSessionIds };
        delete streamingSessionIds[id];
        const readThreads = { ...state.readThreads };
        delete readThreads[id];
        readThreadCacheRecency.delete(id);
        const readThreadPaging = { ...state.readThreadPaging };
        delete readThreadPaging[id];
        const inputDrafts = { ...state.inputDrafts };
        delete inputDrafts[id];
        const executionBySession = { ...state.executionBySession };
        delete executionBySession[id];
        const unreadCompletedSessionIds = updateUnreadCompletion(
          state.unreadCompletedSessionIds,
          id,
          false,
        );
        return {
          sessions,
          allSessions: state.allSessions.filter((s) => s.id !== id),
          activeSessionId,
          inputText: activeSessionId
            ? (inputDrafts[activeSessionId] ?? "")
            : "",
          streamingSessionIds,
          readThreads,
          readThreadPaging,
          inputDrafts,
          executionBySession,
          unreadCompletedSessionIds,
          isStreaming: hasStreamingSessions(streamingSessionIds),
          currentRequestId: state.currentRequestId,
        };
      });
    },

    updateSessionTitle: async (id, title) => {
      await window.marloues.chat.updateSessionTitle(id, title);
      const updatedAt = Date.now();
      set((state) => ({
        sessions: patchSessionMeta(state.sessions, id, { title, updatedAt }),
        allSessions: patchSessionMeta(state.allSessions, id, {
          title,
          updatedAt,
        }),
      }));
    },

    toggleSessionPinned: async (id) => {
      await window.marloues.chat.toggleSessionPinned(id);
      const updatedAt = Date.now();
      set((state) => {
        const current = state.sessions.find((s) => s.id === id);
        const isPinned = current ? !current.isPinned : false;
        return {
          sessions: patchSessionMeta(state.sessions, id, {
            isPinned,
            updatedAt,
          }),
          allSessions: patchSessionMeta(state.allSessions, id, {
            isPinned,
            updatedAt,
          }),
        };
      });
    },

    forkSession: async (id, lastTurnId) => {
      const fork = await window.marloues.chat.forkSession({
        sessionId: id,
        lastTurnId,
      });
      set((state) => ({
        sessions: [fork, ...state.sessions],
        allSessions: [fork, ...state.allSessions],
        activeSessionId: fork.id,
        inputText: state.inputDrafts[fork.id] ?? "",
      }));
      return fork;
    },

    setInputText: (text) =>
      set((state) => {
        const sessionId = state.activeSessionId;
        if (!sessionId) return { inputText: text };
        return {
          inputText: text,
          inputDrafts: {
            ...state.inputDrafts,
            [sessionId]: text,
          },
        };
      }),

    dismissPlanImplementationPrompt: () =>
      set({ planImplementationPrompt: null }),
  };
}
