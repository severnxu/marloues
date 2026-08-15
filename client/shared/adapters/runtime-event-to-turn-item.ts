import type { AppZone } from "../workflow-read-thread-contract";
import type {
  WorkflowAgentMessageItem,
  WorkflowItemStatus,
  WorkflowMcpToolCallItem,
  WorkflowPermissionRequestItem,
  WorkflowPlanItem,
  WorkflowReasoningItem,
  WorkflowTextOutput,
  WorkflowTurnItem,
} from "../workflow-read-thread-contract";
import type { RuntimeItemEvent } from "./runtime-event-types";

/**
 * Runtime Event → WorkflowTurnItem 的唯一转换点（turn 内状态机）。
 *
 * 设计参照竞品「事件 + 完整快照」模型（Codex ThreadEvent 携带完整 item 快照、
 * Cline 每次事件携带 AgentRuntimeStateSnapshot）：每次 ingest 都返回更新后的
 * 完整 item（幂等 upsert），消费方无需自行合并；prevItem 提供 mutation 前快照，
 * 供投影层做增量/首帧判断。
 *
 * 生命周期：一个 builder 对应一个 turn。turn 结束（turn.complete / abort）后
 * 由上层丢弃；finalizeStreamingItems() 负责对无 status 的流式 item 落终态。
 *
 * 替换目标：chat.ts 事件循环内联的 item 构造 + streaming.ts 双路径。
 */

export interface TurnItemIngestResult {
  /** 更新后的完整对象（下游幂等 upsert）。 */
  item: WorkflowTurnItem;
  /** mutation 前 clone；新建 item / 首帧时不存在（undefined）。 */
  prevItem?: WorkflowTurnItem;
  /** 本事件是否产生实际变更（如 SDK 重复 chunk 时 false）。 */
  changed: boolean;
}

export interface TurnItemBuilder {
  readonly turnId: string;
  /** turn 源头归属区（canonical，随 builder 创建即锁定）。 */
  readonly zone: AppZone;
  /** 区内定位键（workspace=threadId、IM=chatId、scheduledTask=taskId）。 */
  readonly refId: string;

  ingest(event: RuntimeItemEvent, _ts?: number): TurnItemIngestResult;

  getItem(id: string): WorkflowTurnItem | undefined;

  /** 当前全部 items（插入序），供 turn 收尾 flush / 持久化使用。 */
  items(): WorkflowTurnItem[];

  /**
   * turn.complete 处理：对无 status 的流式 item（agentMessage / reasoning）
   * 置 settled=true。返回所有发生终态翻转的变更对；无变更时返回空数组。
   */
  finalizeStreamingItems(): Array<{
    item: WorkflowTurnItem;
    prevItem: WorkflowTurnItem;
  }>;
}

export interface TurnItemBuilderOptions {
  turnId: string;
  zone: AppZone;
  refId: string;
}

const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "failed",
  "cancelled",
  "error",
  "timed_out",
]);

/** 有 status 的 item 是否已达终态（护栏 4：终态 ⇒ settled=true）。 */
export function isTerminalItemStatus(status: WorkflowItemStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** 任意 unknown 输出 → WorkflowTextOutput 归一化（非字符串走 JSON 摘要）。 */
export function textOutputFromUnknown(
  value: unknown,
): WorkflowTextOutput | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") {
    return { text: value, truncated: false };
  }
  try {
    return { text: JSON.stringify(value, null, 2), truncated: false };
  } catch {
    return { text: String(value), truncated: false };
  }
}

