import type { WorkflowTurnItem } from "@shared/workflow-read-thread-contract";
import type { WorkflowActivitySummary } from "../turns/turn-layout";
import { itemInputText } from "../adapter/item-text";

type ProcessItem = Exclude<
  WorkflowTurnItem,
  { type: "agentMessage" | "userMessage" }
>;
type ToolItem = Extract<
  ProcessItem,
  { type: "mcpToolCall" | "dynamicToolCall" }
>;

export type CodexActivityGrouping = "groupable" | "standalone" | "hidden";
export type CodexActivityIconKind =
  | "browser"
  | "command"
  | "edit"
  | "file"
  | "image"
  | "permission"
  | "search"
  | "tool";
export type CodexActivityHeaderState =
  | { kind: "active"; item: ProcessItem }
  | { kind: "thinking" }
  | { kind: "summary" };

export const CODEX_ACTIVITY_DETAIL_MAX_HEIGHT_PX = 224;
export const CODEX_ACTIVITY_SUMMARY_DEFER_MS = 1_000;
export const CODEX_CONVERSATION_CONTRACT_VERSION = "26.803.10989";

export function codexActivityPresentationItems(
  items: WorkflowTurnItem[],
): WorkflowTurnItem[] {
  return items.filter((item, index) => {
    if (
      item.type !== "agentMessage" &&
      item.type !== "userMessage" &&
      codexActivityGrouping(item) === "hidden"
    )
      return false;
    return !isCodeModeWrapper(items, index);
  });
}

export function codexActivityGrouping(
  item: ProcessItem,
): CodexActivityGrouping {
  if (item.type === "reasoning") return "hidden";
  if (item.type === "webSearch" && !item.query?.trim()) return "hidden";
  if (item.type === "permissionRequest") return "standalone";
  if (item.type === "dynamicToolCall" || item.type === "mcpToolCall") {
    const name = normalizedToolName(item);
    if (
      name === "token_count" ||
      name.endsWith(".token_count") ||
      name === "wait"
    )
      return "hidden";
    return "groupable";
  }
  if (
    item.type === "commandExecution" ||
    item.type === "fileChange" ||
    item.type === "webSearch" ||
    item.type === "collabAgentToolCall"
  )
    return "groupable";
  return "standalone";
}

export function codexActivityShouldRenderStandalone(
  items: ProcessItem[],
  isRunning: (item: ProcessItem) => boolean,
): boolean {
  if (items.length !== 1) return false;
  const item = items[0];
  if (!item || isRunning(item)) return false;
  if (item.type === "fileChange") return item.changes.length <= 1;
  return (
    item.type === "commandExecution" ||
    item.type === "mcpToolCall" ||
    item.type === "dynamicToolCall" ||
    item.type === "webSearch"
  );
}

export function codexActivityIsBrowserTool(
  item: ProcessItem,
): item is ToolItem {
  if (item.type !== "mcpToolCall" && item.type !== "dynamicToolCall")
    return false;
  const name = normalizedToolName(item);
  if (name.includes("browser")) return true;
  if (name !== "js" && !name.includes("node_repl")) return false;
  const args = argumentsRecord(item.arguments);
  const code = String(args?.code ?? "").toLowerCase();
  const title = String(args?.title ?? "").toLowerCase();
  return /\biab\b|playwright|browser|浏览器|frame(locator)?|openTabs|claimTab/i.test(
    `${code} ${title}`,
  );
}

export function codexActivityToolTitle(item: ProcessItem): string | null {
  if (!codexActivityIsBrowserTool(item)) return null;
  const title = argumentsRecord(item.arguments)?.title;
  return typeof title === "string" && title.trim() ? title.trim() : null;
}

export function codexActivityGroupSummaryLabel(
  summary: WorkflowActivitySummary,
  items: ProcessItem[],
): string {
  const browserToolCount = items.filter(codexActivityIsBrowserTool).length;
  const genericToolCount = Math.max(0, summary.toolCount - browserToolCount);
  const fileCount =
    summary.fileCreateCount + summary.fileEditCount + summary.fileDeleteCount;
  const explorationCount =
    summary.exploredFileCount + summary.searchCount + summary.listCount;
  const parts: string[] = [];
  if (browserToolCount > 0) parts.push("已使用 浏览器");
  if (fileCount > 0)
    parts.push(
      fileCount === 1
        ? "编辑了一个文件"
        : parts.length === 0
          ? "编辑了文件"
          : "编辑了多个文件",
    );
  if (explorationCount > 0) parts.push("读取文件");
  if (summary.commandCount > 0) parts.push("运行了命令");
  if (summary.webSearchCount > 0) parts.push("已搜索网页");
  if (genericToolCount > 0) parts.push("调用了工具");
  if (summary.imageCount > 0) parts.push("查看了图像");
  return parts.join("");
}

