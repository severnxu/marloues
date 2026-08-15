import {
  workflowItemIsRunning,
  workflowLayoutToolName,
  workflowStatusIsRunning,
} from "../turn-collapse-rules";
import { itemInputText } from "../..";
import {
  commandLines,
  commandSummaryKind,
  completedCount,
  emptyActivitySummary,
  fileChangeKind,
  isEditToolName,
  isListToolName,
  isReadToolName,
  isSearchToolName,
  patchLineStats,
  toolTargetCount,
} from "./tool-helpers";
import type { ProcessItem, WorkflowActivitySummary } from "./types";

export function workflowActivitySummaryRunningParts(
  summary: WorkflowActivitySummary,
): string[] {
  const parts: string[] = [];
  if (summary.runningExploredFileCount > 0)
    parts.push(`正在读取 ${summary.runningExploredFileCount} 个文件`);
  if (summary.runningSearchCount > 0) parts.push("正在搜索工作区");
  if (summary.runningListCount > 0) parts.push("正在列出文件");
  if (summary.runningFileCreateCount > 0)
    parts.push(`正在创建 ${summary.runningFileCreateCount} 个文件`);
  if (summary.runningWrittenLineCount > 0)
    parts.push(`正在编写 ${summary.runningWrittenLineCount} 行`);
  if (summary.runningFileEditCount > 0)
    parts.push(`正在编辑 ${summary.runningFileEditCount} 个文件`);
  if (summary.runningFileDeleteCount > 0)
    parts.push(`正在删除 ${summary.runningFileDeleteCount} 个文件`);
  if (summary.runningFolderCreateCount > 0)
    parts.push(
      summary.runningFolderCreateCount === 1
        ? "正在创建文件夹"
        : `正在创建 ${summary.runningFolderCreateCount} 个文件夹`,
    );
  if (summary.waitingPermissionRequestCount > 0)
    parts.push(`等待批准 ${summary.waitingPermissionRequestCount} 个请求`);
  if (summary.runningCommandCount > 0)
    parts.push(`正在运行 ${summary.runningCommandCount} 条命令`);
  if (summary.runningWebSearchCount > 0)
    parts.push(`正在搜索 ${summary.runningWebSearchCount} 次`);
  if (summary.runningToolCount > 0)
    parts.push(`正在使用 ${summary.runningToolCount} 个工具`);
  return parts;
}

export function workflowActivitySummaryCompletedParts(
  summary: WorkflowActivitySummary,
  onlyCompletedCounts: boolean,
): string[] {
  const commandCount = completedCount(
    summary.commandCount,
    summary.runningCommandCount + summary.runningFolderCreateCount,
    onlyCompletedCounts,
  );
  const exploredFileCount = completedCount(
    summary.exploredFileCount,
    summary.runningExploredFileCount,
    onlyCompletedCounts,
  );
  const fileCreateCount = completedCount(
    summary.fileCreateCount,
    summary.runningFileCreateCount,
    onlyCompletedCounts,
  );
  const fileEditCount = completedCount(
    summary.fileEditCount,
    summary.runningFileEditCount,
    onlyCompletedCounts,
  );
  const fileDeleteCount = completedCount(
    summary.fileDeleteCount,
    summary.runningFileDeleteCount,
    onlyCompletedCounts,
  );
  const listCount = completedCount(
    summary.listCount,
    summary.runningListCount,
    onlyCompletedCounts,
  );
  const searchCount = completedCount(
    summary.searchCount,
    summary.runningSearchCount,
    onlyCompletedCounts,
  );
  const webSearchCount = completedCount(
    summary.webSearchCount,
    summary.runningWebSearchCount,
    onlyCompletedCounts,
  );
  const toolCount = completedCount(
    summary.toolCount,
    summary.runningToolCount,
    onlyCompletedCounts,
  );
  const parts: string[] = [];

  if (exploredFileCount > 0) parts.push(`已读取 ${exploredFileCount} 个文件`);
  if (searchCount > 0) parts.push("已搜索工作区");
  if (listCount > 0) parts.push(`已列出 ${listCount} 次`);
  if (fileCreateCount > 0) parts.push(`已创建 ${fileCreateCount} 个文件`);
  if (fileEditCount > 0) parts.push(`已编辑 ${fileEditCount} 个文件`);
  if (fileDeleteCount > 0) parts.push(`已删除 ${fileDeleteCount} 个文件`);
  if (summary.approvedPermissionRequestCount > 0)
    parts.push(`已批准 ${summary.approvedPermissionRequestCount} 个请求`);
  if (summary.deniedPermissionRequestCount > 0)
    parts.push(`已拒绝 ${summary.deniedPermissionRequestCount} 个请求`);
  if (commandCount > 0) parts.push(`已运行 ${commandCount} 条命令`);
  if (webSearchCount > 0) parts.push(`已搜索 ${webSearchCount} 次`);
  if (toolCount > 0) parts.push(`已使用 ${toolCount} 个工具`);
  return parts;
}

export function summarizeActivityItems(
  items: ProcessItem[],
): WorkflowActivitySummary {
  const settlePendingPermissions = shouldSettlePendingPermissions(items);
  const settleStaleRunningItems =
    settlePendingPermissions || shouldSettleStaleRunningItems(items);
  return items.reduce<WorkflowActivitySummary>((summary, item) => {
    const running = workflowItemIsRunning(item) && !settleStaleRunningItems;
    if (item.type === "commandExecution") {
      summarizeCommandExecutionItem(summary, item, running);
    } else if (item.type === "fileChange") {
      summarizeFileChangeItem(summary, item, running);
    } else if (item.type === "permissionRequest") {
      summarizePermissionRequestItem(summary, item, settlePendingPermissions);
    } else if (item.type === "webSearch") {
      summary.webSearchCount += 1;
      if (running) summary.runningWebSearchCount += 1;
    } else if (item.type === "imageView") {
      summary.imageCount += 1;
    } else {
      summarizeToolLikeItem(summary, item, running);
    }

    if (running) summary.runningCount += 1;
    return summary;
  }, emptyActivitySummary());
}

