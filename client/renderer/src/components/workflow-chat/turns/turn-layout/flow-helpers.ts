import {
  workflowIsCollapsibleActivityItem,
  workflowItemIsRunning,
  workflowLayoutToolName,
  workflowShouldKeepSingleActivityItem,
  workflowShouldShowActivityItem,
} from "../turn-collapse-rules";
import type {
  AgentMessageItem,
  ProcessItem,
  WorkflowFlowEntry,
  WorkflowTurnLayoutOptions,
} from "./types";
import type { WorkflowTurnItem } from "../../../../../../shared/adapters/workflow-messages-to-read-thread";
import { summarizeActivityItems } from "./summary-helpers";

export function workflowFlowEntries(
  items: WorkflowTurnItem[],
  finalAgentIndexes: Set<number>,
  options: WorkflowTurnLayoutOptions,
): Array<{ index: number; entry: WorkflowFlowEntry }> {
  const flow: Array<{ index: number; entry: WorkflowFlowEntry }> = [];
  let groupItems: ProcessItem[] = [];
  let groupStartIndex = -1;

  const flushGroup = () => {
    if (!groupItems.length) return;
    if (workflowShouldKeepSingleActivityItem(groupItems)) {
      flow.push({
        index: groupStartIndex,
        entry: { kind: "activityItem", item: groupItems[0] },
      });
      groupItems = [];
      groupStartIndex = -1;
      return;
    }
    flow.push({
      index: groupStartIndex,
      entry: {
        kind: "activityGroup",
        group: {
          id: groupItems.map((item) => item.id).join("-"),
          items: groupItems,
          summary: summarizeActivityItems(groupItems),
        },
      },
    });
    groupItems = [];
    groupStartIndex = -1;
  };

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item) continue;
    if (item.type === "userMessage") continue;
    if (item.type === "agentMessage") {
      flushGroup();
      if (item.text.trim())
        flow.push({
          index,
          entry: {
            kind: "assistantMessage",
            item,
            isFinal: finalAgentIndexes.has(index),
          },
        });
      continue;
    }
    if (
      isSilentProcessBoundary(item) &&
      isBetweenFinalAgentRun(index, finalAgentIndexes)
    ) {
      continue;
    }
    if (!workflowShouldShowActivityItem(item)) {
      continue;
    }
    if (shouldHideReasoningItem(item, options)) {
      continue;
    }
    if (!workflowIsCollapsibleActivityItem(item)) {
      flushGroup();
      flow.push({ index, entry: { kind: "activityItem", item } });
      continue;
    }

    if (workflowShouldSplitRunningToolItem(item)) {
      flushGroup();
      flow.push({ index, entry: { kind: "activityItem", item } });
      continue;
    }

    if (!groupItems.length) groupStartIndex = index;
    groupItems.push(item);
  }

  flushGroup();
  return flow;
}

export function shouldHideReasoningItem(
  item: ProcessItem,
  options: WorkflowTurnLayoutOptions,
): boolean {
  return Boolean(options.hideReasoning && item.type === "reasoning");
}

function workflowShouldSplitRunningToolItem(item: ProcessItem): boolean {
  return workflowItemIsRunning(item);
}

export function findFinalAgentMessageIndexes(
  items: WorkflowTurnItem[],
): Set<number> {
  const semanticFinalIndexes = findSemanticFinalAgentIndexes(items);
  if (semanticFinalIndexes) return semanticFinalIndexes;

  const indexes = new Set<number>();
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.type === "agentMessage" && item.text.trim()) {
      indexes.add(index);
      for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
        const previous = items[cursor];
        if (!previous || previous.type === "userMessage") continue;
        if (previous.type === "agentMessage") {
          if (previous.text.trim()) indexes.add(cursor);
          continue;
        }
        if (isSilentProcessBoundary(previous)) continue;
        break;
      }
      return indexes;
    }
  }
  return indexes;
}

function findSemanticFinalAgentIndexes(
  items: WorkflowTurnItem[],
): Set<number> | null {
  const indexes = new Set<number>();
  let hasSemanticPhase = false;

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item?.type !== "agentMessage") continue;
    const phase = item.phase?.trim().toLowerCase();
    if (phase !== "commentary" && phase !== "final_answer" && phase !== "final")
      continue;
    hasSemanticPhase = true;
    if ((phase === "final_answer" || phase === "final") && item.text.trim())
      indexes.add(index);
  }

  return hasSemanticPhase ? indexes : null;
}

export function finalAssistantTextFromIndexes(
  items: WorkflowTurnItem[],
  indexes: Set<number>,
): string {
  return [...indexes]
    .sort((a, b) => a - b)
    .map((index) => items[index])
    .filter((item): item is AgentMessageItem => item?.type === "agentMessage")
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

function isSilentProcessBoundary(
  item: Exclude<WorkflowTurnItem, AgentMessageItem | { type: "userMessage" }>,
): boolean {
  if (item.type === "contextCompaction") return true;
  if (item.type === "dynamicToolCall" || item.type === "mcpToolCall") {
    return (
      workflowLayoutToolName(item) === "token_count" ||
      workflowLayoutToolName(item).endsWith(".token_count")
    );
  }
  return false;
}

function isBetweenFinalAgentRun(
  index: number,
  finalAgentIndexes: Set<number>,
): boolean {
  if (finalAgentIndexes.size < 2) return false;
  const sorted = [...finalAgentIndexes].sort((a, b) => a - b);
  return index > sorted[0] && index < sorted[sorted.length - 1];
}

export function flowActivityItems(entries: WorkflowFlowEntry[]): ProcessItem[] {
  return entries.flatMap((entry) => {
    if (entry.kind === "activityGroup") return entry.group.items;
    if (entry.kind === "activityItem") return [entry.item];
    return [];
  });
}
