import type {
  WorkflowFileChange,
  WorkflowItemStatus,
  WorkflowTurnItem,
} from "../workflow-read-thread-contract";

/**
 * WorkflowTurnItem → IM 消息/卡片的投影层。
 *
 * 设计原则：
 * - 有损投影是显式设计：工具大输出截断、结果摘要化，不要求 IM 端拿到完整数据。
 * - `prevItem` 缺失（新建 item / 首帧）时按首帧处理：文本走全量而非增量、
 *   卡片生成完整内容（护栏 5）。
 * - 投影函数是纯函数，挂在订阅层调用，不散落在各 IM 渠道（Phase 3 落地）。
 * - 各渠道按 `ImCapability` 声明能力，投影函数据此取舍成员。
 */

export type ImCapability =
  | "textStream"
  | "cardMessage"
  | "inlineStatus"
  | "approvalCard"
  | "fileChangeCard"
  | "commandExecutionCard";

export type ImProjection =
  | { kind: "textDelta"; text: string; done: boolean }
  | {
      kind: "statusLine";
      text: string;
      state: "running" | "done" | "failed";
    }
  | { kind: "resultCard"; title: string; summary: string }
  | {
      kind: "approvalCard";
      requestId: string;
      toolName: string;
      reason: string;
    }
  | { kind: "errorCard"; message: string }
  | { kind: "fileChangeCard"; changes: WorkflowFileChange[] }
  | {
      kind: "commandExecutionCard";
      command: string;
      exitCode?: number | null;
      output?: string;
    }
  | { kind: "skip" };

const SUMMARY_MAX_CHARS = 4000;

function truncate(text: string): string {
  if (text.length <= SUMMARY_MAX_CHARS) return text;
  return `${text.slice(0, SUMMARY_MAX_CHARS)}…`;
}

/** 增量文本：prev 是 next 前缀时只取追加部分；否则全量兜底（首帧/跳跃）。 */
function deltaText(prev: string | undefined, next: string): string {
  if (!prev) return next;
  if (next.startsWith(prev)) return next.slice(prev.length);
  return next;
}

function isTerminal(status: WorkflowItemStatus): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "error" ||
    status === "cancelled" ||
    status === "timed_out"
  );
}

function isFailure(status: WorkflowItemStatus): boolean {
  return status === "failed" || status === "error" || status === "cancelled";
}

function outputText(item: WorkflowTurnItem): string | undefined {
  if (
    (item.type === "mcpToolCall" || item.type === "dynamicToolCall") &&
    item.output?.text
  ) {
    return item.output.text;
  }
  if (item.type === "commandExecution" && item.output?.text) {
    return item.output.text;
  }
  return undefined;
}

export function projectTurnItem(
  item: WorkflowTurnItem,
  prevItem: WorkflowTurnItem | undefined,
  capabilities: ReadonlySet<ImCapability>,
): ImProjection[] {
  const has = (cap: ImCapability) => capabilities.has(cap);

  switch (item.type) {
    case "agentMessage": {
      if (!has("textStream")) return [{ kind: "skip" }];
      const delta = deltaText(
        prevItem?.type === "agentMessage" ? prevItem.text : undefined,
        item.text,
      );
      if (!delta) return [{ kind: "skip" }];
      return [{ kind: "textDelta", text: delta, done: item.settled === true }];
    }

    case "reasoning": {
      if (!has("inlineStatus")) return [{ kind: "skip" }];
      return [
        {
          kind: "statusLine",
          text: "思考中…",
          state: item.settled === true ? "done" : "running",
        },
      ];
    }

    case "plan": {
      if (!has("inlineStatus")) return [{ kind: "skip" }];
      return [
        {
          kind: "statusLine",
          text: "正在制定计划…",
          state: item.settled === true ? "done" : "running",
        },
      ];
    }

    case "mcpToolCall":
    case "dynamicToolCall": {
      if (item.status === "running") {
        if (!has("inlineStatus")) return [{ kind: "skip" }];
        return [
          {
            kind: "statusLine",
            text: `调用工具 ${item.tool}…`,
            state: "running",
          },
        ];
      }
      // 终态
      const text = outputText(item);
      if (isFailure(item.status)) {
        return [
          {
            kind: "errorCard",
            message: truncate(text || `${item.tool} 执行失败`),
          },
        ];
      }
      if (has("cardMessage")) {
        return [
          {
            kind: "resultCard",
            title: item.tool,
            summary: truncate(text || "(无输出)"),
          },
        ];
      }
      return [
        {
          kind: "statusLine",
          text: `工具 ${item.tool} 完成`,
          state: "done",
        },
      ];
    }

    case "commandExecution": {
      if (item.status === "running") {
        if (!has("inlineStatus")) return [{ kind: "skip" }];
        return [
          {
            kind: "statusLine",
            text: `执行命令 ${item.command}…`,
            state: "running",
          },
        ];
      }
      if (has("commandExecutionCard")) {
        return [
          {
            kind: "commandExecutionCard",
            command: item.command,
            exitCode: item.exitCode,
            output: truncate(item.output?.text ?? ""),
          },
        ];
      }
      return [
        {
          kind: "statusLine",
          text: isFailure(item.status)
            ? `命令执行失败：${item.command}`
            : `命令完成：${item.command}`,
          state: isFailure(item.status) ? "failed" : "done",
        },
      ];
    }

    case "fileChange": {
      if (has("fileChangeCard")) {
        return [{ kind: "fileChangeCard", changes: item.changes }];
      }
      if (has("inlineStatus")) {
        return [
          {
            kind: "statusLine",
            text: `文件变更 ${item.changes.length} 个`,
            state: isFailure(item.status) ? "failed" : "done",
          },
        ];
      }
      return [{ kind: "skip" }];
    }

    case "permissionRequest": {
      if (item.status === "running") {
        if (!has("approvalCard")) return [{ kind: "skip" }];
        return [
          {
            kind: "approvalCard",
            requestId: item.id,
            toolName: item.toolName,
            reason: item.reason,
          },
        ];
      }
      // 终态：审批结果行内收尾（已发过卡片的渠道提示结果）
      if (!has("inlineStatus")) return [{ kind: "skip" }];
      return [
        {
          kind: "statusLine",
          text: item.reason,
          state: isFailure(item.status) ? "failed" : "done",
        },
      ];
    }

    case "webSearch": {
      if (item.query && has("cardMessage")) {
        return [
          {
            kind: "resultCard",
            title: `搜索：${item.query}`,
            summary: "(搜索完成，结果已并入上下文)",
          },
        ];
      }
      return [{ kind: "skip" }];
    }

    default:
      return [{ kind: "skip" }];
  }
}

/**
 * 便捷版：capabilities 以数组传入（避免调用点每次构造 Set）。
 */
export function projectTurnItemWith(
  item: WorkflowTurnItem,
  prevItem: WorkflowTurnItem | undefined,
  capabilities: readonly ImCapability[],
): ImProjection[] {
  return projectTurnItem(item, prevItem, new Set(capabilities));
}

export function isTerminalTurnItem(item: WorkflowTurnItem): boolean {
  if (item.settled === true) return true;
  if ("status" in item && typeof item.status === "string") {
    return isTerminal(item.status);
  }
  return false;
}
