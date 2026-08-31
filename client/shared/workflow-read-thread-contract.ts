import type { ContextUsageRecord } from "./types";
import type { TokenUsage } from "./types";

/**
 * Read-thread 数据契约版本。
 * v2（统一渲染重构 Phase 1）：items 为 WorkflowTurnItem 主路径（settled 不变量 +
 * zone 归属），不再有 streaming 双路径；item 统一为 WorkflowTurnItem。
 * 旧格式不兼容，无迁移代码。
 */
export const WORKFLOW_READ_THREAD_SCHEMA_VERSION = 2 as const;

export type WorkflowReadThreadSchemaVersion =
  typeof WORKFLOW_READ_THREAD_SCHEMA_VERSION;

export interface WorkflowReadThreadResponse {
  schemaVersion: WorkflowReadThreadSchemaVersion;
  thread: WorkflowThreadInfo;
  page: WorkflowThreadPage;
  execution?: WorkflowThreadExecutionSnapshot;
  turns: WorkflowTurn[];
}

export interface WorkflowThreadExecutionSnapshot {
  events: WorkflowThreadExecutionEvent[];
}

export interface WorkflowThreadExecutionEvent {
  timestamp: number;
  event: unknown;
}

export interface WorkflowThreadInfo {
  id: string;
  title: string;
  preview: string;
  status: WorkflowThreadStatus;
  cwd?: string | null;
  createdAt?: number | string | null;
  updatedAt?: number | string | null;
}

export type WorkflowThreadStatus =
  | { type: "active"; activeFlags?: unknown }
  | { type: "idle" }
  | { type: "notLoaded" }
  | { type: "systemError" }
  | { type: string; [key: string]: unknown };

