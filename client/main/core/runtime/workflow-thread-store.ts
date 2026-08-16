import type { RuntimeEvent, Thread } from "../../../shared/agent-runtime";
import type {
  WorkflowAgentMessageItem,
  WorkflowMcpToolCallItem,
  WorkflowReasoningItem,
  WorkflowTextOutput,
  WorkflowUserMessageContent,
  WorkflowTurnItem,
} from "../../../shared/workflow-read-thread-contract";
import type {
  WorkflowReadThreadInput,
  WorkflowSubscribeThreadInput,
  WorkflowThreadPatch,
} from "../../../shared/workflow-thread-data-source";
import {
  serializeWorkflowThread,
  type WorkflowThreadStoreThread,
  type WorkflowThreadStoreTurn,
} from "./read-thread-serializer";
import { compressToolResult } from "../context/token-economy";

interface StartTurnInput {
  threadId: string;
  turnId: string;
  content: string;
  attachments?: unknown[];
  userMessageId: string;
  startedAt?: number;
  cwd?: string | null;
  modelId?: string | null;
  modelName?: string | null;
}

type ThreadListener = (threadId: string) => void;

function now(): number {
  return Date.now();
}

function defaultTitle(): string {
  return "New chat";
}
function userContentFromInput(
  text: string,
  attachments: unknown[] | undefined,
): WorkflowUserMessageContent[] {
  const content: WorkflowUserMessageContent[] = [];
  if (text.trim()) content.push({ type: "text", text });
  for (const attachment of attachments ?? []) {
    const record =
      attachment && typeof attachment === "object"
        ? (attachment as Record<string, unknown>)
        : null;
    if (!record) continue;
    if (
      record.type === "localImage" &&
      typeof record.path === "string" &&
      record.path.trim()
    ) {
      content.push({ type: "localImage", path: record.path });
      continue;
    }
    const imageUrl =
      typeof record.url === "string"
        ? record.url
        : typeof record.dataUrl === "string"
          ? record.dataUrl
          : "";
    if ((record.type === "image" || record.dataUrl) && imageUrl.trim()) {
      content.push({ type: "image", url: imageUrl });
      continue;
    }
    if (
      (record.type === "skill" || record.type === "mention") &&
      typeof record.name === "string" &&
      record.name.trim()
    ) {
      const path =
        typeof record.path === "string" && record.path.trim()
          ? record.path
          : undefined;
      content.push(
        record.type === "skill"
          ? { type: "skill", name: record.name, path }
          : { type: "mention", name: record.name, path },
      );
    }
  }
  return content;
}

function textOutput(text: string): WorkflowTextOutput {
  return { text, truncated: false };
}

class WorkflowThreadStore {
  private threads = new Map<string, WorkflowThreadStoreThread>();
  private listeners = new Set<ThreadListener>();

