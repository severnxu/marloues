import {
  WORKFLOW_READ_THREAD_SCHEMA_VERSION,
  type WorkflowDynamicToolCallItem as BaseDynamicToolCallItem,
  type WorkflowReadThreadResponse,
  type WorkflowItemStatus,
  type WorkflowHookPromptItem as BaseHookPromptItem,
  type WorkflowMcpToolCallItem as BaseMcpToolCallItem,
  type WorkflowReasoningItem as BaseReasoningItem,
  type WorkflowTextOutput,
  type WorkflowTurn,
  type WorkflowTurnItem as BaseTurnItem,
  type WorkflowTurnStatus,
  type WorkflowWebSearchItem as BaseWebSearchItem,
  type WorkflowUserMessageContent,
} from "../workflow-read-thread-contract";
import type { ContextUsageRecord, TokenUsage } from "../types";

export type WorkflowWebSearchItem = BaseWebSearchItem & {
  status?: WorkflowItemStatus;
  output?: WorkflowTextOutput;
};

export type WorkflowHookPromptItem = BaseHookPromptItem & {
  fragments?: unknown;
};

export type WorkflowMcpToolCallItem = BaseMcpToolCallItem & {
  output?: WorkflowTextOutput;
};

export type WorkflowDynamicToolCallItem = BaseDynamicToolCallItem & {
  output?: WorkflowTextOutput;
};

export type WorkflowReasoningItem = BaseReasoningItem & {
  encrypted?: boolean;
};

export type WorkflowTurnItem =
  | Exclude<
      BaseTurnItem,
      | BaseWebSearchItem
      | BaseHookPromptItem
      | BaseMcpToolCallItem
      | BaseDynamicToolCallItem
      | BaseReasoningItem
    >
  | WorkflowWebSearchItem
  | WorkflowHookPromptItem
  | WorkflowMcpToolCallItem
  | WorkflowDynamicToolCallItem
  | WorkflowReasoningItem;

export interface WorkflowMessageBlock {
  id: string;
  userMessageId?: string;
  user: string;
  userContent: WorkflowUserMessageContent[];
  status:
    | Extract<
        WorkflowTurnStatus,
        "running" | "completed" | "failed" | "cancelled"
      >
    | "running"
    | "completed"
    | "failed"
    | "cancelled";
  activity: "thinking" | "running" | "responding" | "done" | "failed";
  startedAt?: number;
  completedAt?: number;
  durationMs: number | null;
  modelId?: string;
  modelName?: string;
  usage?: TokenUsage;
  contextUsage?: ContextUsageRecord;
  /** This slice has later output in the same visual turn. */
  continuationFragment?: boolean;
  /** This slice continues the visual turn started by a previous slice. */
  continuesPreviousTurn?: boolean;
  items: WorkflowTurnItem[];
}

export interface WorkflowReadThreadAdapterOptions {
  threadId?: string;
  title?: string;
  preview?: string;
  cwd?: string | null;
  createdAt?: number | string | null;
  updatedAt?: number | string | null;
  limit?: number;
  nextCursor?: string | null;
  hasMore?: boolean;
}

export function workflowMessagesToWorkflowReadThreadResponse(
  workflowMessages: WorkflowMessageBlock[],
  options: WorkflowReadThreadAdapterOptions = {},
): WorkflowReadThreadResponse {
  const chronologicalTurns = workflowMessages
    .filter((block) => block.user || block.items.length)
    .map((block) => {
      const cached = workflowTurnCache.get(block);
      if (cached) return cached;
      const turn = workflowBlockToWorkflowTurn(block);
      workflowTurnCache.set(block, turn);
      return turn;
    });

  const newestFirstTurns = [...chronologicalTurns].reverse();
  const firstTurn = chronologicalTurns[0];
  const latestTurn = chronologicalTurns[chronologicalTurns.length - 1];
  const preview =
    options.preview ??
    latestTurnPreview(latestTurn) ??
    latestTurnPreview(firstTurn) ??
    "";
  const hasRunningTurn = chronologicalTurns.some(
    (turn) => turn.status === "running",
  );

  return {
    schemaVersion: WORKFLOW_READ_THREAD_SCHEMA_VERSION,
    thread: {
      id: options.threadId ?? "local-workflow-thread",
      title: (options.title ?? preview) || "Workflow Thread",
      preview,
      status: hasRunningTurn
        ? { type: "active", activeFlags: {} }
        : { type: "idle" },
      cwd: options.cwd ?? null,
      createdAt: options.createdAt ?? firstTurn?.startedAt ?? null,
      updatedAt:
        options.updatedAt ??
        latestTurn?.completedAt ??
        latestTurn?.startedAt ??
        null,
    },
    page: {
      order: "newest_first",
      limit: options.limit ?? newestFirstTurns.length,
      nextCursor: options.nextCursor ?? null,
      hasMore: options.hasMore ?? false,
    },
    turns: newestFirstTurns,
  };
}

const workflowTurnCache = new WeakMap<WorkflowMessageBlock, WorkflowTurn>();

export function workflowReadThreadToWorkflowMessages(
  readThread: WorkflowReadThreadResponse,
): WorkflowMessageBlock[] {
  return workflowReadThreadTurnsInRenderOrder(readThread)
    .map(workflowTurnToWorkflowMessage)
    .filter((message) => message.user || message.items.length);
}

export function workflowReadThreadTurnsInRenderOrder(
  readThread: WorkflowReadThreadResponse,
): WorkflowTurn[] {
  return readThread.page.order === "newest_first"
    ? [...readThread.turns].reverse()
    : [...readThread.turns];
}