export interface WorkflowThreadPage {
  order: "newest_first";
  limit: number;
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * 数据归属区：turn 源头归属（canonical 属性）。
 * - workspace: 桌面工作区（本地会话；replay 是其查看模式，不单列）
 * - wecom / feishu: IM 渠道发起的 turn
 * - scheduledTask: 定时任务发起的 turn
 * 各区只负责筛选/挂载 turn，不得自维护消息 item 集或渲染分支。
 */
export type AppZone = "workspace" | "wecom" | "feishu" | "scheduledTask";

/**
 * 一个 turn 在某区的挂载索引项。
 * - primary: 该 turn 的源头归属挂载（turn 创建区）
 * - mirrored: 其他区引用同一 turn（由订阅层实现为引用，不复制 item 数据）
 */
export interface TurnPlacement {
  turnId: string;
  zone: AppZone;
  /** 区内的定位键：workspace=threadId / sessionId；wecom、feishu=chatId；scheduledTask=taskId */
  refId: string;
  visibility: "primary" | "mirrored";
}

export interface WorkflowTurn {
  id: string;
  zone: AppZone;
  ordinal?: number;
  status: WorkflowTurnStatus;
  error: WorkflowTurnError | null;
  startedAt?: number | string | null;
  completedAt?: number | string | null;
  durationMs?: number | null;
  modelId?: string | null;
  modelName?: string | null;
  usage?: TokenUsage;
  contextUsage?: ContextUsageRecord;
  /** UI-only marker: this slice has later output in the same visual turn. */
  continuationFragment?: boolean;
  /** UI-only marker: this slice continues the visual turn started by a previous slice. */
  continuesPreviousTurn?: boolean;
  items: WorkflowTurnItem[];
}

export type WorkflowTurnStatus =
  "running" | "completed" | "failed" | "cancelled" | string;

export interface WorkflowTurnError {
  message: string;
  additionalDetails?: unknown;
}

export type WorkflowTextOutput =
  | { text: string; truncated: false }
  | { text: string; truncated: true; originalChars: number }
  | { text: string; truncated?: boolean; originalChars?: number };

export interface WorkflowContextEconomyMeta {
  compressed: boolean;
  originalChars: number;
  modelChars: number;
  strategy: string[];
  preserved: {
    codeBlocks: number;
    paths: number;
    urls: number;
    stackLines: number;
    errorLines: number;
  };
  omittedChars: number;
}

export type WorkflowUserMessageContent =
  | {
      type: "text";
      text: string;
      text_elements?: unknown[];
      workflowDelegation?: WorkflowDelegation;
    }
  | { type: "image"; url: string; detail?: string }
  | { type: "localImage"; path: string; detail?: string }
  | {
      type: "file";
      name: string;
      mimeType: string;
      text: string;
      path?: string;
    }
  | { type: "url"; url: string; title?: string }
  | {
      type: "skill";
      name: string;
      path?: string;
      id?: string;
      displayName?: string;
      description?: string;
      scope?: "user" | "project" | "enterprise" | "marketplace";
      version?: string;
      promptLinkLabel?: string;
    }
  | { type: "mention"; name: string; path?: string }
  | {
      /** A page annotation captured from the embedded browser. */
      type: "browserComment";
      commentId: number;
      ref: string;
      tagName: string;
      text: string;
      attributes: Record<string, string>;
      rect: { x: number; y: number; width: number; height: number };
      viewport: { width: number; height: number };
      scrollX: number;
      scrollY: number;
      comment: string;
      pageUrl?: string;
      screenshotDataUrl?: string;
    };

export interface WorkflowDelegation {
  sourceThreadId: string;
  input: string;
}

export type WorkflowTurnItem =
  | WorkflowUserMessageItem
  | WorkflowAgentMessageItem
  | WorkflowPlanItem
  | WorkflowReasoningItem
  | WorkflowCommandExecutionItem
  | WorkflowFileChangeItem
  | WorkflowMcpToolCallItem
  | WorkflowDynamicToolCallItem
  | WorkflowCollabAgentToolCallItem
  | WorkflowWebSearchItem
  | WorkflowImageViewItem
  | WorkflowImageGenerationItem
  | WorkflowEnteredReviewModeItem
  | WorkflowExitedReviewModeItem
  | WorkflowHookPromptItem
  | WorkflowPermissionRequestItem
  | WorkflowContextCompactionItem
  | WorkflowUnknownItem;

export type WorkflowCanonicalTurnItemType = Exclude<
  WorkflowTurnItem["type"],
  "unknown"
>;

export interface WorkflowTurnItemBase {
  type: string;
  id: string;
  /**
   * item 级流式/终态表达（不变量）：
   * - `settled === false`：仍可能收到同 id 更新；`settled === true`：该 item 终态
   * - 有 `status` 的 item：`completed / failed / cancelled`（及 error、timed_out 等终态）→ `settled === true`；
   *   `pending / running` → `settled === false`
   * - 无 `status` 的流式 item（agentMessage / reasoning）：builder 在 chunk 时置 `settled === false`，
   *   turn.complete 或对应完成事件时置 `settled === true`
   * UI、IM、持久化统一按此解释，不允许各自猜。
   */
  settled?: boolean;
}

export interface WorkflowUserMessageItem extends WorkflowTurnItemBase {
  type: "userMessage";
  clientId?: string;
  content: WorkflowUserMessageContent[];
}

export interface WorkflowAgentMessageItem extends WorkflowTurnItemBase {
  type: "agentMessage";
  text: string;
  phase?: string;
}

export interface WorkflowPlanItem extends WorkflowTurnItemBase {
  type: "plan";
  text: string;
}

export interface WorkflowReasoningItem extends WorkflowTurnItemBase {
  type: "reasoning";
  summary: string;
  content?: WorkflowTextOutput[];
}

export interface WorkflowCommandExecutionItem extends WorkflowTurnItemBase {
  type: "commandExecution";
  command: string;
  shell?: string;
  cwd?: string;
  status: WorkflowItemStatus;
  exitCode?: number | null;
  durationMs?: number | null;
  output?: WorkflowTextOutput;
}

export interface WorkflowFileChangeItem extends WorkflowTurnItemBase {
  type: "fileChange";
  status: WorkflowItemStatus;
  changes: WorkflowFileChange[];
}

export interface WorkflowFileChange {
  path: string;
  kind: string;
  diff?: WorkflowTextOutput;
}

export interface WorkflowMcpToolCallItem extends WorkflowTurnItemBase {
  type: "mcpToolCall";
  server?: string;
  tool: string;
  arguments?: unknown;
  status: WorkflowItemStatus;
  durationMs?: number | null;
  output?: WorkflowTextOutput;
  modelOutput?: WorkflowTextOutput;
  contextEconomy?: WorkflowContextEconomyMeta;
}

export interface WorkflowDynamicToolCallItem extends WorkflowTurnItemBase {
  type: "dynamicToolCall";
  tool: string;
  arguments?: unknown;
  status: WorkflowItemStatus;
  success?: boolean;
  durationMs?: number | null;
  output?: WorkflowTextOutput;
  modelOutput?: WorkflowTextOutput;
  contextEconomy?: WorkflowContextEconomyMeta;
}

export interface WorkflowCollabAgentToolCallItem extends WorkflowTurnItemBase {
  type: "collabAgentToolCall";
  tool: string;
  status: WorkflowItemStatus;
  senderThreadId?: string;
  receiverThreadIds?: string[];
  prompt?: string;
  model?: string;
  reasoningEffort?: string;
}

export interface WorkflowWebSearchItem extends WorkflowTurnItemBase {
  type: "webSearch";
  query?: string;
  action?: unknown;
}

export interface WorkflowImageViewItem extends WorkflowTurnItemBase {
  type: "imageView";
  path: string;
}

export interface WorkflowImageGenerationItem extends WorkflowTurnItemBase {
  type: "imageGeneration";
  status: WorkflowItemStatus;
  revisedPrompt?: string;
  result?: unknown;
  savedPath?: string | null;
}

export interface WorkflowEnteredReviewModeItem extends WorkflowTurnItemBase {
  type: "enteredReviewMode";
  review?: unknown;
}

export interface WorkflowExitedReviewModeItem extends WorkflowTurnItemBase {
  type: "exitedReviewMode";
  review?: unknown;
}

export interface WorkflowHookPromptItem extends WorkflowTurnItemBase {
  type: "hookPrompt";
  fragmentCount: number;
}

export interface WorkflowPermissionRequestItem extends WorkflowTurnItemBase {
  type: "permissionRequest";
  toolName: string;
  reason: string;
  status: WorkflowItemStatus;
  timeoutMs?: number | null;
}

export interface WorkflowContextCompactionItem extends WorkflowTurnItemBase {
  type: "contextCompaction";
}

export interface WorkflowUnknownItem extends WorkflowTurnItemBase {
  type: "unknown";
  rawType?: string;
  raw: unknown;
}

export type WorkflowItemStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "error"
  | "cancelled"
  | string;

export type WorkflowActivityItem = Extract<
  WorkflowTurnItem,
  {
    type:
      | "reasoning"
      | "commandExecution"
      | "fileChange"
      | "mcpToolCall"
      | "dynamicToolCall"
      | "collabAgentToolCall"
      | "webSearch"
      | "imageView"
      | "imageGeneration"
      | "enteredReviewMode"
      | "exitedReviewMode"
      | "hookPrompt"
      | "permissionRequest"
      | "contextCompaction"
      | "unknown";
  }
>;

export type WorkflowContentItem = Extract<
  WorkflowTurnItem,
  { type: "userMessage" | "agentMessage" | "plan" }
>;

export type WorkflowResultItem = Extract<
  WorkflowTurnItem,
  { type: "fileChange" | "imageGeneration" | "webSearch" }
>;

export type WorkflowToolLikeItem = Extract<
  WorkflowTurnItem,
  {
    type:
      | "commandExecution"
      | "mcpToolCall"
      | "dynamicToolCall"
      | "collabAgentToolCall"
      | "webSearch";
  }
>;

export const WORKFLOW_CANONICAL_TURN_ITEM_TYPES = [
  "userMessage",
  "agentMessage",
  "plan",
  "reasoning",
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "dynamicToolCall",
  "collabAgentToolCall",
  "webSearch",
  "imageView",
  "imageGeneration",
  "enteredReviewMode",
  "exitedReviewMode",
  "hookPrompt",
  "permissionRequest",
  "contextCompaction",
] as const satisfies readonly WorkflowCanonicalTurnItemType[];

export function isWorkflowCanonicalTurnItemType(
  value: string,
): value is WorkflowCanonicalTurnItemType {
  return (WORKFLOW_CANONICAL_TURN_ITEM_TYPES as readonly string[]).includes(
    value,
  );
}

export function isWorkflowActivityItem(
  item: WorkflowTurnItem,
): item is WorkflowActivityItem {
  switch (item.type) {
    case "reasoning":
    case "commandExecution":
    case "fileChange":
    case "mcpToolCall":
    case "dynamicToolCall":
    case "collabAgentToolCall":
    case "webSearch":
    case "imageView":
    case "imageGeneration":
    case "enteredReviewMode":
    case "exitedReviewMode":
    case "hookPrompt":
    case "permissionRequest":
    case "contextCompaction":
    case "unknown":
      return true;
    default:
      return false;
  }
}

export function isWorkflowContentItem(
  item: WorkflowTurnItem,
): item is WorkflowContentItem {
  return (
    item.type === "userMessage" ||
    item.type === "agentMessage" ||
    item.type === "plan"
  );
}

export function isWorkflowResultItem(
  item: WorkflowTurnItem,
): item is WorkflowResultItem {
  return (
    item.type === "fileChange" ||
    item.type === "imageGeneration" ||
    item.type === "webSearch"
  );
}

export function isWorkflowToolLikeItem(
  item: WorkflowTurnItem,
): item is WorkflowToolLikeItem {
  switch (item.type) {
    case "commandExecution":
    case "mcpToolCall":
    case "dynamicToolCall":
    case "collabAgentToolCall":
    case "webSearch":
      return true;
    default:
      return false;
  }
}
