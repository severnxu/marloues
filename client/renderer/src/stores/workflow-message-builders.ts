/**
 * unified-chat-store 的工作流消息构建 / 执行状态跟踪纯函数（2026-08-01 从 unified-chat-store.ts 拆分）。
 * 不持有模块级状态；类型经 import type 引用 store，避免运行时循环依赖。
 */
import {
  buildWorkflowMessages,
  type WorkflowMessageBlock,
} from "../components/workflow-chat/adapter/workflow-consumption-model";
import type { ChatSessionRecord, TimelineItem } from "@shared/types";
import type { UIEvent } from "@shared/ui-protocol";
import type { WorkflowReadThreadResponse } from "@shared/workflow-read-thread-contract";
import type { Message } from "../types";
import type {
  ExecutionTaskRecord,
  ExecutionSubagentRecord,
  ExecutionSessionState,
  UnifiedChatStore,
} from "./unified-chat-store";

export function toWorkflowMessage(
  message: ChatSessionRecord["messages"][number],
): Message {
  return {
    id: message.id,
    role: message.role === "system" ? "assistant" : message.role,
    content: message.content,
    timestamp: message.createdAt,
    status: message.isError ? "failed" : "completed",
    startedAt: message.startedAt ?? message.createdAt,
    completedAt: message.completedAt,
    modelId: message.modelId,
    modelName: message.modelName,
    usage: message.usage,
    items: message.items,
    userContent: message.userContent,
  };
}

export function activeWorkflowMessages(
  state: UnifiedChatStore,
  session: ChatSessionRecord,
): WorkflowMessageBlock[] {
  const activeSessionId = state.activeSessionId;
  const isStreaming = activeSessionId
    ? Boolean(state.streamingSessionIds[activeSessionId])
    : false;
  let liveStart = -1;
  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    if (session.messages[index].role === "user") {
      liveStart = index;
      break;
    }
  }
  if (liveStart < 0) liveStart = Math.max(0, session.messages.length - 1);
  const historyRecords = session.messages.slice(0, liveStart);
  const cachedHistory = workflowHistoryCache.get(session.id);
  const historyUnchanged =
    cachedHistory?.records.length === historyRecords.length &&
    historyRecords.every(
      (record, index) => cachedHistory.records[index] === record,
    );
  const history = historyUnchanged
    ? cachedHistory.blocks
    : buildWorkflowMessages(historyRecords.map(toWorkflowMessage), false);
  if (historyUnchanged && cachedHistory) {
    workflowHistoryCache.delete(session.id);
    workflowHistoryCache.set(session.id, cachedHistory);
  } else {
    setWorkflowHistoryCache(session.id, {
      records: historyRecords,
      blocks: history,
    });
  }
  const live = buildWorkflowMessages(
    session.messages.slice(liveStart).map(toWorkflowMessage),
    isStreaming,
  );
  return [...history, ...live];
}

const workflowHistoryCache = new Map<
  string,
  {
    records: ChatSessionRecord["messages"];
    blocks: WorkflowMessageBlock[];
  }
>();

export const WORKFLOW_HISTORY_CACHE_LIMIT = 12;

function setWorkflowHistoryCache(
  sessionId: string,
  value: {
    records: ChatSessionRecord["messages"];
    blocks: WorkflowMessageBlock[];
  },
): void {
  workflowHistoryCache.delete(sessionId);
  workflowHistoryCache.set(sessionId, value);
  while (workflowHistoryCache.size > WORKFLOW_HISTORY_CACHE_LIMIT) {
    const oldestSessionId = workflowHistoryCache.keys().next().value;
    if (oldestSessionId === undefined) break;
    workflowHistoryCache.delete(oldestSessionId);
  }
}

export function getWorkflowHistoryCacheSize(): number {
  return workflowHistoryCache.size;
}

export function clearWorkflowHistoryCache(): void {
  workflowHistoryCache.clear();
}

export function ensureExecutionSession(
  state: Record<string, ExecutionSessionState | undefined>,
  sessionId: string,
): ExecutionSessionState {
  return (
    state[sessionId] ?? {
      tasks: {},
      subagents: {},
    }
  );
}

