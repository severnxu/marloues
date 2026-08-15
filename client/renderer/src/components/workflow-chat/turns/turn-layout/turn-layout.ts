import {
  workflowIsResultCardSourceItem,
  workflowShouldShowProcessItem,
} from "../turn-collapse-rules";
import {
  findFinalAgentMessageIndexes,
  flowActivityItems,
  workflowFlowEntries,
  shouldHideReasoningItem,
} from "./flow-helpers";
import { finalAssistantTextFromIndexes } from "./flow-helpers";
import {
  workflowActivitySummaryCompletedParts,
  workflowActivitySummaryRunningParts,
} from "./summary-helpers";
import type {
  ProcessItem,
  WorkflowActivitySummary,
  WorkflowMessageBlock,
  WorkflowTurnLayout,
  WorkflowTurnLayoutOptions,
} from "./types";
import {
  codexActivityGroupSummaryLabel,
  codexActivityPresentationItems,
} from "../../activity/codex-activity-contract";

export function workflowTurnLayout(
  message: WorkflowMessageBlock,
  options: WorkflowTurnLayoutOptions = {},
): WorkflowTurnLayout {
  const presentationItems = codexActivityPresentationItems(message.items);
  const processItems = presentationItems
    .filter(
      (item): item is ProcessItem =>
        item.type !== "agentMessage" && item.type !== "userMessage",
    )
    .filter(workflowShouldShowProcessItem)
    .filter((item) => !shouldHideReasoningItem(item, options));
  const finalAgentIndexes = findFinalAgentMessageIndexes(presentationItems);
  const flow = workflowFlowEntries(
    presentationItems,
    finalAgentIndexes,
    options,
  );
  const flowEntries = flow.map((entry) => entry.entry);

  return {
    leadingFlow: flowEntries,
    trailingFlow: [],
    leadingActivityItems: flowActivityItems(flowEntries),
    trailingActivityItems: [],
    resultItems: processItems.filter(workflowIsResultCardSourceItem),
    finalText: finalAssistantTextFromIndexes(
      presentationItems,
      finalAgentIndexes,
    ),
  };
}

export function workflowActivitySummaryLabel(
  summary: WorkflowActivitySummary,
): string {
  const runningParts = workflowActivitySummaryRunningParts(summary);
  if (runningParts.length > 0) {
    return [
      ...runningParts,
      ...workflowActivitySummaryCompletedParts(summary, true),
    ].join(" · ");
  }
  return codexActivityGroupSummaryLabel(summary, []);
}
