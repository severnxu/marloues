/**
 * Steer slice — pending steer queue management.
 *
 * Marloues main process does not implement a durable steer/outbox backend yet:
 * the queue stays local to the renderer, "apply now" degrades to a normal
 * message send, and cancel/reorder/resume are purely local mutations.
 */

import { notify } from "@/lib/notifications";
import { STRINGS } from "@shared/strings.zh";
import type { UnifiedChatStore } from "./types";

type Set = (
  partial:
    | Partial<UnifiedChatStore>
    | ((state: UnifiedChatStore) => Partial<UnifiedChatStore>),
) => void;
type Get = () => UnifiedChatStore;

export function createSteerSlice(
  set: Set,
  get: Get,
): Partial<UnifiedChatStore> {
  return {
    pendingSteers: {},
    steerQueuePaused: {},
    turnSteerActivity: {},

    cancelPendingSteer: async (sessionId, messageId) => {
      set((state) => ({
        pendingSteers: {
          ...state.pendingSteers,
          [sessionId]: (state.pendingSteers[sessionId] ?? []).filter(
            (item) => item.id !== messageId,
          ),
        },
      }));
    },

    applyPendingSteerNow: async (sessionId, messageId) => {
      const item = get().pendingSteers[sessionId]?.find(
        (candidate) => candidate.id === messageId,
      );
      // Remove the queued steer first, then degrade to a normal send so the
      // user's text is never lost.
      set((state) => ({
        pendingSteers: {
          ...state.pendingSteers,
          [sessionId]: (state.pendingSteers[sessionId] ?? []).filter(
            (candidate) => candidate.id !== messageId,
          ),
        },
      }));
      if (!item) return;
      try {
        await get().sendMessage(item.text, item.attachments);
      } catch (error) {
        notify({
          title: STRINGS.chat.steer.applyFailedTitle,
          description: error instanceof Error ? error.message : String(error),
          tone: "error",
        });
      }
    },

    reorderSteers: async (sessionId, orderedIds) => {
      const current = get().pendingSteers[sessionId] ?? [];
      const rollback = () =>
        set((state) => {
          const originalIds = new Set(current.map((item) => item.id));
          const arrivedDuringRequest = (
            state.pendingSteers[sessionId] ?? []
          ).filter((item) => !originalIds.has(item.id));
          return {
            pendingSteers: {
              ...state.pendingSteers,
              [sessionId]: [...current, ...arrivedDuringRequest],
            },
          };
        });
      // Optimistic reorder; ids not present in orderedIds are appended to the
      // tail (protects steers that arrived during the drag).
      set((state) => {
        const visible = state.pendingSteers[sessionId] ?? [];
        const byId = new Map(visible.map((item) => [item.id, item]));
        const reordered = [];
        for (const id of orderedIds) {
          const item = byId.get(id);
          if (item) {
            reordered.push(item);
            byId.delete(id);
          }
        }
        for (const item of byId.values()) reordered.push(item);
        return {
          pendingSteers: { ...state.pendingSteers, [sessionId]: reordered },
        };
      });
      void rollback;
    },

    resumeSteerQueue: async (sessionId) => {
      set((state) => ({
        steerQueuePaused: {
          ...state.steerQueuePaused,
          [sessionId]: undefined,
        },
      }));
    },

    applyPendingState: () => {
      // No durable outbox on Marloues main process: nothing to recover.
    },
  };
}