export function restoreExecutionStateFromReadThread(
  state: Record<string, ExecutionSessionState | undefined>,
  snapshot: WorkflowReadThreadResponse,
): Record<string, ExecutionSessionState | undefined> {
  const events = (snapshot.execution?.events ?? [])
    .filter(
      (entry): entry is { timestamp: number; event: UIEvent } =>
        typeof entry.timestamp === "number" &&
        isExecutionRestoreEvent(entry.event),
    )
    .sort((a, b) => a.timestamp - b.timestamp);

  if (!events.length) return state;

  let next = state;
  for (const { event } of events) {
    if (event.type === "execution.task.update") {
      next = upsertExecutionTask(next, event);
    } else if (event.type === "execution.subagent.start") {
      next = upsertExecutionSubagentStart(next, event);
    } else if (event.type === "execution.subagent.event") {
      next = appendExecutionSubagentEvent(next, event);
    } else if (event.type === "execution.subagent.complete") {
      next = completeExecutionSubagent(next, event);
    }
  }
  return next;
}

export function isExecutionRestoreEvent(value: unknown): value is UIEvent {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return (
    type === "execution.task.update" ||
    type === "execution.subagent.start" ||
    type === "execution.subagent.event" ||
    type === "execution.subagent.complete"
  );
}

export function nextExecutionOrdinal(
  records: Record<string, { ordinal: number }>,
): number {
  return (
    Object.values(records).reduce(
      (max, record) => Math.max(max, record.ordinal),
      0,
    ) + 1
  );
}