export function createTurnItemBuilder(
  options: TurnItemBuilderOptions,
): TurnItemBuilder {
  const { turnId, zone, refId } = options;
  const items = new Map<string, WorkflowTurnItem>();

  // 流式文本归属（对齐 chat.ts 现有语义）：
  // agent item 为 `agent-<turnId>`（首段）或 `agent-<turnId>-<seq>`（分段）；
  // reasoning item 为 `reasoning-<turnId>-<seq>`。
  let lastAgentId = "";
  let agentSequence = 0;
  let lastReasoningId = "";
  let reasoningSequence = 0;

  const snapshot = (id: string): WorkflowTurnItem | undefined => {
    const current = items.get(id);
    return current ? structuredClone(current) : undefined;
  };

  const upsert = (id: string, next: WorkflowTurnItem): TurnItemIngestResult => {
    const prevItem = snapshot(id);
    items.set(id, next);
    return { item: next, prevItem, changed: true };
  };

  const upsertAgentMessage = (content: string): TurnItemIngestResult => {
    if (!lastAgentId || !items.has(lastAgentId)) {
      agentSequence += 1;
      lastAgentId =
        agentSequence === 1
          ? `agent-${turnId}`
          : `agent-${turnId}-${agentSequence}`;
      return upsert(lastAgentId, {
        type: "agentMessage",
        id: lastAgentId,
        text: content,
        settled: false,
      });
    }

    const existing = items.get(lastAgentId) as WorkflowAgentMessageItem;
    const existingText = existing.text ?? "";
    const nextText = content.startsWith(existingText)
      ? content
      : existingText + content;
    if (nextText === existingText) {
      return { item: existing, changed: false };
    }
    return upsert(lastAgentId, {
      ...existing,
      text: nextText,
      settled: false,
    });
  };

  const upsertReasoning = (content: string): TurnItemIngestResult => {
    if (!lastReasoningId || !items.has(lastReasoningId)) {
      reasoningSequence += 1;
      lastReasoningId = `reasoning-${turnId}-${reasoningSequence}`;
      return upsert(lastReasoningId, {
        type: "reasoning",
        id: lastReasoningId,
        summary: content,
        settled: false,
      });
    }

    const existing = items.get(lastReasoningId) as WorkflowReasoningItem;
    const nextSummary = (existing.summary ?? "") + content;
    if (nextSummary === existing.summary) {
      return { item: existing, changed: false };
    }
    return upsert(lastReasoningId, {
      ...existing,
      summary: nextSummary,
      settled: false,
    });
  };

  const upsertMcpToolCall = (
    id: string,
    patch: Partial<WorkflowMcpToolCallItem>,
  ): TurnItemIngestResult => {
    const existing = items.get(id) as WorkflowMcpToolCallItem | undefined;
    return upsert(id, {
      type: "mcpToolCall",
      id,
      tool: patch.tool ?? existing?.tool ?? "tool",
      server: patch.server ?? existing?.server,
      arguments: patch.arguments ?? existing?.arguments,
      status: patch.status ?? existing?.status ?? "running",
      durationMs: patch.durationMs ?? existing?.durationMs,
      output: patch.output ?? existing?.output,
      modelOutput: patch.modelOutput ?? existing?.modelOutput,
      contextEconomy: patch.contextEconomy ?? existing?.contextEconomy,
      settled: patch.settled ?? existing?.settled,
    } satisfies WorkflowMcpToolCallItem);
  };

  const upsertPermissionRequest = (
    id: string,
    patch: Partial<WorkflowPermissionRequestItem>,
  ): TurnItemIngestResult => {
    const existing = items.get(id) as WorkflowPermissionRequestItem | undefined;
    return upsert(id, {
      type: "permissionRequest",
      id,
      toolName: patch.toolName ?? existing?.toolName ?? "",
      reason: patch.reason ?? existing?.reason ?? "",
      status: patch.status ?? existing?.status ?? "running",
      timeoutMs: patch.timeoutMs ?? existing?.timeoutMs,
      settled: patch.settled ?? existing?.settled,
    } satisfies WorkflowPermissionRequestItem);
  };

  /** 无实际变更的占位结果（上层按 changed=false 跳过 emit）。 */
  const noop = (): TurnItemIngestResult => ({
    item: { type: "unknown", id: `noop-${turnId}`, raw: null },
    changed: false,
  });

  return {
    turnId,
    zone,
    refId,

    ingest(event, _ts) {
      switch (event.type) {
        case "text.chunk":
          // 文本流恢复后，thinking 归属重置（对齐 chat.ts：文本会打断推理段）
          lastReasoningId = "";
          if (!event.content) return noop();
          return upsertAgentMessage(event.content);

        case "thinking.chunk":
          if (!event.content) return noop();
          return upsertReasoning(event.content);

        case "plan.delta": {
          // 计划项打断当前 agent 文本段（对齐 chat.ts closeCurrentAgentMessage）
          lastAgentId = "";
          lastReasoningId = "";
          const existing = items.get(event.itemId);
          const baseText =
            existing && existing.type === "plan" ? existing.text : "";
          return upsert(event.itemId, {
            type: "plan",
            id: event.itemId,
            text: baseText + event.content,
            settled: false,
          } satisfies WorkflowPlanItem);
        }

        case "plan.item": {
          lastAgentId = "";
          lastReasoningId = "";
          return upsert(event.itemId, {
            type: "plan",
            id: event.itemId,
            text: event.content,
            settled: true,
          } satisfies WorkflowPlanItem);
        }

        case "tool.start": {
          // 工具调用打断当前 agent 文本段（对齐 chat.ts closeCurrentAgentMessage）
          lastAgentId = "";
          lastReasoningId = "";
          return upsertMcpToolCall(event.toolId, {
            tool: event.toolName,
            arguments: event.input ?? {},
            status: "running",
            settled: false,
          });
        }

        case "tool.complete":
          return upsertMcpToolCall(event.toolId, {
            output: textOutputFromUnknown(event.output),
            status: event.isError ? "error" : "completed",
            settled: true,
          });

        case "approval.request":
          return upsertPermissionRequest(event.requestId, {
            toolName: event.toolName,
            reason: event.reason,
            status: "running",
            timeoutMs: event.timeout,
            settled: false,
          });

        case "approval.decision": {
          const outcome =
            event.outcome ?? (event.approved ? "approved" : "denied");
          const status: WorkflowItemStatus =
            outcome === "approved"
              ? "completed"
              : outcome === "timed_out"
                ? "timed_out"
                : outcome === "canceled"
                  ? "cancelled"
                  : "failed";
          return upsertPermissionRequest(event.requestId, {
            status,
            settled: true,
          });
        }

        default:
          // RuntimeItemEvent 的穷尽性保证不会走到这里。
          return noop();
      }
    },

    getItem(id) {
      return items.get(id);
    },

    items() {
      return Array.from(items.values());
    },

    finalizeStreamingItems() {
      const finalized: Array<{
        item: WorkflowTurnItem;
        prevItem: WorkflowTurnItem;
      }> = [];
      for (const [id, item] of items) {
        if (item.type !== "agentMessage" && item.type !== "reasoning") {
          continue;
        }
        if (item.settled === true) continue;
        const prevItem = structuredClone(item);
        const next = { ...item, settled: true } as WorkflowTurnItem;
        items.set(id, next);
        finalized.push({ item: next, prevItem });
      }
      return finalized;
    },
  };
}
