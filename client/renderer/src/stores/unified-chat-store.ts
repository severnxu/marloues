/**
 * Unified chat store based on the MessageItem event model.
 *
 * Receives chat:item-event IPC pushes, maintains the Message[] list,
 * and adapts it into WorkflowMessageBlock[] for UI rendering.
 */

import { create } from "zustand";
import type { ChatRewindResult, ChatSessionRecord, ContextActionRequest, MessageBlock, TimelineItem, TokenUsage } from "@shared/types";
import type { UIEvent } from "@shared/ui-protocol";
import type { WorkflowReadThreadResponse } from "@shared/workflow-read-thread-contract";
import { mergeLiveTurnRuntimeStatus, type ChatLiveTurnStatus } from "./live-turn";
import type { Message, MessageItem, UserMessageContent } from "../types";
import { buildWorkflowMessages, type WorkflowMessageBlock } from "../components/workflow-chat/workflow-consumption-model";
import {
  workflowMessagesToWorkflowReadThreadResponse,
  type WorkflowTurnItem,
} from "@shared/adapters/workflow-messages-to-read-thread";

interface ItemEvent {
  type: string;
  sessionId: string;
  turnId: string;
  startedAt?: number;
  completedAt?: number;
  result?: string;
  error?: string;
  usage?: TokenUsage;
  modelId?: string;
  modelName?: string;
  item?: MessageItem;
}

interface LiveTurn {
  turnId: string | null;
  status: ChatLiveTurnStatus;
  startedAt: number;
  content: string;
  blocks: MessageBlock[];
  timeline: TimelineItem[];
  compactionActive?: boolean;
  compactionSettled?: boolean;
  contextBlocked?: boolean;
  usage?: TokenUsage;
  modelId?: string;
  modelName?: string;
  workspacePath?: string;
  workspaceName?: string;
}

interface UnifiedChatStore {
  sessions: ChatSessionRecord[];
  activeSessionId: string | null;
  isStreaming: boolean;
  currentRequestId: string | null;
  contextActionRequest: ContextActionRequest | null;
  liveTurns: Record<string, LiveTurn | undefined>;
  readThreads: Record<string, WorkflowReadThreadResponse | undefined>;
  inputDrafts: Record<string, string | undefined>;
  inputText: string;

  load: () => Promise<void>;
  createSession: () => Promise<void>;
  setActiveSession: (id: string) => void;
  deleteSession: (id: string) => Promise<void>;
  updateSessionTitle: (id: string, title: string) => Promise<void>;
  toggleSessionPinned: (id: string) => Promise<void>;
  forkSession: (id: string, upToMessageId?: string) => Promise<ChatSessionRecord>;
  rewindFiles: (id: string, userMessageId: string, options?: { dryRun?: boolean; confirmedFiles?: string[] }) => Promise<ChatRewindResult>;
  sendMessage: (text: string, attachments?: UserMessageContent[], clientMessageId?: string) => Promise<void>;
  regenerateMessage: (messageId: string) => Promise<void>;
  editAndResendMessage: (messageId: string, text: string) => Promise<void>;
  abort: (sessionId?: string) => Promise<void>;
  setInputText: (text: string) => void;
  handleItemEvent: (event: ItemEvent) => void;
  handleEvent: (event: UIEvent) => void;
  clearContextActionRequest: () => void;
  continueContextAction: () => Promise<void>;
  loadReadThread: (sessionId: string) => Promise<void>;
  handleReadThread: (snapshot: WorkflowReadThreadResponse | null) => void;

  // derived
  getWorkflowMessages: () => WorkflowMessageBlock[];
  getActiveReadThreadModel: () => WorkflowReadThreadResponse | null;
}

function genId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isDefaultSessionTitle(title: string): boolean {
  return title === "New chat" || title === "Untitled";
}

function emptyLiveTurn(turnId: string | null, status: LiveTurn["status"]): LiveTurn {
  return { turnId, status, startedAt: Date.now(), content: "", blocks: [], timeline: [] };
}

