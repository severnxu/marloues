/**
 * Unified chat store — composition entry point.
 *
 * The store is split into 5 slices following the zustand slice pattern:
 *   - createSessionSlice     (session list, CRUD, inputText)
 *   - createSendSlice        (sendMessage, contextAction, abort, compact)
 *   - createSteerSlice       (pending steer queue, applyPendingState)
 *   - createEventHandlerSlice (handleEvent, handleItemEvent, execution)
 *   - createReadThreadSlice  (readThread cache, pagination, derived model)
 *
 * Types live in chat-slices/types.ts and helpers in chat-slices/helpers.ts.
 * This file re-exports them so that consumers can keep importing from
 * "@/stores/unified-chat-store" without any path changes.
 */

import { create } from "zustand";
import type { UnifiedChatStore } from "./chat-slices/types";
import { createSessionSlice } from "./chat-slices/session-slice";
import { createSendSlice } from "./chat-slices/send-slice";
import { createSteerSlice } from "./chat-slices/steer-slice";
import { createEventHandlerSlice } from "./chat-slices/event-handler-slice";
import { createReadThreadSlice } from "./chat-slices/readthread-slice";

export const useUnifiedChatStore = create<UnifiedChatStore>((...args) => {
  const slice = {
    ...createSessionSlice(args[0], args[1]),
    ...createSendSlice(args[0], args[1]),
    ...createSteerSlice(args[0], args[1]),
    ...createEventHandlerSlice(args[0], args[1]),
    ...createReadThreadSlice(args[0], args[1]),
  } as UnifiedChatStore;
  return slice;
});

// ─── Re-exports for backward compatibility ──────────────────────
//
// Consumers (workflow-message-builders, components, tests, etc.) import
// types and constants from "@/stores/unified-chat-store". These re-exports
// keep all 16+ consumers working without any import path changes.

export type {
  ItemEvent,
  ExecutionTaskRecord,
  ExecutionSubagentRecord,
  ExecutionSessionState,
  SessionInitInfo,
  PendingSteerPreview,
  PlanImplementationPrompt,
  SendMessageOptions,
  SendResult,
  UnifiedChatStore,
  ChatSendReceipt,
} from "./chat-slices/types";

export { READ_THREAD_CACHE_LIMIT } from "./chat-slices/helpers";
