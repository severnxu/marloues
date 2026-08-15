import { itemInputText } from "../../";
import type { ToolCallRowItem } from "./types";
import { workflowStatusIsRunning } from "../../";

export function toolName(item: ToolCallRowItem): string {
  if (item.type === "mcpToolCall")
    return [item.server, item.tool].filter(Boolean).join(".") || item.tool;
  if (item.type === "dynamicToolCall") return item.tool.toLowerCase();
  if (item.type === "webSearch") return "web_search";
  if (item.type === "imageGeneration") return "image_generation";
  if (item.type === "plan") return "plan_snapshot";
  return "unknown";
}

export function itemStatus(item: ToolCallRowItem): string {
  if ("status" in item && typeof item.status === "string") return item.status;
  return "completed";
}

export function detailTitle(item: ToolCallRowItem): string {
  const name = toolName(item);
  if (name === "update_plan" || name === "plan_snapshot") return "Plan";
  if (name.includes("tool_search")) return "Tool search";
  if (item.type === "webSearch") return "Web search";
  if (item.type === "imageGeneration") return "Image generation";
  if (name === "token_count") return "Usage";
  if (name === "turn_aborted") return "Interrupted";
  if (name === "thread_rolled_back") return "Rolled back";
  const firstLine = itemInputText(item)
    .split(/\r?\n/)
    .find((line) => line.trim())
    ?.trim();
  if (firstLine && (name.includes("shell") || name.includes("command")))
    return compactCommand(firstLine);
  return name || item.type;
}

export function detailInputLabel(item: ToolCallRowItem): string {
  const name = toolName(item);
  if (name.includes("shell") || name.includes("command")) return "Command";
  if (name === "update_plan" || name === "plan_snapshot") return "Plan";
  if (name.includes("tool_search")) return "Query";
  if (item.type === "webSearch") return "Search";
  if (item.type === "imageGeneration") return "Prompt";
  if (name === "token_count") return "Usage";
  if (name === "js") return "Script";
  return "Input";
}

export function isReadToolName(name: string): boolean {
  return (
    name === "read" ||
    name.endsWith(".read") ||
    name === "read_file" ||
    name === "read_files" ||
    name.endsWith(".read_file") ||
    name.endsWith(".read_files")
  );
}

export function isListToolName(name: string): boolean {
  return (
    name === "list" ||
    name === "ls" ||
    name.endsWith(".ls") ||
    name === "glob" ||
    name.endsWith(".glob") ||
    name === "list_files" ||
    name === "get_directory_tree" ||
    name.endsWith(".list_files")
  );
}

export function isSearchToolName(name: string): boolean {
  return name.includes("search") || name === "grep" || name.endsWith(".grep");
}

export function isEditToolName(name: string): boolean {
  return (
    name.includes("apply_patch") ||
    name.includes("patch") ||
    name.includes("edit") ||
    name.includes("write")
  );
}

export function planStatusLabel(status: string): string {
  if (status === "completed") return "Completed";
  if (status === "in_progress") return "In progress";
  return "Pending";
}

export function planStatusTone(status: string): string {
  if (status === "completed") return "is-completed";
  if (status === "in_progress") return "is-running";
  return "is-pending";
}

export function exitCodeFromOutput(output: string): number | null {
  const match = output.match(/Exit code:\s*(-?\d+)/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

export function cleanDetailOutput(output: string): string {
  if (!output) return "";
  const normalized = output.replace(/\r/g, "").trim();
  const outputIndex = normalized.indexOf("\nOutput:\n");
  if (outputIndex >= 0)
    return normalized.slice(outputIndex + "\nOutput:\n".length).trim();
  return normalized
    .replace(/^Exit code:\s*-?\d+\n/i, "")
    .replace(/^Wall time:\s*.+\n/i, "")
    .replace(/^Output:\n/i, "")
    .trim();
}

export function compactCommandTarget(command: string, verb: string): string {
  const target = command
    .replace(new RegExp(`^${verb}\\s+(-Path\\s+)?`, "i"), "")
    .replace(/\s+-TotalCount\s+\d+.*/i, "")
    .trim()
    .replace(/^["']|["']$/g, "");
  return basename(target || "file");
}

export function compactCommand(command: string): string {
  return command;
}

export function toolTargetCount(value: string): number {
  if (!value.trim()) return 0;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) return parsed.length;
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      for (const key of ["files", "paths", "filePaths"]) {
        const entry = record[key];
        if (Array.isArray(entry)) return entry.length;
      }
    }
  } catch {
    const lines = value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length > 1) return lines.length;
  }
  return 0;
}

export function formatCompactNumber(value?: number): string {
  if (value === undefined) return "-";
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatPercent(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) return "-";
  return `${Math.round(value)}%`;
}

export function formatBytes(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function basename(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

export { workflowStatusIsRunning };
