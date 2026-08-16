/**
 * Steer slice — pending steer queue management.
 *
 * Owns: pendingSteers, steerQueuePaused, turnSteerActivity
 */

import { notify } from "@/lib/notifications";
import { STRINGS } from "@shared/strings.zh";
import type { PendingSteerPreview, UnifiedChatStore } from "./types";

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
      try {
        const receipt = await window.marloues.chat.cancelSteer(
          sessionId,
          messageId,
        );
        if (receipt.status === "applying" || receipt.status === "failed") {
          if (receipt.status === "failed") {
            notify({
              title: STRINGS.chat.steer.cancelFailedTitle,
              description: receipt.error || STRINGS.chat.steer.cancelFailedQueue,
              tone: "warning",
            });
          }
          return;
        }
      } catch (error) {
        notify({
          title: STRINGS.chat.steer.cancelFailedTitle,
          description: error instanceof Error ? error.message : String(error),
          tone: "warning",
        });
        return;
      }
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
      set((state) => ({
        pendingSteers: {
          ...state.pendingSteers,
          [sessionId]: (state.pendingSteers[sessionId] ?? []).map((item) =>
            item.id === messageId ? { ...item, status: "applying" } : item,
          ),
        },
      }));
      try {
        const receipt = await window.marloues.chat.applySteerNow(
          sessionId,
          messageId,
        );
        if (
          receipt.status === "applied" ||
          receipt.status === "already_dispatched"
        ) {
          set((state) => ({
            pendingSteers: {
              ...state.pendingSteers,
              [sessionId]: (state.pendingSteers[sessionId] ?? []).filter(
                (item) => item.id !== messageId,
              ),
            },
          }));
          return;
        }
        if (receipt.status === "applying") return;
        if (receipt.status === "canceled") {
          set((state) => ({
            pendingSteers: {
              ...state.pendingSteers,
              [sessionId]: (state.pendingSteers[sessionId] ?? []).filter(
                (item) => item.id !== messageId,
              ),
            },
          }));
          return;
        }
        if (receipt.status === "boundary_closed") {
          const resumed = await window.marloues.chat.resumeOutbox(
            sessionId,
            messageId,
          );
          if (resumed.status === "failed") {
            set((state) => ({
              pendingSteers: {
                ...state.pendingSteers,
                [sessionId]: (state.pendingSteers[sessionId] ?? []).map(
                  (item) =>
                    item.id === messageId
                      ? { ...item, status: "queued" }
                      : item,
                ),
              },
              steerQueuePaused: {
                ...state.steerQueuePaused,
                [sessionId]: true,
              },
            }));
          }
          return;
        }
        const stillPending = get().pendingSteers[sessionId]?.some(
          (item) => item.id === messageId,
        );
        if (stillPending) {
          notify({
            title: STRINGS.chat.steer.cannotApplyTitle,
            description: STRINGS.chat.steer.cannotApplyDescription,
            tone: "warning",
          });
        }
      } catch (error) {
        notify({
          title: STRINGS.chat.steer.applyFailedTitle,
          description: error instanceof Error ? error.message : String(error),
          tone: "error",
        });
      }
      set((state) => ({
        pendingSteers: {
          ...state.pendingSteers,
          [sessionId]: (state.pendingSteers[sessionId] ?? []).map((item) =>
            item.id === messageId ? { ...item, status: "queued" } : item,
          ),
        },
      }));
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
      set((state) => {
        const visible = state.pendingSteers[sessionId] ?? [];
        const byId = new Map(visible.map((item) => [item.id, item]));
        const reordered: PendingSteerPreview[] = [];
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
      try {
        const receipt = await window.marloues.chat.reorderSteers(
          sessionId,
          orderedIds,
        );
        if (receipt.status !== "reordered") {
          rollback();
        }
      } catch {
        rollback();
      }
    },

    resumeSteerQueue: async (sessionId) => {
      try {
        const receipt = await window.marloues.chat.resumeOutbox(sessionId);
        if (receipt.status === "failed") {
          notify({
            title: STRINGS.chat.steer.resumeFailedTitle,
            description: receipt.error ?? STRINGS.chat.steer.resumeFailedQueue,
            tone: "error",
          });
        }
      } catch (error) {
        notify({
          title: STRINGS.chat.steer.resumeFailedTitle,
          description: error instanceof Error ? error.message : String(error),
          tone: "error",
        });
      }
    },

    applyPendingState: (snapshot) => {
      const pendingSteers: UnifiedChatStore["pendingSteers"] = {};
      const steerQueuePaused: UnifiedChatStore["steerQueuePaused"] = {};
      for (const outbox of snapshot.outboxes) {
        if (outbox.items.length === 0) continue;
        pendingSteers[outbox.sessionId] = outbox.items.map((item) => ({
          id: item.messageId,
          sessionId: item.sessionId,
          turnId: item.turnId ?? null,
          text: item.displayContent,
          createdAt: item.createdAt,
          status: item.state === "applying" ? "applying" : "queued",
          attachments: item.userContent?.filter((c) => c.type !== "text"),
        }));
        steerQueuePaused[outbox.sessionId] = outbox.paused || undefined;
      }
      set({ pendingSteers, steerQueuePaused });
    },
  };
}
