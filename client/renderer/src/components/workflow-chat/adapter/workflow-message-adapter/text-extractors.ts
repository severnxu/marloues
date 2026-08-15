import type { WorkflowTurnItem, WorkflowMessageBlock } from "./types";
import { stripThinkTags, formatValue } from "./shared-helpers";

export function finalAssistantText(block: WorkflowMessageBlock): string {
  const indexes = finalAssistantMessageIndexes(block.items);
  if (indexes.size) {
    return [...indexes]
      .sort((a, b) => a - b)
      .map((index) => block.items[index])
      .filter(
        (item): item is Extract<WorkflowTurnItem, { type: "agentMessage" }> =>
          item?.type === "agentMessage",
      )
      .map((item) => stripThinkTags(item.text))
      .filter(Boolean)
      .join("\n\n");
  }

  for (let index = block.items.length - 1; index >= 0; index -= 1) {
    const item = block.items[index];
    if (item?.type !== "agentMessage") continue;
    const text = stripThinkTags(item.text);
    if (text) return text;
  }
  return "";
}

function finalAssistantMessageIndexes(items: WorkflowTurnItem[]): Set<number> {
  const indexes = new Set<number>();
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.type !== "agentMessage" || !stripThinkTags(item.text)) continue;
    indexes.add(index);
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const previous = items[cursor];
      if (!previous || previous.type === "userMessage") continue;
      if (previous.type === "agentMessage") {
        if (stripThinkTags(previous.text)) indexes.add(cursor);
        continue;
      }
      if (isSilentFinalBoundary(previous)) continue;
      break;
    }
    return indexes;
  }
  return indexes;
}

function isSilentFinalBoundary(
  item: Exclude<
    WorkflowTurnItem,
    { type: "agentMessage" } | { type: "userMessage" }
  >,
): boolean {
  if (item.type === "contextCompaction") return true;
  if (item.type === "dynamicToolCall")
    return item.tool.toLowerCase() === "token_count";
  if (item.type === "mcpToolCall") {
    const name = [item.server, item.tool]
      .filter(Boolean)
      .join(".")
      .toLowerCase();
    return name === "token_count" || name.endsWith(".token_count");
  }
  return false;
}

export function itemOutputText(item: WorkflowTurnItem): string {
  if ("output" in item && item.output) return item.output.text;
  return "";
}

export function itemInputText(item: WorkflowTurnItem): string {
  if (item.type === "commandExecution") return item.command;
  if (item.type === "mcpToolCall" || item.type === "dynamicToolCall")
    return formatValue(item.arguments ?? "");
  if (item.type === "webSearch")
    return formatValue(item.action ?? item.query ?? "");
  if (item.type === "imageGeneration") return item.revisedPrompt ?? "";
  if (item.type === "collabAgentToolCall") return item.prompt ?? "";
  if (item.type === "plan") return item.text;
  if (item.type === "reasoning") return item.summary;
  return "";
}
