/**
 * Unified chat store — shared module-level helpers.
 *
 * Pure functions and constants extracted from the original store file.
 * Slice creators and event handlers import from here.
 */

import type { ChatSessionRecord } from "@shared/types";
import type {
  WorkflowReadThreadResponse,
  WorkflowTurnItem,
} from "@shared/workflow-read-thread-contract";
import type { UserMessageContent } from "../../types";
import type { UnifiedChatStore } from "./types";
import { restoreExecutionStateFromReadThread } from "../workflow-message-builders";

export function genId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function isDefaultSessionTitle(title: string): boolean {
  return title === "New chat" || title === "Untitled";
}

export function assistantTextFromItems(items: WorkflowTurnItem[]): string {
  return items
    .filter((item) => item.type === "agentMessage")
    .map((item) => item.text ?? "")
    .join("");
}

export function buildUserContent(
  text: string,
  attachments: UserMessageContent[],
): UserMessageContent[] {
  const content: UserMessageContent[] = [];
  if (text) content.push({ type: "text", text });
  for (const attachment of attachments) {
    if (
      attachment.type === "image" ||
      attachment.type === "localImage" ||
      attachment.type === "file" ||
      attachment.type === "url" ||
      attachment.type === "skill" ||
      attachment.type === "mention" ||
      attachment.type === "browserComment"
    ) {
      content.push(attachment);
    }
  }
  return content;
}

export function localSessionRecord(id: string): ChatSessionRecord {
  const now = Date.now();
  return {
    id,
    title: "New chat",
    createdAt: now,
    updatedAt: now,
    isPinned: false,
    messages: [],
  };
}

/**
 * 清理属于指定 turn 的排队 steer（按 turnId 过滤，非整表删）。
 * 仅清 turnId 精确匹配该 turn 的 steer：
 * - turnId 为 null（刚插入、IPC 未回）的 steer 由 IPC 失败回滚负责，不在此误清；
 * - turnId 不匹配（属于新 turn）的 steer 保留。
 * 同时清掉对应的 turnSteerActivity 标记。
 */
export function clearSteersForTurn(
  state: UnifiedChatStore,
  sessionId: string,
  turnId: string,
): Pick<UnifiedChatStore, "pendingSteers" | "turnSteerActivity"> {
  const current = state.pendingSteers[sessionId] ?? [];
  const remaining = current.filter((item) => item.turnId !== turnId);
  const pendingSteers = { ...state.pendingSteers };
  if (remaining.length === 0) delete pendingSteers[sessionId];
  else pendingSteers[sessionId] = remaining;
  const turnSteerActivity = { ...state.turnSteerActivity };
  delete turnSteerActivity[`${sessionId}:${turnId}`];
  return { pendingSteers, turnSteerActivity };
}

export function patchSessionMeta(
  list: ChatSessionRecord[],
  id: string,
  patch: Partial<Pick<ChatSessionRecord, "title" | "isPinned" | "updatedAt">>,
): ChatSessionRecord[] {
  let changed = false;
  const next = list.map((session) => {
    if (session.id !== id) return session;
    const entries = Object.entries(patch) as Array<
      [keyof typeof patch, (typeof patch)[keyof typeof patch]]
    >;
    if (entries.every(([key, value]) => session[key] === value)) return session;
    changed = true;
    return { ...session, ...patch };
  });
  return changed ? next : list;
}

export function hasStreamingSessions(
  ids: Record<string, true | undefined>,
): boolean {
  return Object.values(ids).some(Boolean);
}

export const READ_THREAD_CACHE_LIMIT = 12;

export const readThreadCacheRecency = new Map<string, number>();
let readThreadCacheClock = 0;

export function touchReadThreadCache(sessionId: string): void {
  readThreadCacheRecency.set(sessionId, ++readThreadCacheClock);
}

export function pruneReadThreadCache(
  state: UnifiedChatStore,
  readThreads: Record<string, WorkflowReadThreadResponse | undefined>,
  executionBySession: UnifiedChatStore["executionBySession"],
): Pick<
  UnifiedChatStore,
  "readThreads" | "readThreadPaging" | "executionBySession"
> {
  const cachedIds = Object.keys(readThreads).filter(
    (sessionId) => readThreads[sessionId] !== undefined,
  );
  if (cachedIds.length <= READ_THREAD_CACHE_LIMIT) {
    return {
      readThreads,
      readThreadPaging: state.readThreadPaging,
      executionBySession,
    };
  }

  const protectedIds = new Set<string>();
  if (state.activeSessionId) protectedIds.add(state.activeSessionId);
  for (const sessionId of Object.keys(state.streamingSessionIds)) {
    if (state.streamingSessionIds[sessionId]) protectedIds.add(sessionId);
  }

  const evictableIds = cachedIds
    .filter((sessionId) => !protectedIds.has(sessionId))
    .sort(
      (left, right) =>
        (readThreadCacheRecency.get(left) ?? 0) -
        (readThreadCacheRecency.get(right) ?? 0),
    );
  const evictedIds = evictableIds.slice(
    0,
    Math.max(0, cachedIds.length - READ_THREAD_CACHE_LIMIT),
  );
  if (evictedIds.length === 0) {
    return {
      readThreads,
      readThreadPaging: state.readThreadPaging,
      executionBySession,
    };
  }

  const boundedReadThreads = { ...readThreads };
  const boundedPaging = { ...state.readThreadPaging };
  const boundedExecution = { ...executionBySession };
  for (const sessionId of evictedIds) {
    delete boundedReadThreads[sessionId];
    delete boundedPaging[sessionId];
    delete boundedExecution[sessionId];
    readThreadCacheRecency.delete(sessionId);
  }
  return {
    readThreads: boundedReadThreads,
    readThreadPaging: boundedPaging,
    executionBySession: boundedExecution,
  };
}