export function workflowTurnToWorkflowMessage(
  turn: WorkflowTurn,
): WorkflowMessageBlock {
  const userItems = turn.items.filter(
    (item): item is Extract<WorkflowTurnItem, { type: "userMessage" }> =>
      item.type === "userMessage",
  );
  const userContent = userItems.flatMap((item) => item.content);
  const items = turn.items.filter(
    (item): item is WorkflowTurnItem => item.type !== "userMessage",
  );
  const user = userContent
    .filter(
      (item): item is Extract<WorkflowUserMessageContent, { type: "text" }> =>
        item.type === "text",
    )
    .map((item) => item.text)
    .join("\n\n")
    .trim();

  return {
    id: turn.id,
    userMessageId: userItems[0]?.id,
    user,
    userContent,
    status: normalizeWorkflowStatus(turn.status),
    activity: workflowActivityForTurn(turn),
    startedAt: typeof turn.startedAt === "number" ? turn.startedAt : undefined,
    completedAt:
      typeof turn.completedAt === "number" ? turn.completedAt : undefined,
    durationMs: turn.durationMs ?? null,
    modelId: typeof turn.modelId === "string" ? turn.modelId : undefined,
    modelName: typeof turn.modelName === "string" ? turn.modelName : undefined,
    usage: turn.usage,
    contextUsage: turn.contextUsage,
    continuationFragment: turn.continuationFragment,
    continuesPreviousTurn: turn.continuesPreviousTurn,
    items,
  };
}

function workflowBlockToWorkflowTurn(
  block: WorkflowMessageBlock,
): WorkflowTurn {
  const items: BaseTurnItem[] = block.items.map(workflowItemToWorkflowTurnItem);
  if (
    block.userContent.length &&
    !items.some((item) => item.type === "userMessage")
  ) {
    items.unshift({
      type: "userMessage",
      id: block.userMessageId ?? `${block.id}:user`,
      content: block.userContent,
    });
  }

  return {
    id: block.id,
    // 本地 workflow 渲染路径的 turn 归属 workspace 区
    zone: "workspace",
    status: block.status,
    error: null,
    startedAt: block.startedAt ?? null,
    completedAt: block.completedAt ?? null,
    durationMs: block.durationMs,
    modelId: block.modelId ?? null,
    modelName: block.modelName ?? null,
    usage: block.usage,
    contextUsage: block.contextUsage,
    continuationFragment: block.continuationFragment,
    continuesPreviousTurn: block.continuesPreviousTurn,
    items,
  };
}

/**
 * 有损投影：adapter 扩展字段（webSearch.output / mcpToolCall.output 等）→ contract 基字段。
 * 行为由单测锁定（workflow-messages-to-read-thread.test.ts），评估 Phase 2 是否保留。
 */
export function workflowItemToWorkflowTurnItem(
  item: WorkflowTurnItem,
): BaseTurnItem {
  if (item.type === "webSearch") {
    return {
      type: "webSearch",
      id: item.id,
      query: item.query,
      action: item.action,
    };
  }

  if (item.type === "hookPrompt") {
    return {
      type: "hookPrompt",
      id: item.id,
      fragmentCount: item.fragmentCount,
    };
  }

  if (item.type === "permissionRequest") {
    return {
      type: "permissionRequest",
      id: item.id,
      toolName: item.toolName,
      reason: item.reason,
      status: item.status,
      timeoutMs: item.timeoutMs,
    };
  }

  if (item.type === "mcpToolCall") {
    return {
      type: "mcpToolCall",
      id: item.id,
      server: item.server,
      tool: item.tool,
      arguments: item.arguments,
      status: item.status,
      durationMs: item.durationMs,
    };
  }

  if (item.type === "dynamicToolCall") {
    return {
      type: "dynamicToolCall",
      id: item.id,
      tool: item.tool,
      arguments: item.arguments,
      status: item.status,
      success: item.success,
      durationMs: item.durationMs,
    };
  }

  if (item.type === "reasoning") {
    return {
      type: "reasoning",
      id: item.id,
      summary: item.summary,
      content: item.content,
    };
  }

  return item;
}

function latestTurnPreview(turn: WorkflowTurn | undefined): string | undefined {
  if (!turn) return undefined;
  for (let index = turn.items.length - 1; index >= 0; index -= 1) {
    const item = turn.items[index];
    if (item.type === "agentMessage" && item.text.trim())
      return item.text.trim().slice(0, 160);
    if (item.type === "userMessage") {
      const text = item.content
        .find((entry) => entry.type === "text")
        ?.text.trim();
      if (text) return text.slice(0, 160);
    }
  }
  return undefined;
}

function normalizeWorkflowStatus(
  status: WorkflowTurnStatus,
): WorkflowMessageBlock["status"] {
  if (status === "failed") return "failed";
  if (status === "completed") return "completed";
  if (status === "cancelled") return "cancelled";
  return "running";
}

function workflowActivityForTurn(
  turn: WorkflowTurn,
): WorkflowMessageBlock["activity"] {
  if (turn.status === "failed") return "failed";
  if (turn.status === "completed") return "done";
  // A cancelled turn is terminal (user pressed Esc): stop the response timer
  // and show the footer metadata instead of a perpetual "处理中" state.
  if (turn.status === "cancelled") return "done";
  if (
    turn.items.some((item) => item.type === "agentMessage" && item.text.trim())
  )
    return "responding";
  if (turn.items.some((item) => item.type !== "userMessage")) return "running";
  return "thinking";
}
