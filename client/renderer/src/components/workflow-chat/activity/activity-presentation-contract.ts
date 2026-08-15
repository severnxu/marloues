import type { WorkflowTurnItem } from "@shared/workflow-read-thread-contract";
import type { WorkflowActivitySummary } from "../turns/turn-layout";
import {
  codexActivityActiveItem,
  codexActivityGroupDisplayLabel,
  codexActivityItemStateLabel,
} from "./codex-activity-contract";

type ProcessItem = Exclude<
  WorkflowTurnItem,
  { type: "agentMessage" | "userMessage" }
>;

export function activityGroupDisplayLabel(
  summary: WorkflowActivitySummary,
  items: ProcessItem[],
  completedLabel: string,
): string {
  if (summary.runningCount <= 0) return completedLabel;
  const latest = codexActivityActiveItem(items);
  return latest
    ? codexActivityGroupDisplayLabel(summary, items, true)
    : "正在思考";
}

export function activityActiveItem(items: ProcessItem[]): ProcessItem | null {
  return codexActivityActiveItem(items);
}

export function activityItemStateLabel(item: ProcessItem): string {
  return codexActivityItemStateLabel(item, true);
}