export function codexActivityGroupDisplayLabel(
  summary: WorkflowActivitySummary,
  items: ProcessItem[],
  active = summary.runningCount > 0,
): string {
  const latest = codexActivityActiveItem(items);
  if (active && latest) return codexActivityItemStateLabel(latest, true);
  return codexActivityGroupSummaryLabel(summary, items);
}

export function codexActivityHeaderState(
  items: ProcessItem[],
  options: {
    isLatestGroup: boolean;
    isTurnInProgress: boolean;
    isSliceClosed?: boolean;
  },
): CodexActivityHeaderState {
  if (
    !options.isLatestGroup ||
    !options.isTurnInProgress ||
    options.isSliceClosed
  )
    return { kind: "summary" };
  const item = codexActivityActiveItem(items);
  return item ? { kind: "active", item } : { kind: "thinking" };
}

export function codexActivityItemStateLabel(
  item: ProcessItem,
  forceRunning = false,
): string {
  const running = forceRunning || itemIsRunning(item);
  if (item.type === "commandExecution") {
    const command = compactActivityText(item.command);
    return running
      ? `正在运行 ${command || "命令"}`
      : `已运行 ${command || "命令"}`;
  }
  if (item.type === "fileChange")
    return running ? "正在编辑文件" : "已编辑文件";
  if (item.type === "mcpToolCall" || item.type === "dynamicToolCall") {
    const title = codexActivityToolTitle(item);
    if (title) {
      if (/^(已|正在)/.test(title))
        return title.replace(/^(已|正在)/, running ? "正在" : "已");
      return running ? `正在运行 ${title}` : title;
    }
    const tool = item.tool || compactActivityText(itemInputText(item));
    return running ? `正在运行 ${tool}` : `已运行 ${tool}`;
  }
  if (item.type === "webSearch")
    return `${running ? "正在搜索" : "已搜索"} ${item.query ?? ""}`.trim();
  if (item.type === "imageView") return running ? "正在查看图像" : "已查看图像";
  if (item.type === "permissionRequest")
    return running ? `正在等待 ${item.toolName}` : `已处理 ${item.toolName}`;
  return running ? "正在处理" : "已处理";
}

export function codexActivityIconKind(
  item: ProcessItem,
): CodexActivityIconKind {
  if (codexActivityIsBrowserTool(item)) return "browser";
  if (item.type === "commandExecution") return "command";
  if (item.type === "fileChange") return "edit";
  if (item.type === "webSearch") return "search";
  if (item.type === "imageView" || item.type === "imageGeneration")
    return "image";
  if (item.type === "permissionRequest") return "permission";
  if (
    item.type === "plan" ||
    item.type === "hookPrompt" ||
    item.type === "contextCompaction"
  )
    return "file";
  return "tool";
}

export function codexActivityActiveItem(
  items: ProcessItem[],
): ProcessItem | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item && codexActivityGrouping(item) !== "hidden" && itemIsRunning(item))
      return item;
  }
  return null;
}

function itemIsRunning(item: ProcessItem): boolean {
  if (!("status" in item)) return false;
  const status = String(item.status).toLowerCase();
  return ["running", "pending", "in_progress", "inprogress"].includes(status);
}

function compactActivityText(value: string): string {
  const firstLine = value.trim().split(/\r?\n/)[0] ?? "";
  return firstLine.length > 132 ? `${firstLine.slice(0, 129)}…` : firstLine;
}

function isCodeModeWrapper(items: WorkflowTurnItem[], index: number): boolean {
  const item = items[index];
  if (item?.type !== "commandExecution" || item.shell !== "code_mode")
    return false;
  const next = items.slice(index + 1, index + 4).find((candidate) => {
    if (
      candidate.type !== "agentMessage" &&
      candidate.type !== "userMessage" &&
      codexActivityGrouping(candidate) === "hidden"
    )
      return false;
    return true;
  });
  if (!next) return false;
  if (next.type === "fileChange" && /apply_patch/i.test(item.command))
    return true;
  if (next.type !== "mcpToolCall" && next.type !== "dynamicToolCall")
    return false;
  const wrapper = canonicalToolName(item.command);
  if (wrapper && wrapper === canonicalToolName(normalizedToolName(next)))
    return true;
  return /\bALL_TOOLS\b|\btools\s*\[|\btools\s*\.|mcp__node_repl__js|node repl unavailable/i.test(
    item.command,
  );
}

function normalizedToolName(item: ToolItem): string {
  return item.type === "mcpToolCall"
    ? [item.server, item.tool].filter(Boolean).join(".").toLowerCase() ||
        item.tool.toLowerCase()
    : item.tool.toLowerCase();
}

function canonicalToolName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^mcp__/, "")
    .replace(/__/g, ".");
}

function argumentsRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value))
    return value as Record<string, unknown>;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