function shouldSettleStaleRunningItems(items: ProcessItem[]): boolean {
  const hasDeniedPermission = items.some((item) => {
    if (item.type !== "permissionRequest") return false;
    const status = item.status.toLowerCase();
    return (
      status === "failed" ||
      status === "error" ||
      status === "denied" ||
      status === "cancelled" ||
      status === "canceled"
    );
  });
  if (!hasDeniedPermission) return false;
  return items.some((item) => {
    if (item.type === "permissionRequest" || !("status" in item)) return false;
    const status = String(item.status).toLowerCase();
    return (
      status === "failed" ||
      status === "error" ||
      status === "cancelled" ||
      status === "canceled"
    );
  });
}

function shouldSettlePendingPermissions(items: ProcessItem[]): boolean {
  const hasPendingPermission = items.some(
    (item) => item.type === "permissionRequest" && workflowItemIsRunning(item),
  );
  if (!hasPendingPermission) return false;
  const hasActiveNonPermissionItem = items.some(
    (item) => item.type !== "permissionRequest" && workflowItemIsRunning(item),
  );
  if (hasActiveNonPermissionItem) return false;
  return items.some((item) => {
    if (item.type === "permissionRequest") return false;
    if (!("status" in item)) return false;
    const status = String(item.status).toLowerCase();
    return (
      status === "failed" ||
      status === "error" ||
      status === "cancelled" ||
      status === "canceled"
    );
  });
}

function summarizePermissionRequestItem(
  summary: WorkflowActivitySummary,
  item: Extract<ProcessItem, { type: "permissionRequest" }>,
  settlePending: boolean,
): void {
  const status = item.status.toLowerCase();
  if (workflowStatusIsRunning(status)) {
    if (settlePending) {
      summary.deniedPermissionRequestCount += 1;
      return;
    }
    summary.waitingPermissionRequestCount += 1;
    return;
  }
  if (
    status === "failed" ||
    status === "error" ||
    status === "denied" ||
    status === "cancelled" ||
    status === "canceled"
  ) {
    summary.deniedPermissionRequestCount += 1;
    return;
  }
  summary.approvedPermissionRequestCount += 1;
}

function summarizeToolLikeItem(
  summary: WorkflowActivitySummary,
  item: ProcessItem,
  running: boolean,
): void {
  const name = workflowLayoutToolName(item).toLowerCase();
  const input = itemInputText(item);

  if (isReadToolName(name)) {
    const count = Math.max(1, toolTargetCount(input));
    summary.exploredFileCount += count;
    if (running) summary.runningExploredFileCount += count;
    return;
  }

  if (isListToolName(name)) {
    summary.listCount += 1;
    if (running) summary.runningListCount += 1;
    return;
  }

  if (isSearchToolName(name)) {
    summary.searchCount += 1;
    if (running) summary.runningSearchCount += 1;
    return;
  }

  if (isEditToolName(name)) {
    summary.fileEditCount += 1;
    if (running) summary.runningFileEditCount += 1;
    return;
  }

  summary.toolCount += 1;
  if (running) summary.runningToolCount += 1;
}

function summarizeCommandExecutionItem(
  summary: WorkflowActivitySummary,
  item: Extract<ProcessItem, { type: "commandExecution" }>,
  running: boolean,
): void {
  const commands = commandLines(item);
  for (const command of commands) {
    const kind = commandSummaryKind(command);
    if (kind === "read") {
      summary.exploredFileCount += 1;
      if (running) summary.runningExploredFileCount += 1;
    } else if (kind === "search") {
      summary.searchCount += 1;
      if (running) summary.runningSearchCount += 1;
    } else if (kind === "list") {
      summary.listCount += 1;
      if (running) summary.runningListCount += 1;
    } else if (kind === "folder") {
      summary.commandCount += 1;
      if (running) summary.runningFolderCreateCount += 1;
    } else if (kind === "web") {
      summary.webSearchCount += 1;
      if (running) summary.runningWebSearchCount += 1;
    } else {
      summary.commandCount += 1;
      if (running) summary.runningCommandCount += 1;
    }
  }
}

function summarizeFileChangeItem(
  summary: WorkflowActivitySummary,
  item: Extract<ProcessItem, { type: "fileChange" }>,
  running: boolean,
): void {
  if (!item.changes.length) {
    summary.fileEditCount += 1;
    if (running) summary.runningFileEditCount += 1;
    return;
  }

  for (const change of item.changes) {
    const kind = fileChangeKind(change.kind);
    if (kind === "create") {
      summary.fileCreateCount += 1;
      if (running) summary.runningFileCreateCount += 1;
    } else if (kind === "delete") {
      summary.fileDeleteCount += 1;
      if (running) summary.runningFileDeleteCount += 1;
    } else {
      summary.fileEditCount += 1;
      if (running) summary.runningFileEditCount += 1;
    }
    const stats = patchLineStats(change.diff?.text ?? "");
    summary.addedLineCount += stats.added;
    summary.removedLineCount += stats.removed;
    if (running) {
      summary.runningAddedLineCount += stats.added;
      summary.runningRemovedLineCount += stats.removed;
      if (kind === "create") summary.runningWrittenLineCount += stats.added;
    }
  }
}