export function reconcileReadThreadSnapshot(
  state: UnifiedChatStore,
  snapshot: WorkflowReadThreadResponse,
): Partial<UnifiedChatStore> {
  const threadId = snapshot.thread.id;
  touchReadThreadCache(threadId);
  const readThreads = { ...state.readThreads, [threadId]: snapshot };
  const executionBySession = restoreExecutionStateFromReadThread(
    state.executionBySession,
    snapshot,
  );
  // Streaming flags (streamingSessionIds, isStreaming, currentRequestId) are
  // managed exclusively by turn.start/turn.complete event handlers. The
  // readThread snapshot only provides render data; it does not reconcile
  // streaming state. This avoids clearing streaming flags mid-turn when a
  // throttled snapshot arrives before turn.complete.
  return pruneReadThreadCache(state, readThreads, executionBySession);
}

// --- localStorage persistence ---

const ACTIVE_SESSION_KEY = "marloues.activeSessionId";
const UNREAD_COMPLETED_SESSIONS_KEY = "marloues.unreadCompletedSessionIds";

export function readPersistedActiveSession(): string | null {
  try {
    return localStorage.getItem(ACTIVE_SESSION_KEY);
  } catch {
    return null;
  }
}

export function persistActiveSession(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_SESSION_KEY, id);
    else localStorage.removeItem(ACTIVE_SESSION_KEY);
  } catch {
    // ignore storage errors (private mode etc.)
  }
}

export function readPersistedUnreadCompletedSessions(): Set<string> {
  try {
    const value = localStorage.getItem(UNREAD_COMPLETED_SESSIONS_KEY);
    if (!value) return new Set();
    const sessionIds: unknown = JSON.parse(value);
    return Array.isArray(sessionIds)
      ? new Set(sessionIds.filter((id): id is string => typeof id === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

export function persistUnreadCompletedSessions(
  sessionIds: ReadonlySet<string>,
): void {
  try {
    if (sessionIds.size > 0) {
      localStorage.setItem(
        UNREAD_COMPLETED_SESSIONS_KEY,
        JSON.stringify([...sessionIds]),
      );
    } else {
      localStorage.removeItem(UNREAD_COMPLETED_SESSIONS_KEY);
    }
  } catch {
    // ignore storage errors (private mode etc.)
  }
}

export function updateUnreadCompletion(
  current: ReadonlySet<string>,
  sessionId: string,
  unread: boolean,
): Set<string> {
  if (current.has(sessionId) === unread) return current as Set<string>;
  const next = new Set(current);
  if (unread) next.add(sessionId);
  else next.delete(sessionId);
  persistUnreadCompletedSessions(next);
  return next;
}

// --- Message item helpers ---

function mergeItem(
  items: WorkflowTurnItem[],
  newItem: WorkflowTurnItem,
): WorkflowTurnItem[] {
  const idx = items.findIndex((i) => i.id === newItem.id);
  if (idx < 0) return [...items, newItem];
  const prev = items[idx];
  if (prev.type !== newItem.type) return [...items, newItem];
  const next = [...items];
  // 主进程 builder 每次 ingest 后 emit 当前累积快照（text 等已含全部增量），
  // 同 id 同 type 直接以新值覆盖即可，无需逐字段保护。
  next[idx] = { ...prev, ...newItem } as WorkflowTurnItem;
  return next;
}

export function mergeItems(
  items: WorkflowTurnItem[],
  updates: WorkflowTurnItem[],
): WorkflowTurnItem[] {
  if (updates.length === 1) return mergeItem(items, updates[0]);
  const indexes = new Map(items.map((item, index) => [item.id, index]));
  const next = [...items];
  for (const update of updates) {
    const index = indexes.get(update.id);
    if (index === undefined) {
      indexes.set(update.id, next.length);
      next.push(update);
      continue;
    }
    next[index] = mergeItem([next[index]], update)[0];
  }
  return next;
}

const LIVE_MESSAGE_ITEM_WINDOW = 512;
const LIVE_MESSAGE_STICKY_WINDOW = 64;

/**
 * The main process owns the complete canonical turn and reloads it after the
 * turn finishes. Keep only a bounded renderer-side working set while the turn
 * is live, otherwise every immutable item update copies and re-adapts an
 * ever-growing array and eventually starves all window interactions.
 */
export function boundLiveMessageItems(
  items: WorkflowTurnItem[],
): WorkflowTurnItem[] {
  if (items.length <= LIVE_MESSAGE_ITEM_WINDOW + LIVE_MESSAGE_STICKY_WINDOW) {
    return items;
  }

  const recent = items.slice(-LIVE_MESSAGE_ITEM_WINDOW);
  const recentIds = new Set(recent.map((item) => item.id));
  const sticky = items
    .slice(0, -LIVE_MESSAGE_ITEM_WINDOW)
    .filter(
      (item) =>
        !recentIds.has(item.id) &&
        (item.type === "agentMessage" ||
          item.type === "fileChange" ||
          item.type === "plan" ||
          item.type === "permissionRequest" ||
          ("status" in item &&
            (item.status === "running" || item.status === "pending"))),
    )
    .slice(-LIVE_MESSAGE_STICKY_WINDOW);
  return [...sticky, ...recent];
}