  listThreads(): Thread[] {
    return [...this.threads.values()]
      .sort((a, b) => Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0))
      .map((thread) => ({
        id: thread.id,
        title: thread.title,
        messages: [],
        createdAt: Number(thread.createdAt ?? now()),
        updatedAt: Number(thread.updatedAt ?? now()),
      }));
  }

  ensureThread(
    threadId: string,
    options: Partial<Pick<WorkflowThreadStoreThread, "title" | "cwd">> = {},
  ) {
    let thread = this.threads.get(threadId);
    const timestamp = now();
    if (!thread) {
      thread = {
        id: threadId,
        title: options.title ?? defaultTitle(),
        preview: "",
        status: { type: "idle" },
        cwd: options.cwd ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
        turnOrder: [],
        turns: new Map(),
        displayTurnIds: new Map(),
      };
      this.threads.set(threadId, thread);
    } else {
      if (options.title) thread.title = options.title;
      if (options.cwd !== undefined) thread.cwd = options.cwd;
    }
    return thread;
  }

  createThread(title?: string): Thread {
    const id = crypto.randomUUID();
    const thread = this.ensureThread(id, { title: title ?? defaultTitle() });
    this.emit(id);
    return {
      id,
      title: thread.title,
      messages: [],
      createdAt: Number(thread.createdAt),
      updatedAt: Number(thread.updatedAt),
    };
  }

  deleteThread(threadId: string): void {
    this.threads.delete(threadId);
    this.emit(threadId);
  }

  forkThread(threadId: string, upToTurnId?: string): Thread {
    const source = this.ensureThread(threadId);
    const forkId = crypto.randomUUID();
    const target = this.cloneThread(threadId, forkId, {
      title: `Forked: ${source.title}`,
      upToTurnId,
    });
    return {
      id: target.id,
      title: target.title,
      messages: [],
      createdAt: Number(target.createdAt ?? now()),
      updatedAt: Number(target.updatedAt ?? now()),
    };
  }

  cloneThread(
    sourceThreadId: string,
    targetThreadId: string,
    options: {
      title?: string;
      upToTurnId?: string;
      upToMessageId?: string;
    } = {},
  ): WorkflowThreadStoreThread {
    const source = this.ensureThread(sourceThreadId);
    const target = this.ensureThread(targetThreadId, {
      title: options.title ?? `Forked: ${source.title}`,
      cwd: source.cwd,
    });
    const endIndex = findForkEndIndex(
      source,
      options.upToTurnId,
      options.upToMessageId,
    );
    const turnIds =
      endIndex >= 0
        ? source.turnOrder.slice(0, endIndex + 1)
        : [...source.turnOrder];
    target.turnOrder = [...turnIds];
    target.turns = new Map(
      turnIds.map((turnId) => [turnId, cloneTurn(source.turns.get(turnId)!)]),
    );
    target.preview = previewFromThread(target);
    target.status = { type: "idle" };
    target.updatedAt = now();
    this.emit(targetThreadId);
    return target;
  }

  truncateFromUserMessage(
    threadId: string,
    userMessageId: string,
    includeMessage = false,
  ): void {
    const thread = this.threads.get(threadId);
    if (!thread) return;
    const turnIndex = thread.turnOrder.findIndex((turnId) => {
      const turn = thread.turns.get(turnId);
      return turn?.itemOrder.some(
        (itemId) => turn.items.get(itemId)?.item.id === userMessageId,
      );
    });
    if (turnIndex < 0) return;
    const end = includeMessage ? turnIndex + 1 : turnIndex;
    const keptTurnIds = thread.turnOrder.slice(0, end);
    thread.turnOrder = keptTurnIds;
    for (const turnId of [...thread.turns.keys()]) {
      if (!keptTurnIds.includes(turnId)) thread.turns.delete(turnId);
    }
    thread.updatedAt = now();
    thread.preview = previewFromThread(thread);
    this.emit(threadId);
  }

  startTurn(input: StartTurnInput): void {
    const startedAt = input.startedAt ?? now();
    const thread = this.ensureThread(input.threadId, { cwd: input.cwd });
    thread.status = { type: "active", activeFlags: {} };
    thread.updatedAt = startedAt;
    if (!thread.turns.has(input.turnId)) thread.turnOrder.push(input.turnId);
    const turn: WorkflowThreadStoreTurn = {
      id: input.turnId,
      status: "running",
      error: null,
      startedAt,
      completedAt: null,
      durationMs: null,
      modelId: input.modelId ?? null,
      modelName: input.modelName ?? null,
      itemOrder: [input.userMessageId],
      items: new Map([
        [
          input.userMessageId,
          {
            item: {
              type: "userMessage",
              id: input.userMessageId,
              content: userContentFromInput(input.content, input.attachments),
            },
          },
        ],
      ]),
    };
    thread.turns.set(input.turnId, turn);
    thread.preview = input.content.trim().slice(0, 160) || thread.preview;
    if (thread.title === defaultTitle())
      thread.title = input.content.trim().slice(0, 50) || thread.title;
    this.emit(input.threadId);
  }

  applyRuntimeEvent(
    threadId: string,
    turnId: string,
    event: RuntimeEvent,
    timestamp = now(),
  ): void {
    const thread = this.ensureThread(threadId);

    // A steer is a second user input that arrives while the SDK is still
    // executing the same runtime turn. The conversation UI must nevertheless
    // place it chronologically between the assistant output before and after
    // it. We start a new display segment and route all later events for this
    // still-running runtime turn into that segment beginning with the steer.
    if (
      event.kind === "steer-message" &&
      (event.payload.status === "sent" ||
        event.payload.status === "applied" ||
        !event.payload.status)
    ) {
      const previousTurnId = thread.displayTurnIds.get(turnId) ?? turnId;
      const previousTurn = this.ensureTurn(thread, previousTurnId, timestamp);
      const steerTurnId = `${turnId}:steer:${event.payload.messageId}`;

      if (!thread.turns.has(steerTurnId)) {
        // 引导（立即引导）不结束原 turn：保持 running，直到引导续跑也结束才收尾。
        if (event.payload.status === "applied") {
          previousTurn.continuationFragment = true;
        }
        const item: WorkflowTurnItem = {
          type: "userMessage",
          id: event.payload.messageId,
          content: event.payload.content.length
            ? event.payload.content
            : event.payload.text
              ? [{ type: "text", text: event.payload.text }]
              : [],
        };
        thread.turnOrder.push(steerTurnId);
        thread.turns.set(steerTurnId, {
          id: steerTurnId,
          status: "running",
          error: null,
          startedAt: previousTurn.startedAt ?? timestamp,
          completedAt: null,
          durationMs: null,
          modelId: previousTurn.modelId ?? null,
          modelName: previousTurn.modelName ?? null,
          continuesPreviousTurn: event.payload.status === "applied" || undefined,
          appliedInterruptPending: event.payload.status === "applied",
          itemOrder: [item.id],
          items: new Map([[item.id, { item }]]),
        });
      }
      thread.displayTurnIds.set(turnId, steerTurnId);
      thread.status = { type: "active", activeFlags: {} };
      thread.preview =
        event.payload.text.trim().slice(0, 160) || thread.preview;
      thread.updatedAt = timestamp;
      this.emit(threadId);
      return;
    }

    const displayTurnId = thread.displayTurnIds.get(turnId) ?? turnId;
    const turn = this.ensureTurn(thread, displayTurnId, timestamp);

    // Any substantive follow-up event (assistant text, tools, etc.) means the
    // SDK has started the priority:"now" continuation turn — clear the
    // applied-interrupt guard so a later manual stop is honored.
    if (
      turn.appliedInterruptPending &&
      event.kind !== "turn-complete" &&
      event.kind !== "token-usage" &&
      event.kind !== "runtime-status"
    ) {
      turn.appliedInterruptPending = false;
    }

    if (event.kind === "text-chunk") {
      this.appendAgentText(turn, event.payload.content, timestamp);
      thread.preview = event.payload.content.trim()
        ? event.payload.content.trim().slice(0, 160)
        : thread.preview;
    } else if (event.kind === "thinking-chunk") {
      this.appendReasoning(turn, event.payload.content, timestamp);
    } else if (event.kind === "tool-start" || event.kind === "tool-progress") {
      const payload = event.payload;
      const existing = turn.items.get(payload.toolId)?.item;
      const item: WorkflowMcpToolCallItem = {
        type: "mcpToolCall",
        id: payload.toolId,
        tool: payload.toolName,
        arguments: "input" in payload ? payload.input : {},
        status:
          event.kind === "tool-progress" && event.payload.isReady === false
            ? "pending"
            : "running",
      };
      this.upsertItem(
        turn,
        existing?.type === "mcpToolCall" ? { ...existing, ...item } : item,
      );
    } else if (event.kind === "tool-complete") {
      const existing = turn.items.get(event.payload.toolId)?.item;
      const economy = compressToolResult(event.payload.output, {
        maxModelChars: 6_000,
      });
      const output = textOutput(economy.rawText);
      const modelOutput = textOutput(economy.modelText);
      if (existing?.type === "mcpToolCall") {
        this.upsertItem(turn, {
          ...existing,
          status: event.payload.isError ? "error" : "completed",
          output,
          modelOutput,
          contextEconomy: economy.meta,
        });
      } else {
        this.upsertItem(turn, {
          type: "mcpToolCall",
          id: event.payload.toolId,
          tool: "tool",
          status: event.payload.isError ? "error" : "completed",
          output,
          modelOutput,
          contextEconomy: economy.meta,
        });
      }
    } else if (event.kind === "runtime-status") {
      this.upsertItem(turn, {
        type: "unknown",
        id: `runtime-status-${turnId}-${turn.itemOrder.length}`,
        rawType: "runtime-status",
        raw: event.payload,
      });
    } else if (event.kind === "steer-message") {
      // A flushed steer is a chronological user input in the same runtime turn.
      // canceled steers never reached the agent, so they are not recorded.
      if (event.payload.status !== "canceled") {
        this.upsertItem(turn, {
          type: "userMessage",
          id: event.payload.messageId,
          content: event.payload.content,
        });
      }
    } else if (event.kind === "token-usage") {
      turn.usage = event.payload.usage;
    } else if (event.kind === "turn-complete") {
      // Immediate steer closes only the interrupted display fragment. Drop this
      // intermediate boundary (it belongs to the already-finalized predecessor).
      if (event.payload.final === false) {
        turn.appliedInterruptPending = false;
        thread.updatedAt = timestamp;
        this.emit(threadId);
        return;
      }
      // apply (priority:"now") 中断：SDK 先发 turn.complete(interrupted) 收尾
      // 被中断的前一段，再续跑 steer 段。该 stray 终态因 displayTurnIds 已切换
      // 而路由到 steer 段，但它属于已收尾的前一段，不可把 steer 段标成完成。
      if (turn.appliedInterruptPending && event.payload.result === "interrupted") {
        turn.appliedInterruptPending = false;
      } else {
        this.finalizeTurn(
          turn,
          event.payload.result,
          event.payload.error,
          timestamp,
        );
        // steer 续跑结束：沿 continuation 链向前收尾所有被引导打断的段
        // （一次 turn 里可能连续引导多次）。
        if (turn.continuesPreviousTurn) {
          const index = thread.turnOrder.indexOf(turn.id);
          for (let i = index - 1; i >= 0; i -= 1) {
            const predecessor = thread.turns.get(thread.turnOrder[i]);
            if (!predecessor) break;
            if (predecessor.status !== "running") break;
            if (
              !predecessor.continuationFragment &&
              !predecessor.continuesPreviousTurn
            ) {
              break;
            }
            this.finalizeTurn(
              predecessor,
              event.payload.result,
              event.payload.error,
              timestamp,
            );
          }
        }
        thread.status = { type: "idle" };
      }
    } else if (event.kind === "error") {
      turn.status = "failed";
      turn.error = {
        message: event.payload.message,
        additionalDetails: event.payload,
      };
      thread.status = { type: "systemError" };
    }

    thread.updatedAt = timestamp;
    this.emit(threadId);
  }

  readThread(input: WorkflowReadThreadInput) {
    return serializeWorkflowThread(
      this.ensureThread(input.threadId ?? "default"),
      input,
    );
  }

  subscribeThread(
    input: WorkflowSubscribeThreadInput,
  ): AsyncIterable<WorkflowThreadPatch> {
    return {
      [Symbol.asyncIterator]: () => this.threadSubscriptionIterator(input),
    };
  }

  private async *threadSubscriptionIterator(
    input: WorkflowSubscribeThreadInput,
  ): AsyncGenerator<WorkflowThreadPatch> {
    const threadId = input.threadId ?? "default";
    const queue: WorkflowThreadPatch[] = [];
    let wake: (() => void) | null = null;
    const listener: ThreadListener = (changedThreadId) => {
      if (changedThreadId !== threadId) return;
      queue.push({ type: "snapshot", snapshot: this.readThread(input) });
      wake?.();
    };
    this.listeners.add(listener);
    try {
      queue.push({ type: "snapshot", snapshot: this.readThread(input) });
      while (!input.signal?.aborted) {
        const next = queue.shift();
        if (next) {
          yield next;
          continue;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = null;
      }
    } finally {
      this.listeners.delete(listener);
    }
  }

  addListener(listener: ThreadListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(threadId: string): void {
    for (const listener of this.listeners) listener(threadId);
  }

  private ensureTurn(
    thread: WorkflowThreadStoreThread,
    turnId: string,
    timestamp: number,
  ): WorkflowThreadStoreTurn {
    let turn = thread.turns.get(turnId);
    if (!turn) {
      turn = {
        id: turnId,
        status: "running",
        error: null,
        startedAt: timestamp,
        completedAt: null,
        durationMs: null,
        itemOrder: [],
        items: new Map(),
      };
      thread.turns.set(turnId, turn);
      thread.turnOrder.push(turnId);
    }
    return turn;
  }

  private upsertItem(
    turn: WorkflowThreadStoreTurn,
    item: WorkflowTurnItem,
  ): void {
    if (!turn.items.has(item.id)) turn.itemOrder.push(item.id);
    turn.items.set(item.id, { item });
  }

  private finalizeTurn(
    turn: WorkflowThreadStoreTurn,
    result: "success" | "error" | "aborted" | "interrupted",
    error: string | undefined,
    timestamp: number,
  ): void {
    turn.status =
      result === "success"
        ? "completed"
        : result === "aborted"
          ? "cancelled"
          : "failed";
    turn.completedAt = timestamp;
    turn.durationMs =
      typeof turn.startedAt === "number" ? timestamp - turn.startedAt : null;
    turn.error = error ? { message: error } : null;
    // finalize 流式不变量：所有 agentMessage 标记为已稳定，
    // 渲染端从"节流 + 增量渲染"切回全量渲染（最后一次）。
    for (const itemId of turn.itemOrder) {
      const entry = turn.items.get(itemId);
      const item = entry?.item;
      if (item?.type === "agentMessage" && item.settled !== true) {
        this.upsertItem(turn, { ...item, settled: true, phase: "finalized" });
      }
    }
  }

  private appendAgentText(
    turn: WorkflowThreadStoreTurn,
    delta: string,
    timestamp: number,
  ): void {
    const id = currentAgentItemId(turn);
    const existing = turn.items.get(id)?.item;
    const existingText = existing?.type === "agentMessage" ? existing.text : "";
    const text =
      existingText && delta.startsWith(existingText)
        ? delta
        : existingText + delta;
    const item: WorkflowAgentMessageItem = {
      type: "agentMessage",
      id,
      text,
      phase: "updated",
      // 流式不变量：chunk 期间 settled=false，turn 完成时 finalize 为 true。
      // 渲染端据此走节流 + 增量渲染路径，避免每 chunk 同步全量重解析。
      settled: false,
    };
    this.upsertItem(turn, item);
    updateItemTime(item, timestamp);
  }

  private appendReasoning(
    turn: WorkflowThreadStoreTurn,
    delta: string,
    _timestamp: number,
  ): void {
    const id = `reasoning-${turn.id}`;
    const existing = turn.items.get(id)?.item;
    const content =
      existing?.type === "reasoning" ? (existing.content ?? []) : [];
    const previous = content[0]?.text ?? "";
    const item: WorkflowReasoningItem = {
      type: "reasoning",
      id,
      summary: "Reasoning",
      content: [textOutput(previous + delta)],
    };
    this.upsertItem(turn, item);
  }
}

function updateItemTime(_item: WorkflowTurnItem, _timestamp: number): void {
  // The read-thread contract intentionally keeps item timestamps optional for now.
}

function currentAgentItemId(turn: WorkflowThreadStoreTurn): string {
  const lastItemId = turn.itemOrder[turn.itemOrder.length - 1];
  const lastItem = lastItemId ? turn.items.get(lastItemId)?.item : undefined;
  if (lastItem?.type === "agentMessage") return lastItem.id;
  const agentCount = turn.itemOrder.filter(
    (itemId) => turn.items.get(itemId)?.item.type === "agentMessage",
  ).length;
  return agentCount === 0
    ? `agent-${turn.id}`
    : `agent-${turn.id}-${agentCount + 1}`;
}

function cloneTurn(turn: WorkflowThreadStoreTurn): WorkflowThreadStoreTurn {
  return {
    ...turn,
    itemOrder: [...turn.itemOrder],
    items: new Map(
      [...turn.items.entries()].map(([id, item]) => [
        id,
        { item: structuredClone(item.item) },
      ]),
    ),
  };
}

function findForkEndIndex(
  source: WorkflowThreadStoreThread,
  upToTurnId?: string,
  upToMessageId?: string,
): number {
  if (upToTurnId) {
    const index = source.turnOrder.indexOf(upToTurnId);
    if (index >= 0) return index;
  }
  if (!upToMessageId) return -1;
  return source.turnOrder.findIndex((turnId) => {
    const turn = source.turns.get(turnId);
    return turn?.itemOrder.some(
      (itemId) => turn.items.get(itemId)?.item.id === upToMessageId,
    );
  });
}

function previewFromThread(thread: WorkflowThreadStoreThread): string {
  for (let index = thread.turnOrder.length - 1; index >= 0; index -= 1) {
    const turn = thread.turns.get(thread.turnOrder[index]);
    if (!turn) continue;
    for (
      let itemIndex = turn.itemOrder.length - 1;
      itemIndex >= 0;
      itemIndex -= 1
    ) {
      const item = turn.items.get(turn.itemOrder[itemIndex])?.item;
      if (item?.type === "agentMessage" && item.text.trim())
        return item.text.trim().slice(0, 160);
      if (item?.type === "userMessage") {
        const text = item.content
          .find((content) => content.type === "text")
          ?.text.trim();
        if (text) return text.slice(0, 160);
      }
    }
  }
  return "";
}

export const workflowThreadStore = new WorkflowThreadStore();