function toWorkflowMessage(message: ChatSessionRecord["messages"][number]): Message {
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

function assistantTextFromItems(items: MessageItem[]): string {
  return items
    .filter((item) => item.type === "agent_message")
    .map((item) => item.text ?? "")
    .join("");
}

function buildUserContent(text: string, attachments: UserMessageContent[]): UserMessageContent[] {
  const content: UserMessageContent[] = [];
  if (text) content.push({ type: "text", text });
  for (const attachment of attachments) {
    if (attachment.type === "image" || attachment.type === "localImage" || attachment.type === "skill" || attachment.type === "mention") {
      content.push(attachment);
    }
  }
  return content;
}
function localSessionRecord(id: string): ChatSessionRecord {
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

function liveTurnIsActive(turn: LiveTurn | undefined): boolean {
  return turn?.status === "pending" || turn?.status === "running";
}

function hasLiveTurns(liveTurns: Record<string, LiveTurn | undefined>): boolean {
  return Object.values(liveTurns).some(liveTurnIsActive);
}

function withLiveTurnWorkspace(state: Pick<UnifiedChatStore, "sessions">, sessionId: string, turn: LiveTurn): LiveTurn {
  const session = state.sessions.find((item) => item.id === sessionId);
  return {
    ...turn,
    workspacePath: turn.workspacePath ?? session?.workspacePath,
    workspaceName: turn.workspaceName ?? session?.workspaceName,
  };
}

function reconcileReadThreadSnapshot(
  state: UnifiedChatStore,
  snapshot: WorkflowReadThreadResponse,
): Partial<UnifiedChatStore> {
  const threadId = snapshot.thread.id;
  const readThreads = { ...state.readThreads, [threadId]: snapshot };
  const hasRunningTurn = snapshot.turns.some((turn) => turn.status === "running");
  const liveTurn = state.liveTurns[threadId];
  if (hasRunningTurn || !liveTurn) return { readThreads };
  if (liveTurnIsActive(liveTurn)) return { readThreads };

  const liveTurns = { ...state.liveTurns };
  delete liveTurns[threadId];
  return {
    readThreads,
    liveTurns,
    isStreaming: hasLiveTurns(liveTurns),
    currentRequestId: state.currentRequestId === liveTurn.turnId ? null : state.currentRequestId,
  };
}

export const useUnifiedChatStore = create<UnifiedChatStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  isStreaming: false,
  currentRequestId: null,
  contextActionRequest: null,
  liveTurns: {},
  readThreads: {},
  inputDrafts: {},
  inputText: "",

  load: async () => {
    try {
      const sessions = await window.marloues.chat.listSessions();
      if (sessions.length === 0) {
        const session = await window.marloues.chat.createSession();
        set({
          sessions: [session],
          activeSessionId: session.id,
          contextActionRequest: null,
        });
        void get().loadReadThread(session.id);
      } else {
        set({
          sessions,
          activeSessionId: sessions[0].id,
        });
        void get().loadReadThread(sessions[0].id);
      }
    } catch {
      // If loading fails, create a local session.
      const id = genId("session");
      set({ sessions: [localSessionRecord(id)], activeSessionId: id });
      void get().loadReadThread(id);
    }
  },

  createSession: async () => {
    try {
      const session = await window.marloues.chat.createSession();
      set((state) => ({
        sessions: [session, ...state.sessions],
        activeSessionId: session.id,
        inputText: state.inputDrafts[session.id] ?? "",
      }));
      void get().loadReadThread(session.id);
    } catch {
      const id = genId("session");
      set((state) => ({
        sessions: [localSessionRecord(id), ...state.sessions],
        activeSessionId: id,
        inputText: state.inputDrafts[id] ?? "",
      }));
      void get().loadReadThread(id);
    }
  },

  setActiveSession: (id) => {
    set((state) => ({ activeSessionId: id, inputText: state.inputDrafts[id] ?? "" }));
    void get().loadReadThread(id);
  },

  deleteSession: async (id) => {
    try {
      await window.marloues.chat.deleteSession(id);
    } catch {
      // ignore
    }
    set((state) => {
      const sessions = state.sessions.filter((s) => s.id !== id);
      const activeSessionId = state.activeSessionId === id ? (sessions[0]?.id ?? null) : state.activeSessionId;
      return {
        sessions,
        activeSessionId,
        inputText: activeSessionId ? (state.inputDrafts[activeSessionId] ?? "") : "",
      };
    });
  },

  updateSessionTitle: async (id, title) => {
    await window.marloues.chat.updateSessionTitle(id, title);
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === id ? { ...session, title, updatedAt: Date.now() } : session,
      ),
    }));
  },

  toggleSessionPinned: async (id) => {
    await window.marloues.chat.toggleSessionPinned(id);
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === id ? { ...session, isPinned: !session.isPinned, updatedAt: Date.now() } : session,
      ),
    }));
  },

  forkSession: async (id, upToMessageId) => {
    const fork = await window.marloues.chat.forkSession({ sessionId: id, upToMessageId });
    set((state) => ({
      sessions: [fork, ...state.sessions],
      activeSessionId: fork.id,
      inputText: state.inputDrafts[fork.id] ?? "",
    }));
    return fork;
  },

  rewindFiles: (id, userMessageId, options = {}) =>
    window.marloues.chat.rewindFiles({
      sessionId: id,
      userMessageId,
      dryRun: options.dryRun,
      confirmedFiles: options.confirmedFiles,
    }),

  sendMessage: async (text, attachments = [], clientMessageId) => {
    let sessionId = get().activeSessionId;
    if (!sessionId) {
      await get().createSession();
      sessionId = get().activeSessionId;
      if (!sessionId) return;
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

    set((state) => ({
      isStreaming: true,
      liveTurns: {
        ...state.liveTurns,
        [sessionId]: withLiveTurnWorkspace(state, sessionId, state.liveTurns[sessionId] ?? emptyLiveTurn(null, "pending")),
      },
      sessions: state.sessions.map((s) =>
        s.id === sessionId
          ? {
              ...s,
              title: isDefaultSessionTitle(s.title) ? (text.slice(0, 40) || (attachments.length ? "Image message" : s.title)) : s.title,
              updatedAt: Date.now(),
              messages: [
                ...s.messages,
                {
                  id: userMsg.id,
                  role: "user",
                  content: userMsg.content,
                  userContent,
                  blocks: userMsg.content
                    ? [{ id: `${userMsg.id}-text`, type: "text", text: userMsg.content }]
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
      const requestId = await window.marloues.chat.send({ sessionId, text, attachments: userContent, clientMessageId: userMsg.id });
      set((state) => {
        const turn = state.liveTurns[sessionId!] ?? emptyLiveTurn(null, "pending");
        return {
          currentRequestId: requestId,
          liveTurns: {
            ...state.liveTurns,
            [sessionId!]: { ...turn, turnId: requestId },
          },
        };
      });
    } catch {
      set((state) => {
        const liveTurns = { ...state.liveTurns };
        delete liveTurns[sessionId!];
        return { isStreaming: hasLiveTurns(liveTurns), currentRequestId: null, liveTurns };
      });
    }
  },

  regenerateMessage: async (messageId) => {
    const state = get();
    const sessionId = state.activeSessionId;
    const session = state.sessions.find((item) => item.id === sessionId);
    const message = session?.messages.find((item) => item.id === messageId && item.role === "user");
    if (!sessionId || !message || liveTurnIsActive(state.liveTurns[sessionId])) return;
    await get().editAndResendMessage(messageId, message.content);
  },

  editAndResendMessage: async (messageId, text) => {
    const sessionId = get().activeSessionId;
    if (!sessionId || liveTurnIsActive(get().liveTurns[sessionId])) return;
    const trimmed = text.trim();
    if (!trimmed) return;

    set((state) => ({
      isStreaming: true,
      liveTurns: {
        ...state.liveTurns,
        [sessionId]: withLiveTurnWorkspace(state, sessionId, state.liveTurns[sessionId] ?? emptyLiveTurn(null, "pending")),
      },
      sessions: state.sessions.map((session) => {
        if (session.id !== sessionId) return session;
        const index = session.messages.findIndex((message) => message.id === messageId);
        if (index < 0) return session;
        const kept = session.messages.slice(0, index);
        const now = Date.now();
        return {
          ...session,
          updatedAt: now,
          messages: [
            ...kept,
            {
              id: messageId,
              role: "user",
              content: trimmed,
              blocks: [{ id: `${messageId}-text`, type: "text", text: trimmed }],
              createdAt: now,
              items: [],
            },
          ],
        };
      }),
    }));

    try {
      const { requestId } = await window.marloues.chat.resendFromMessage({
        sessionId,
        fromMessageId: messageId,
        text: trimmed,
      });
      set({ currentRequestId: requestId });
    } catch {
      set((state) => {
        const liveTurns = { ...state.liveTurns };
        delete liveTurns[sessionId];
        return { isStreaming: hasLiveTurns(liveTurns), currentRequestId: null, liveTurns };
      });
      await get().load();
    }
  },

  abort: async (sessionId) => {
    const state = get();
    const targetSessionId = sessionId ?? state.activeSessionId;
    const targetTurnId = targetSessionId ? state.liveTurns[targetSessionId]?.turnId : undefined;
    const requestId = targetTurnId ?? state.currentRequestId;
    try {
      await window.marloues.chat.abort(requestId ?? targetSessionId ?? "");
    } catch {
      // ignore
    }
    set((current) => {
      if (!targetSessionId) return { isStreaming: false, currentRequestId: null };
      const liveTurns = { ...current.liveTurns };
      delete liveTurns[targetSessionId];
      return {
        isStreaming: hasLiveTurns(liveTurns),
        currentRequestId: current.currentRequestId === requestId ? null : current.currentRequestId,
        liveTurns,
      };
    });
  },

  setInputText: (text) => set((state) => {
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

  handleItemEvent: (event) => {
    const sessionId = event.sessionId;
    if (!sessionId) return;

    // turn.start: create an assistant message placeholder.
    if (event.type === "turn.start") {
      set((state) => ({
        isStreaming: true,
        currentRequestId: event.turnId,
        liveTurns: {
          ...state.liveTurns,
          [sessionId]: withLiveTurnWorkspace(state, sessionId, {
            ...(state.liveTurns[sessionId] ?? emptyLiveTurn(event.turnId, "pending")),
            turnId: event.turnId,
            status: "running",
            startedAt: event.startedAt ?? Date.now(),
            modelId: event.modelId,
            modelName: event.modelName,
          }),
        },
        sessions: state.sessions.map((s) => {
          if (s.id !== sessionId) return s;
          const assistantId = `assistant-${event.turnId}`;
          const assistantMsg: Message = {
            id: assistantId,
            role: "assistant",
            content: "",
            timestamp: event.startedAt ?? Date.now(),
            status: "thinking",
            items: [],
          };
          return {
            ...s,
            messages: [
              ...s.messages,
              {
                id: assistantMsg.id,
                role: "assistant",
                content: "",
                blocks: [],
                createdAt: assistantMsg.timestamp,
                items: [],
                startedAt: assistantMsg.timestamp,
                modelId: event.modelId,
                modelName: event.modelName,
              },
            ],
          };
        }),
      }));
      return;
    }

    // item.updated: append or update assistant message items.
    if (event.type === "item.updated" && event.item) {
      const messageId = `assistant-${event.turnId}`;
      set((state) => ({
        sessions: state.sessions.map((s) => {
          if (s.id !== sessionId) return s;
          return {
            ...s,
            updatedAt: Date.now(),
            messages: s.messages.map((m) => {
              if (m.id !== messageId) return m;
              const items = mergeItem(m.items, event.item!);
              const text = assistantTextFromItems(items);
              return {
                ...m,
                items,
                content: text,
                blocks: text ? [{ id: `${m.id}-text`, type: "text" as const, text }] : m.blocks,
              };
            }),
          };
        }),
      }));
      return;
    }

    // turn.complete: 标记 assistant message 完成
    if (event.type === "turn.complete") {
      set((state) => {
        const liveTurns = { ...state.liveTurns };
        delete liveTurns[sessionId];
        return {
          isStreaming: hasLiveTurns(liveTurns),
          currentRequestId: state.currentRequestId === event.turnId ? null : state.currentRequestId,
          liveTurns,
          sessions: state.sessions.map((s) => {
          if (s.id !== sessionId) return s;
          return {
            ...s,
            messages: s.messages.map((m) => {
              if (m.id !== `assistant-${event.turnId}`) return m;
              return {
                ...m,
                completedAt: event.completedAt ?? Date.now(),
                modelId: state.liveTurns[sessionId]?.modelId ?? m.modelId,
                modelName: state.liveTurns[sessionId]?.modelName ?? m.modelName,
                usage: event.usage ?? state.liveTurns[sessionId]?.usage ?? m.usage,
                isError: event.result === "error",
              };
            }),
          };
          }),
        };
      });
      return;
    }
  },

  loadReadThread: async (sessionId) => {
    try {
      const snapshot = await window.marloues.chat.readThread(sessionId);
      if (!snapshot) return;
      set((state) => reconcileReadThreadSnapshot(state, snapshot));
    } catch {
      // Canonical readThread is optional; legacy workflowMessages remains the fallback.
    }
  },

  handleReadThread: (snapshot) => {
    if (!snapshot) return;
    set((state) => reconcileReadThreadSnapshot(state, snapshot));
  },

  continueContextAction: async () => {
    const state = get();
    const request = state.contextActionRequest;
    const sessionId = request?.sessionId ?? state.activeSessionId;
    const session = state.sessions.find((item) => item.id === sessionId);
    const userMessage = [...(session?.messages ?? [])].reverse().find((message) => message.role === "user");
    if (!sessionId || !userMessage || liveTurnIsActive(state.liveTurns[sessionId])) return;

    set((current) => ({
      isStreaming: true,
      contextActionRequest: null,
      liveTurns: {
        ...current.liveTurns,
        [sessionId]: {
          ...(current.liveTurns[sessionId] ?? emptyLiveTurn(null, "pending")),
          status: "running",
          contextBlocked: false,
        },
      },
    }));

    try {
      const requestId = await window.marloues.chat.send({
        sessionId,
        text: userMessage.content,
        clientMessageId: userMessage.id,
        forceSend: true,
      });
      set((current) => {
        const turn = current.liveTurns[sessionId] ?? emptyLiveTurn(null, "pending");
        return {
          currentRequestId: requestId,
          liveTurns: {
            ...current.liveTurns,
            [sessionId]: { ...turn, turnId: requestId },
          },
        };
      });
    } catch {
      set((current) => {
        const liveTurns = { ...current.liveTurns };
        delete liveTurns[sessionId];
        return { isStreaming: hasLiveTurns(liveTurns), currentRequestId: null, liveTurns };
      });
    }
  },

  clearContextActionRequest: () =>
    set((state) => {
      const request = state.contextActionRequest;
      if (!request) return { contextActionRequest: null };
      const turn = state.liveTurns[request.sessionId];
      if (!turn || turn.content.trim() || turn.blocks.length > 0 || turn.status !== "completed") {
        return { contextActionRequest: null };
      }
      const liveTurns = { ...state.liveTurns };
      delete liveTurns[request.sessionId];
      return { contextActionRequest: null, liveTurns };
    }),

  handleEvent: (event) => {
    if (!("sessionId" in event)) return;
    const sessionId = event.sessionId;
    if (!sessionId) return;

    if (event.type === "turn.start") {
      set((state) => {
        const turn = withLiveTurnWorkspace(state, sessionId, state.liveTurns[sessionId] ?? emptyLiveTurn(event.turnId, "pending"));
        return {
          currentRequestId: event.turnId,
          isStreaming: true,
          liveTurns: {
            ...state.liveTurns,
            [sessionId]: {
              ...turn,
              turnId: event.turnId,
              status: "running",
              startedAt: event.timestamp,
              compactionSettled: false,
              contextBlocked: false,
              timeline: upsertTimeline(turn.timeline, {
                id: `turn-${event.turnId}`,
                type: "status",
                label: "Task started",
                detail: event.turnId,
                createdAt: event.timestamp,
                status: "running",
              }),
            },
          },
        };
      });
      return;
    }

    if (event.type === "turn.complete" && event.result === "aborted") {
      set((state) => {
        const turn = state.liveTurns[sessionId];
        if (!turn || (turn.turnId && turn.turnId !== event.turnId)) {
          return state.currentRequestId === event.turnId ? { isStreaming: hasLiveTurns(state.liveTurns), currentRequestId: null } : {};
        }
        const liveTurns = { ...state.liveTurns };
        delete liveTurns[sessionId];
        return { isStreaming: hasLiveTurns(liveTurns), currentRequestId: null, liveTurns };
      });
      return;
    }

    if (event.type === "context.compaction") {
      set((state) => {
        const turn = state.liveTurns[sessionId] ?? emptyLiveTurn(event.turnId ?? null, "running");
        if (event.phase === "blocked") {
          const liveTurns: Record<string, LiveTurn | undefined> = {
            ...state.liveTurns,
            [sessionId]: {
              ...turn,
              turnId: turn.turnId ?? event.turnId ?? null,
              status: "completed",
              compactionActive: false,
              compactionSettled: false,
              contextBlocked: true,
              timeline: upsertTimeline(turn.timeline, {
                id: `context-blocked-${event.reason}-${event.turnId ?? "preflight"}`,
                type: "status",
                label: "Context needs attention",
                detail: event.message ?? event.actionRequest?.detail,
                createdAt: Date.now(),
                status: "completed",
              }),
            },
          };
          return {
            isStreaming: hasLiveTurns(liveTurns),
            currentRequestId: null,
            liveTurns,
            contextActionRequest: event.actionRequest ?? state.contextActionRequest,
          };
        }
        return {
          isStreaming: event.phase === "started" ? true : state.isStreaming,
          liveTurns: {
            ...state.liveTurns,
            [sessionId]: {
              ...turn,
              turnId: turn.turnId ?? event.turnId ?? null,
              status: event.phase === "started" ? "running" : turn.status,
              compactionActive: event.phase === "started",
              compactionSettled: event.phase === "completed",
              contextBlocked: false,
              timeline:
                event.phase === "started"
                  ? upsertTimeline(turn.timeline, {
                      id: `context-compaction-${event.reason}-${event.turnId ?? "preflight"}`,
                      type: "status",
                      label: "Automatic context compaction",
                      detail: event.message,
                      createdAt: Date.now(),
                      status: "running",
                    })
                  : turn.timeline,
            },
          },
        };
      });
      return;
    }

    if (event.type === "text.chunk") {
      set((state) => {
        if (shouldIgnoreRuntimeEvent(state, event)) return {};
        const turn = state.liveTurns[sessionId] ?? emptyLiveTurn(event.turnId, "running");
        if (turn.turnId && turn.turnId !== event.turnId) return {};
        const content = turn.content + event.content;
        return {
          liveTurns: {
            ...state.liveTurns,
            [sessionId]: {
              ...turn,
              turnId: event.turnId,
              content,
              blocks: appendTextBlock(turn.blocks, event.content),
              compactionSettled: false,
            },
          },
        };
      });
      return;
    }

    if (
      event.type === "session.info" ||
      event.type === "mcp.status" ||
      event.type === "memory.recall" ||
      event.type === "context.usage" ||
      event.type === "context.warning" ||
      event.type === "runtime.status" ||
      event.type === "prompt.suggestion"
    ) {
      set((state) => {
        if (shouldIgnoreRuntimeEvent(state, event)) return {};
        const turn = state.liveTurns[sessionId] ?? emptyLiveTurn(event.turnId, "running");
        if (turn.turnId && turn.turnId !== event.turnId) return {};
        const item: TimelineItem =
          event.type === "session.info"
            ? {
                id: `session-info-${event.turnId}`,
                type: "status",
                label: "Session initialized",
                detail: JSON.stringify({ skills: event.skills, slashCommands: event.slashCommands, agents: event.agents }, null, 2),
                createdAt: Date.now(),
                status: "completed",
              }
            : event.type === "mcp.status"
              ? {
                  id: `mcp-status-${event.turnId}`,
                  type: "status",
                  label: "MCP servers loaded",
                  detail: JSON.stringify({ servers: event.servers, tools: event.tools ?? [] }, null, 2),
                  createdAt: Date.now(),
                  status: "completed",
                }
              : event.type === "memory.recall"
                ? {
                    id: `memory-recall-${event.turnId}`,
                    type: "memory_recall",
                    label: event.mode === "synthesize" ? "Memory synthesized" : "Memory recalled",
                    detail: JSON.stringify(event.memories, null, 2),
                    createdAt: Date.now(),
                    status: "completed",
                  }
                : event.type === "context.usage"
                  ? {
                      id: `context-usage-${event.phase ?? "usage"}-${event.turnId}`,
                      type: "status",
                      label: event.phase === "turn_start" ? "Context at turn start" : "Context at turn end",
                      detail: JSON.stringify(event.usage ?? { percentage: event.percentage, limit: event.limit }, null, 2),
                      createdAt: Date.now(),
                      status: event.percentage !== undefined && event.percentage >= 90 ? "error" : "completed",
                    }
                  : event.type === "context.warning"
                    ? {
                        id: `context-warning-${event.level}-${event.turnId}`,
                        type: "status",
                        label:
                          event.level === "critical"
                            ? "Context runtime restart scheduled"
                            : event.level === "high"
                              ? "Context compaction watch"
                              : "Context warning",
                        detail: event.message,
                        createdAt: Date.now(),
                        status: event.level === "critical" ? "error" : "completed",
                      }
                    : {
                        id: event.type === "runtime.status" ? (event.id ?? `${event.type}-${event.turnId}`) : `${event.type}-${event.turnId}`,
                        type: "status",
                        label: event.type === "prompt.suggestion" ? "Prompt suggestion" : event.label,
                        detail: event.type === "prompt.suggestion" ? event.suggestion : event.detail,
                        createdAt: Date.now(),
                        status: event.type === "prompt.suggestion" ? "completed" : event.status,
                      };
        const usage = event.type === "context.usage" ? mergeTokenUsageLimit(turn.usage, event.limit) : turn.usage;
        return {
          liveTurns: {
            ...state.liveTurns,
            [sessionId]: {
              ...turn,
              turnId: event.turnId,
              status: mergeLiveTurnRuntimeStatus(turn.status, "running"),
              timeline: upsertTimeline(turn.timeline, item),
              usage,
              compactionSettled: false,
            },
          },
        };
      });
      return;
    }

    if (
      event.type === "thinking.chunk" ||
      event.type === "tool.start" ||
      event.type === "tool.progress" ||
      event.type === "tool.complete"
    ) {
      set((state) => {
        if (shouldIgnoreRuntimeEvent(state, event)) return {};
        const turn = state.liveTurns[sessionId] ?? emptyLiveTurn(event.turnId, "running");
        if (turn.turnId && turn.turnId !== event.turnId) return {};
        if (event.type === "tool.progress") {
          const existing = turn.timeline.find((entry) => entry.id === event.toolId && entry.type === "tool_start");
          if (existing) {
            const updated: TimelineItem = {
              ...existing,
              detail: JSON.stringify(event.input ?? event.partialInput, null, 2),
              status: event.isReady ? "running" : "pending",
              toolName: event.toolName,
              toolInput: event.input ?? event.partialInput,
            };
            return {
              liveTurns: {
                ...state.liveTurns,
                [sessionId]: {
                  ...turn,
                  turnId: event.turnId,
                  blocks: upsertToolCallBlock(turn.blocks, event.toolId, event.toolName, event.input ?? event.partialInput, event.isReady ? "running" : "pending"),
                  timeline: upsertTimeline(turn.timeline, updated),
                  compactionSettled: false,
                },
              },
            };
          }
        }
        const sourceTool =
          "toolId" in event ? turn.timeline.find((entry) => entry.id === event.toolId && entry.toolName) : undefined;
        const item: TimelineItem =
          event.type === "thinking.chunk"
            ? { id: `thinking-${Date.now()}`, type: "thinking", label: "Reasoning", detail: event.content, createdAt: Date.now() }
            : event.type === "tool.start"
              ? {
                  id: event.toolId,
                  type: "tool_start",
                  label: event.toolName,
                  detail: JSON.stringify(event.input ?? {}, null, 2),
                  createdAt: Date.now(),
                  status: "running",
                  toolName: event.toolName,
                  toolInput: event.input ?? {},
                }
              : event.type === "tool.progress"
                ? {
                    id: event.toolId,
                    type: "tool_delta",
                    label: `${event.toolName} 输入`,
                    detail: JSON.stringify(event.input ?? event.partialInput, null, 2),
                    createdAt: Date.now(),
                    status: event.isReady ? "running" : "pending",
                    toolName: event.toolName,
                    toolInput: event.input ?? event.partialInput,
                  }
                : {
                    id: event.toolId,
                    type: "tool_result",
                    label: event.isError ? "Tool error" : "Tool result",
                    detail: typeof event.output === "string" ? event.output : JSON.stringify(event.output, null, 2),
                    createdAt: Date.now(),
                    status: event.isError ? "error" : "completed",
                    isError: event.isError,
                    toolName: sourceTool?.toolName,
                    toolInput: sourceTool?.toolInput,
                    toolOutput: event.output,
                  };
        return {
          liveTurns: {
            ...state.liveTurns,
            [sessionId]: {
              ...turn,
              turnId: event.turnId,
              blocks: updateBlocksForRuntimeEvent(turn.blocks, event, sourceTool),
              timeline: event.type === "thinking.chunk" ? [...turn.timeline, item] : upsertTimeline(turn.timeline, item),
              compactionSettled: false,
            },
          },
        };
      });
      return;
    }

    if (event.type === "usage") {
      set((state) => {
        if (shouldIgnoreRuntimeEvent(state, event)) return {};
        const turn = state.liveTurns[sessionId] ?? emptyLiveTurn(event.turnId, "running");
        if (turn.turnId && turn.turnId !== event.turnId) return {};
        const usage = mergeTokenUsageLimit(event.usage, turn.usage?.limitTokens);
        return {
          liveTurns: {
            ...state.liveTurns,
            [sessionId]: { ...turn, turnId: event.turnId, usage },
          },
        };
      });
      return;
    }

    if (event.type === "turn.complete" && event.result !== "aborted") {
      set((state) => {
        if (shouldIgnoreRuntimeEvent(state, event)) return {};
        const turn = state.liveTurns[sessionId] ?? emptyLiveTurn(event.turnId, event.result === "error" ? "error" : "completed");
        if (turn.turnId && turn.turnId !== event.turnId) return {};
        const liveTurns = { ...state.liveTurns };
        delete liveTurns[sessionId];
        const finalTimeline = upsertTimeline(
          upsertTimeline(turn.timeline, {
            id: `turn-${event.turnId}`,
            type: "status",
            label: "Task started",
            detail: event.turnId,
            createdAt: turn.startedAt,
            status: "running",
          }),
          {
            id: `result-${event.turnId}`,
            type: event.result === "error" ? "error" : "status",
            label: event.result === "error" ? "Task failed" : "Task complete",
            detail: event.result === "error" ? event.error : event.content,
            createdAt: Date.now(),
            status: event.result === "error" ? "error" : "completed",
            isError: event.result === "error",
          },
        );
        return {
          isStreaming: hasLiveTurns(liveTurns),
          currentRequestId: state.currentRequestId === event.turnId ? null : state.currentRequestId,
          liveTurns,
          sessions: state.sessions.map((session) =>
            session.id === sessionId
              ? {
                  ...session,
                  sdkSessionId:
                    event.result === "success" ? (event.sdkSessionId ?? session.sdkSessionId) : session.sdkSessionId,
                  messages: session.messages.map((message) =>
                    message.id === `assistant-${event.turnId}`
                      ? { ...message, timeline: finalTimeline, usage: turn.usage, isError: event.result === "error" }
                      : message,
                  ),
                  updatedAt: Date.now(),
                }
              : session,
            ),
        };
      });
      void get().loadReadThread(sessionId);
    }
  },

  getWorkflowMessages: () => {
    const state = get();
    const session = state.sessions.find((s) => s.id === state.activeSessionId);
    if (!session) return [];
    return activeWorkflowMessages(state, session);
  },

  getActiveReadThreadModel: () => {
    const state = get();
    const activeSessionId = state.activeSessionId;
    const session = state.sessions.find((s) => s.id === activeSessionId);
    if (!activeSessionId || !session) return null;

    const readThread = state.readThreads[activeSessionId];
    const workflowMessages = activeWorkflowMessages(state, session);
    const fallbackReadThread = workflowMessages.length
      ? workflowMessagesToWorkflowReadThreadResponse(workflowMessages, {
          threadId: session.id,
          title: session.title,
          preview: session.messages.at(-1)?.content ?? session.title,
          cwd: session.workspacePath ?? null,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
        })
      : null;
    const activeSessionIsStreaming = liveTurnIsActive(state.liveTurns[activeSessionId]);
    const readThreadHasRunningTurn = Boolean(readThread?.turns.some((turn) => turn.status === "running"));

    if (readThread && (!activeSessionIsStreaming || readThreadHasRunningTurn || !fallbackReadThread)) {
      return readThread;
    }
    return fallbackReadThread;
  },
}));

function activeWorkflowMessages(state: UnifiedChatStore, session: ChatSessionRecord): WorkflowMessageBlock[] {
  const activeSessionId = state.activeSessionId;
  const workflowMessages = buildWorkflowMessages(
    session.messages.map(toWorkflowMessage),
    activeSessionId ? liveTurnIsActive(state.liveTurns[activeSessionId]) : false,
  );
  const liveTurn = activeSessionId ? state.liveTurns[activeSessionId] : undefined;
  return liveTurn ? mergeLiveTurnIntoWorkflowMessages(workflowMessages, liveTurn) : workflowMessages;
}

function mergeLiveTurnIntoWorkflowMessages(
  workflowMessages: WorkflowMessageBlock[],
  liveTurn: LiveTurn,
): WorkflowMessageBlock[] {
  const liveItems = liveTurnItems(liveTurn);
  const next = [...workflowMessages];
  const last = next[next.length - 1];
  const startedAt = liveTurn.startedAt || last?.startedAt || Date.now();
  const activity = liveTurnActivity(liveTurn, liveItems);
  const status = liveTurn.status === "error" ? "failed" : liveTurn.status === "completed" ? "completed" : "running";

  if (!liveItems.length && !liveTurn.usage && !last) return workflowMessages;

  if (!last) {
    return [{
      id: liveTurn.turnId ?? `live-${startedAt}`,
      user: "",
      userContent: [],
      status,
      activity,
      startedAt,
      durationMs: null,
      modelId: liveTurn.modelId,
      modelName: liveTurn.modelName,
      usage: liveTurn.usage,
      items: liveItems,
    }];
  }

  const merged: WorkflowMessageBlock = {
    ...last,
    id: last.id,
    status,
    activity,
    startedAt,
    completedAt: liveTurn.status === "completed" ? Date.now() : last.completedAt,
    durationMs: liveTurn.status === "completed" ? Math.max(0, Date.now() - startedAt) : null,
    modelId: liveTurn.modelId ?? last.modelId,
    modelName: liveTurn.modelName ?? last.modelName,
    usage: liveTurn.usage ?? last.usage,
    items: mergeWorkflowItems(last.items, liveItems),
  };

  next[next.length - 1] = merged;
  return next;
}

function liveTurnItems(liveTurn: LiveTurn): WorkflowTurnItem[] {
  const items: WorkflowTurnItem[] = [];
  const tools = new Map<string, Extract<WorkflowTurnItem, { type: "dynamicToolCall" }>>();

  for (const entry of liveTurn.timeline) {
    if (entry.type === "thinking" && entry.detail?.trim()) {
      items.push({
        type: "reasoning",
        id: entry.id,
        summary: entry.detail,
        content: [{ text: entry.detail }],
      });
      continue;
    }

    if (entry.type === "tool_start" || entry.type === "tool_delta" || entry.type === "tool_result") {
      const tool = tools.get(entry.id) ?? {
        type: "dynamicToolCall",
        id: entry.id,
        tool: entry.toolName ?? entry.label ?? "tool_call",
        arguments: entry.toolInput,
        status: entry.status ?? (entry.type === "tool_result" ? "completed" : "running"),
      };
      const updated: Extract<WorkflowTurnItem, { type: "dynamicToolCall" }> = {
        ...tool,
        tool: entry.toolName ?? tool.tool,
        arguments: entry.toolInput ?? tool.arguments,
        status: entry.status ?? tool.status,
        success: entry.type === "tool_result" ? !entry.isError : tool.success,
        output: entry.type === "tool_result" && entry.detail ? { text: entry.detail } : tool.output,
      };
      tools.set(entry.id, updated);
      if (!items.some((item) => item.id === entry.id)) items.push(updated);
      else replaceWorkflowItem(items, updated);
      continue;
    }

    if ((entry.type === "status" || entry.type === "memory_recall" || entry.type === "error") && (entry.label || entry.detail)) {
      if (entry.type !== "error" && isPassiveLiveStatusName(entry.label)) continue;
      items.push({
        type: "dynamicToolCall",
        id: entry.id,
        tool: entry.label || entry.type,
        arguments: entry.detail,
        status: entry.status ?? (entry.type === "error" || entry.isError ? "error" : "completed"),
        success: !(entry.type === "error" || entry.isError),
        output: entry.detail ? { text: entry.detail } : undefined,
      });
    }
  }

  for (const block of liveTurn.blocks) {
    if (block.type === "thinking" && block.text.trim()) {
      items.push({
        type: "reasoning",
        id: block.id,
        summary: block.text,
        content: [{ text: block.text }],
      });
      continue;
    }

    if (block.type === "tool_call") {
      const item: WorkflowTurnItem = {
        type: "dynamicToolCall",
        id: block.tool.id,
        tool: block.tool.name,
        arguments: block.tool.input,
        status: block.tool.status ?? "running",
      };
      if (!items.some((entry) => entry.id === item.id)) items.push(item);
      continue;
    }

    if (block.type === "tool_result") {
      const existing = items.find(
        (entry): entry is Extract<WorkflowTurnItem, { type: "dynamicToolCall" }> =>
          entry.id === block.result.id && entry.type === "dynamicToolCall",
      );
      const output = formatWorkflowOutput(block.result.output);
      if (existing) {
        replaceWorkflowItem(items, {
          ...existing,
          tool: block.result.toolName ?? existing.tool,
          status: block.result.isError ? "error" : "completed",
          success: !block.result.isError,
          output: output ? { text: output } : existing.output,
        });
      } else {
        items.push({
          type: "dynamicToolCall",
          id: block.result.id,
          tool: block.result.toolName ?? "tool_result",
          status: block.result.isError ? "error" : "completed",
          success: !block.result.isError,
          output: output ? { text: output } : undefined,
        });
      }
      continue;
    }

    if (block.type === "error") {
      items.push({
        type: "dynamicToolCall",
        id: block.id,
        tool: "error",
        arguments: {},
        status: "error",
        success: false,
        output: { text: block.message },
      });
    }
  }

  const text = liveTurn.content.trim();
  if (text) {
    items.push({
      type: "agentMessage",
      id: liveTurn.turnId ? `live-agent-${liveTurn.turnId}` : "live-agent-message",
      text,
      phase: liveTurn.status === "completed" ? "completed" : "running",
    });
  }

  return items;
}

function mergeWorkflowItems(existing: WorkflowTurnItem[], liveItems: WorkflowTurnItem[]): WorkflowTurnItem[] {
  const merged = [...existing];
  for (const item of liveItems) {
    replaceWorkflowItem(merged, item);
  }
  return merged;
}

function replaceWorkflowItem(items: WorkflowTurnItem[], item: WorkflowTurnItem): void {
  const index = items.findIndex((entry) => entry.id === item.id && entry.type === item.type);
  if (index >= 0) items[index] = item;
  else items.push(item);
}

function liveTurnActivity(liveTurn: LiveTurn, items: WorkflowTurnItem[]): WorkflowMessageBlock["activity"] {
  if (liveTurn.status === "error") return "failed";
  if (liveTurn.status === "completed") return "done";
  if (items.some((item) => item.type === "agentMessage" && item.text.trim())) return "responding";
  if (items.some(isLiveProcessingItem)) return "running";
  return "thinking";
}

function isLiveProcessingItem(item: WorkflowTurnItem): boolean {
  if (item.type !== "dynamicToolCall" && item.type !== "mcpToolCall" && item.type !== "commandExecution") {
    return false;
  }
  const name = item.type === "commandExecution" ? "commandExecution" : item.type === "mcpToolCall" ? item.tool : item.tool;
  if (isPassiveLiveStatusName(name)) return false;
  return item.status === "running" || item.status === "pending";
}

function isPassiveLiveStatusName(name: string): boolean {
  return [
    "Task started",
    "Context at turn start",
    "Context at turn end",
    "Session initialized",
    "MCP servers loaded",
    "Prompt suggestion",
    "Context warning",
    "Context compaction watch",
    "Context runtime restart scheduled",
  ].includes(name);
}

function formatWorkflowOutput(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return String(value);
  }
}

function shouldIgnoreRuntimeEvent(state: UnifiedChatStore, event: UIEvent): boolean {
  if (!("sessionId" in event) || !("turnId" in event) || !event.turnId || event.type === "turn.start") return false;
  if (!event.sessionId) return false;
  const liveTurn = state.liveTurns[event.sessionId];
  if (liveTurn?.contextBlocked) return true;
  if (liveTurn) return false;
  return state.currentRequestId !== event.turnId;
}

function upsertTimeline(timeline: TimelineItem[], item: TimelineItem): TimelineItem[] {
  const index = timeline.findIndex((entry) => entry.id === item.id && entry.type === item.type);
  if (index < 0) return [...timeline, item];
  const next = [...timeline];
  next[index] = {
    ...next[index],
    ...item,
    createdAt: next[index].createdAt,
  };
  return next;
}

function appendTextBlock(blocks: MessageBlock[], delta: string): MessageBlock[] {
  const next = [...blocks];
  const last = next[next.length - 1];
  if (last?.type === "text") {
    next[next.length - 1] = { ...last, text: last.text + delta };
    return next;
  }
  return [...next, { id: `text-${Date.now()}-${Math.random().toString(36).slice(2)}`, type: "text", text: delta }];
}

function mergeTokenUsageLimit(usage: TokenUsage | undefined, limitTokens: number | undefined): TokenUsage | undefined {
  if (limitTokens === undefined || !Number.isFinite(limitTokens) || limitTokens <= 0) return usage;
  return { ...(usage ?? {}), limitTokens };
}

function appendThinkingBlock(blocks: MessageBlock[], delta: string): MessageBlock[] {
  const next = [...blocks];
  const last = next[next.length - 1];
  if (last?.type === "thinking") {
    next[next.length - 1] = { ...last, text: last.text + delta };
    return next;
  }
  return [
    ...next,
    { id: `thinking-${Date.now()}-${Math.random().toString(36).slice(2)}`, type: "thinking", text: delta },
  ];
}

function upsertToolCallBlock(
  blocks: MessageBlock[],
  id: string,
  name: string,
  input: unknown,
  status: NonNullable<Extract<MessageBlock, { type: "tool_call" }>["tool"]["status"]>,
): MessageBlock[] {
  const index = blocks.findIndex((block) => block.type === "tool_call" && block.tool.id === id);
  const block: MessageBlock = { id: `tool-${id}`, type: "tool_call", tool: { id, name, input, status } };
  if (index < 0) return [...blocks, block];
  const next = [...blocks];
  next[index] = block;
  return next;
}

function appendToolResultBlock(
  blocks: MessageBlock[],
  id: string,
  toolName: string | undefined,
  output: unknown,
  isError?: boolean,
): MessageBlock[] {
  const resultBlock: MessageBlock = {
    id: `tool-result-${id}`,
    type: "tool_result",
    result: { id, toolName, output, isError },
  };
  return [...blocks, resultBlock];
}

function updateBlocksForRuntimeEvent(
  blocks: MessageBlock[],
  event: Extract<UIEvent, { type: "thinking.chunk" | "tool.start" | "tool.progress" | "tool.complete" }>,
  sourceTool?: TimelineItem,
): MessageBlock[] {
  if (event.type === "thinking.chunk") return appendThinkingBlock(blocks, event.content);
  if (event.type === "tool.start")
    return upsertToolCallBlock(blocks, event.toolId, event.toolName, event.input ?? {}, "running");
  if (event.type === "tool.progress")
    return upsertToolCallBlock(
      blocks,
      event.toolId,
      event.toolName,
      event.input ?? event.partialInput,
      event.isReady ? "running" : "pending",
    );
  return appendToolResultBlock(blocks, event.toolId, sourceTool?.toolName, event.output, event.isError);
}

function mergeItem(items: MessageItem[], newItem: MessageItem): MessageItem[] {
  const idx = items.findIndex((i) => i.id === newItem.id);
  if (idx < 0) return [...items, newItem];
  const next = [...items];
  next[idx] = {
    ...next[idx],
    ...newItem,
    text: newItem.text ?? next[idx].text,
    args: newItem.args && Object.keys(newItem.args as object).length > 0 ? newItem.args : next[idx].args,
    arguments: newItem.arguments && Object.keys(newItem.arguments as object).length > 0 ? newItem.arguments : next[idx].arguments,
    result: newItem.result ?? next[idx].result,
    status: newItem.status ?? next[idx].status,
  };
  return next;
}
