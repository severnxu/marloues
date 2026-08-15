/**
 * Unified chat store — type definitions.
 *
 * All exported interfaces live here so that consumers can import them
 * from the store barrel (`unified-chat-store.ts`) while internal slice
 * files import from this module directly.
 */

import type {
  ChatSessionRecord,
  ContextActionRequest,
  ContextUsageRecord,
  AgentPermissionMode,
  AgentWorkMode,
  ChatSendReceipt,
  PendingStateSnapshot,
  TimelineItem,
  TokenUsage,
} from "@shared/types";
import type { UIEvent } from "@shared/ui-protocol";
import type {
  WorkflowReadThreadResponse,
  WorkflowTurnItem,
} from "@shared/workflow-read-thread-contract";
import type { UserMessageContent } from "../../types";

export interface ItemEvent {
  type: string;
  sessionId: string;
  turnId: string;
  startedAt?: number;
  completedAt?: number;
  final?: boolean;
  result?: string;
  error?: string;
  usage?: TokenUsage;
  modelId?: string;
  modelName?: string;
  item?: WorkflowTurnItem;
  items?: WorkflowTurnItem[];
  /** item 变更前的快照（新建/首帧时为 undefined），供投影层做增量 diff。 */
  prevItem?: WorkflowTurnItem;
}

export interface ExecutionTaskRecord {
  id: string;
  turnId?: string;
  ordinal: number;
  title: string;
  detail?: string;
  agentType?: string;
  prompt?: string;
  taskType?: string;
  blockedBy?: string[];
  status: "creating" | "running" | "completed" | "failed";
  parentToolId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ExecutionSubagentRecord {
  id: string;
  parentToolId: string;
  taskId?: string;
  ordinal: number;
  agentType?: string;
  agentName?: string;
  description?: string;
  prompt?: string;
  title?: string;
  iconSeed: string;
  status: "creating" | "running" | "completed" | "failed";
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  events: UIEvent[];
  timeline: TimelineItem[];
  text: string;
}

export interface ExecutionSessionState {
  tasks: Record<string, ExecutionTaskRecord>;
  subagents: Record<string, ExecutionSubagentRecord>;
  selectedSubagentId?: string;
  revealSubagentSeq?: number;
}

export interface SessionInitInfo {
  slashCommands: string[];
  skills: string[];
  agents: string[];
  mcpTools?: string[];
  mcpServers?: Array<{ name: string; status?: string; error?: string }>;
  mcpUpdatedAt?: number;
}

export interface PendingSteerPreview {
  id: string;
  sessionId: string;
  turnId?: string | null;
  text: string;
  createdAt: number;
  status: "queued" | "applying" | "sent";
  attachments?: UserMessageContent[];
}

export interface PlanImplementationPrompt {
  sessionId: string;
  turnId: string;
  planText: string;
}

export interface SendMessageOptions {
  deliveryMode?: "normal" | "steer";
  workMode?: AgentWorkMode;
  permissionMode?: AgentPermissionMode;
}

/** sendMessage 结果：投递是否被处理（ok），及降级/失败原因。UI 据此决定是否清输入。 */
export interface SendResult {
  ok: boolean;
  /** steer 不可用时降级为新 turn 投递（消息未丢，仅投递方式变化）。 */
  downgraded?: boolean;
  reason?: string;
}

export interface UnifiedChatStore {
  sessions: ChatSessionRecord[];
  activeSessionId: string | null;
  visibleSessionId: string | null;
  unreadCompletedSessionIds: Set<string>;
  isStreaming: boolean;
  currentRequestId: string | null;
  contextActionRequest: ContextActionRequest | null;
  /** Per-session streaming flag set synchronously at sendMessage time.
   * Bridges the 250ms snapshot throttle gap: the page reads this instead of
   * checking the readThread snapshot to know whether the active session
   * is streaming. */
  streamingSessionIds: Record<string, true | undefined>;
  contextUsage: Record<string, ContextUsageRecord | undefined>;
  /** Per-turn context-usage snapshots keyed by sessionId then message id
   * (assistant-<turnId>). Populated from the turn_end context.usage probe so
   * the footer gauge reflects the context occupancy captured at that turn.
   * Cold-loaded turns carry contextUsage directly on the message instead. */
  turnContextUsage: Record<
    string,
    Record<string, ContextUsageRecord | undefined>
  >;
  readThreads: Record<string, WorkflowReadThreadResponse | undefined>;
  /** Per-session pagination state for upward "load more" loading. */
  readThreadPaging: Record<
    string,
    | {
        cursor: string | null;
        hasMore: boolean;
        loading: boolean;
        loadingMore: boolean;
      }
    | undefined
  >;
  inputDrafts: Record<string, string | undefined>;
  inputText: string;
  /** Increments for repeated new-session navigation even while activeSessionId stays null. */
  composerEpoch: number;
  sessionInitInfo: Record<string, SessionInitInfo | undefined>;
  executionBySession: Record<string, ExecutionSessionState | undefined>;
  pendingSteers: Record<string, PendingSteerPreview[] | undefined>;
  /** 会话级 steer 队列暂停标记：用户手动停止（interrupted）且队列非空时置 true，
   * 拦截路径②的自动消费，等待用户点"继续"resume（清标记 + 队首作新 turn 发）。 */
  steerQueuePaused: Record<string, boolean | undefined>;
  turnSteerActivity: Record<string, true | undefined>;
  planImplementationPrompt: PlanImplementationPrompt | null;

  allSessions: ChatSessionRecord[];
  loadAllSessions: () => Promise<void>;
  load: (options?: { preserveActiveSession?: boolean }) => Promise<void>;
  createSession: () => Promise<void>;
  setActiveSession: (id: string) => void;
  setVisibleSession: (id: string | null) => void;
  deleteSession: (id: string) => Promise<void>;
  updateSessionTitle: (id: string, title: string) => Promise<void>;
  toggleSessionPinned: (id: string) => Promise<void>;
  forkSession: (id: string, lastTurnId?: string) => Promise<ChatSessionRecord>;
  sendMessage: (
    text: string,
    attachments?: UserMessageContent[],
    clientMessageId?: string,
    options?: SendMessageOptions,
  ) => Promise<SendResult>;
  cancelPendingSteer: (sessionId: string, messageId: string) => Promise<void>;
  applyPendingSteerNow: (sessionId: string, messageId: string) => Promise<void>;
  reorderSteers: (sessionId: string, messageIds: string[]) => Promise<void>;
  resumeSteerQueue: (sessionId: string) => Promise<void>;
  applyPendingState: (snapshot: PendingStateSnapshot) => void;
  dismissPlanImplementationPrompt: () => void;
  abort: (sessionId?: string) => Promise<void>;
  compactSession: (sessionId?: string) => Promise<void>;
  setInputText: (text: string) => void;
  handleItemEvent: (event: ItemEvent) => void;
  handleEvent: (event: UIEvent) => void;
  clearContextActionRequest: () => void;
  continueContextAction: () => Promise<void>;
  loadReadThread: (sessionId: string) => Promise<void>;
  loadMoreReadThread: (sessionId: string) => Promise<void>;
  handleReadThread: (snapshot: WorkflowReadThreadResponse | null) => void;
  selectExecutionSubagent: (sessionId: string, subagentId: string) => void;
  revealExecutionSubagent: (sessionId: string, subagentId: string) => void;

  // derived
  getActiveReadThreadModel: () => WorkflowReadThreadResponse | null;
}

// Re-export ChatSendReceipt for internal slices that need it
export type { ChatSendReceipt };