export function upsertExecutionTask(
  state: Record<string, ExecutionSessionState | undefined>,
  event: Extract<UIEvent, { type: "execution.task.update" }>,
): Record<string, ExecutionSessionState | undefined> {
  const current = ensureExecutionSession(state, event.sessionId);
  const existing = current.tasks[event.taskId];
  const now = event.timestamp;
  const task: ExecutionTaskRecord = {
    id: event.taskId,
    turnId: event.turnId ?? existing?.turnId,
    ordinal:
      event.ordinal ?? existing?.ordinal ?? nextExecutionOrdinal(current.tasks),
    // The task definition is authored when the task is created. Runtime
    // progress events may carry transient summaries (for example "Reading …"
    // or "Last tool: Read"), but those belong to the execution trace rather
    // than this status-only task list.
    title: existing?.title ?? event.title,
    detail: existing?.detail ?? event.detail,
    agentType: event.agentType ?? existing?.agentType,
    prompt: event.prompt ?? existing?.prompt,
    taskType: event.taskType ?? existing?.taskType,
    blockedBy: event.blockedBy ?? existing?.blockedBy,
    status: event.status,
    parentToolId: event.parentToolId ?? existing?.parentToolId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  return {
    ...state,
    [event.sessionId]: {
      ...current,
      tasks: { ...current.tasks, [event.taskId]: task },
    },
  };
}

export function upsertExecutionSubagentStart(
  state: Record<string, ExecutionSessionState | undefined>,
  event: Extract<UIEvent, { type: "execution.subagent.start" }>,
): Record<string, ExecutionSessionState | undefined> {
  const current = ensureExecutionSession(state, event.sessionId);
  const existing = current.subagents[event.subagentId];
  const now = event.timestamp;
  const subagent: ExecutionSubagentRecord = {
    id: event.subagentId,
    parentToolId: event.parentToolId,
    taskId: event.taskId ?? existing?.taskId,
    ordinal:
      event.ordinal ??
      existing?.ordinal ??
      nextExecutionOrdinal(current.subagents),
    agentType: event.agentType ?? existing?.agentType,
    agentName: event.agentName ?? existing?.agentName,
    description: event.description ?? existing?.description,
    prompt: event.prompt ?? existing?.prompt,
    title: event.title ?? existing?.title,
    iconSeed: existing?.iconSeed ?? event.subagentId,
    status: event.status,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    completedAt: existing?.completedAt,
    events: existing?.events ?? [],
    timeline: existing?.timeline ?? [],
    text: existing?.text ?? "",
  };
  return {
    ...state,
    [event.sessionId]: {
      ...current,
      selectedSubagentId: current.selectedSubagentId ?? event.subagentId,
      subagents: { ...current.subagents, [event.subagentId]: subagent },
    },
  };
}

export function appendExecutionSubagentEvent(
  state: Record<string, ExecutionSessionState | undefined>,
  event: Extract<UIEvent, { type: "execution.subagent.event" }>,
): Record<string, ExecutionSessionState | undefined> {
  const current = ensureExecutionSession(state, event.sessionId);
  const existing =
    current.subagents[event.subagentId] ??
    ({
      id: event.subagentId,
      parentToolId: event.parentToolId,
      ordinal: nextExecutionOrdinal(current.subagents),
      iconSeed: event.subagentId,
      status: "running",
      createdAt: event.timestamp,
      updatedAt: event.timestamp,
      events: [],
      timeline: [],
      text: "",
    } satisfies ExecutionSubagentRecord);
  const timelineItem = timelineItemFromExecutionEvent(
    event.event,
    event.timestamp,
  );
  const text =
    event.event.type === "text.chunk"
      ? mergeStreamingText(existing.text, event.event.content)
      : existing.text;
  const subagent: ExecutionSubagentRecord = {
    ...existing,
    status: existing.status === "creating" ? "running" : existing.status,
    updatedAt: event.timestamp,
    events: [...existing.events.slice(-(MAX_SUBAGENT_EVENTS - 1)), event.event],
    timeline: timelineItem
      ? upsertTimeline(existing.timeline, timelineItem).slice(
          -MAX_SUBAGENT_TIMELINE_ITEMS,
        )
      : existing.timeline,
    text,
  };
  return {
    ...state,
    [event.sessionId]: {
      ...current,
      subagents: { ...current.subagents, [event.subagentId]: subagent },
    },
  };
}

const MAX_SUBAGENT_EVENTS = 1_000;
const MAX_SUBAGENT_TIMELINE_ITEMS = 1_000;

/**
 * Runtime adapters normally emit deltas, but reconnect/completion boundaries
 * can replay a cumulative snapshot or an overlapping tail. Merge both shapes
 * without duplicating the full subagent answer in memory and in the Inspector.
 */
export function mergeStreamingText(current: string, incoming: string): string {
  if (!incoming) return current;
  if (!current) return incoming;
  if (incoming.startsWith(current)) return incoming;
  if (current.endsWith(incoming)) return current;

  const maxOverlap = Math.min(current.length, incoming.length, 4_096);
  for (let size = maxOverlap; size > 0; size -= 1) {
    if (current.endsWith(incoming.slice(0, size))) {
      return current + incoming.slice(size);
    }
  }
  return current + incoming;
}

export function completeExecutionSubagent(
  state: Record<string, ExecutionSessionState | undefined>,
  event: Extract<UIEvent, { type: "execution.subagent.complete" }>,
): Record<string, ExecutionSessionState | undefined> {
  const current = ensureExecutionSession(state, event.sessionId);
  const existing =
    current.subagents[event.subagentId] ??
    ({
      id: event.subagentId,
      parentToolId: event.parentToolId,
      ordinal: nextExecutionOrdinal(current.subagents),
      iconSeed: event.subagentId,
      status: "running",
      createdAt: event.timestamp,
      updatedAt: event.timestamp,
      events: [],
      timeline: [],
      text: "",
    } satisfies ExecutionSubagentRecord);
  const subagent: ExecutionSubagentRecord = {
    ...existing,
    status: event.status,
    updatedAt: event.timestamp,
    completedAt: event.timestamp,
    text: existing.text || textFromSubagentOutput(event.output),
  };
  return {
    ...state,
    [event.sessionId]: {
      ...current,
      subagents: { ...current.subagents, [event.subagentId]: subagent },
    },
  };
}

export function textFromSubagentOutput(output: unknown): string {
  if (typeof output === "string") return output.trim();
  if (Array.isArray(output)) {
    return output
      .map(textFromSubagentOutput)
      .filter(Boolean)
      .join("\n\n")
      .trim();
  }
  if (output && typeof output === "object") {
    const record = output as Record<string, unknown>;
    for (const key of ["text", "content", "message", "result", "output"]) {
      const value = textFromSubagentOutput(record[key]);
      if (value) return value;
    }
    try {
      return JSON.stringify(output, null, 2);
    } catch {
      return "";
    }
  }
  return "";
}

export function timelineItemFromExecutionEvent(
  event: Extract<
    UIEvent,
    {
      type:
        | "text.chunk"
        | "thinking.chunk"
        | "runtime.status"
        | "tool.start"
        | "tool.progress"
        | "tool.complete";
    }
  >,
  timestamp: number,
): TimelineItem | null {
  if (event.type === "text.chunk") return null;
  if (event.type === "thinking.chunk") {
    return {
      id: `thinking-${timestamp}`,
      type: "thinking",
      label: "Reasoning",
      detail: event.content,
      createdAt: timestamp,
    };
  }
  if (event.type === "runtime.status") {
    return {
      id: event.id ?? `runtime-${timestamp}`,
      type: "status",
      label: event.label,
      detail: event.detail,
      createdAt: timestamp,
      status: event.status,
    };
  }
  if (event.type === "tool.start" || event.type === "tool.progress") {
    return {
      id: event.toolId,
      type: event.type === "tool.start" ? "tool_start" : "tool_delta",
      label: event.toolName,
      detail: JSON.stringify(
        event.type === "tool.start"
          ? (event.input ?? {})
          : (event.input ?? event.partialInput),
        null,
        2,
      ),
      createdAt: timestamp,
      status:
        event.type === "tool.progress" && !event.isReady
          ? "pending"
          : "running",
      toolName: event.toolName,
      toolInput:
        event.type === "tool.start"
          ? (event.input ?? {})
          : (event.input ?? event.partialInput),
    };
  }
  return {
    id: event.toolId,
    type: "tool_result",
    label: event.isError ? "Tool error" : "Tool result",
    detail:
      typeof event.output === "string"
        ? event.output
        : JSON.stringify(event.output, null, 2),
    createdAt: timestamp,
    status: event.isError ? "error" : "completed",
    isError: event.isError,
    toolOutput: event.output,
  };
}

export function upsertTimeline(
  timeline: TimelineItem[],
  item: TimelineItem,
): TimelineItem[] {
  const index = timeline.findIndex(
    (entry) => entry.id === item.id && entry.type === item.type,
  );
  if (index < 0) return boundLiveTimeline([...timeline, item]);
  const next = [...timeline];
  next[index] = {
    ...next[index],
    ...item,
    createdAt: next[index].createdAt,
  };
  return boundLiveTimeline(next);
}

const MAX_LIVE_TIMELINE_ITEMS = 1_000;

function boundLiveTimeline(timeline: TimelineItem[]): TimelineItem[] {
  return timeline.length > MAX_LIVE_TIMELINE_ITEMS
    ? timeline.slice(-MAX_LIVE_TIMELINE_ITEMS)
    : timeline;
}

const ABORT_GUARD_TTL_MS = 30_000;
// 已中止的 turnId：拦截晚到的同 turn 事件（turn.start 复活）。
const abortedTurnIds = new Map<string, number>();
// pending 阶段（turnId 未定）被中止的会话：拦截 chat.send() resolve 的复活。
const pendingAbortSessions = new Map<string, number>();

export function pruneAbortGuards(now: number): void {
  for (const [key, at] of abortedTurnIds) {
    if (now - at > ABORT_GUARD_TTL_MS) abortedTurnIds.delete(key);
  }
  for (const [key, at] of pendingAbortSessions) {
    if (now - at > ABORT_GUARD_TTL_MS) pendingAbortSessions.delete(key);
  }
}

export function markTurnAborted(turnId: string): void {
  const now = Date.now();
  pruneAbortGuards(now);
  abortedTurnIds.set(turnId, now);
}

export function isTurnAborted(turnId: string | null | undefined): boolean {
  if (!turnId) return false;
  const at = abortedTurnIds.get(turnId);
  if (at === undefined) return false;
  if (Date.now() - at > ABORT_GUARD_TTL_MS) {
    abortedTurnIds.delete(turnId);
    return false;
  }
  return true;
}

export function markPendingAbort(sessionId: string): void {
  const now = Date.now();
  pruneAbortGuards(now);
  pendingAbortSessions.set(sessionId, now);
}

// 消费一次 pending abort 标记：命中则清除并返回 true（一次性）。
export function consumePendingAbort(sessionId: string): boolean {
  const at = pendingAbortSessions.get(sessionId);
  if (at === undefined) return false;
  pendingAbortSessions.delete(sessionId);
  return Date.now() - at <= ABORT_GUARD_TTL_MS;
}
