import type { ReactNode } from "react";
import type { WorkflowActivityGroup, WorkflowFlowEntry } from "../";
import type { WorkflowTurnItem } from "../../../../../shared/adapters/workflow-messages-to-read-thread";
import { codexActivityHeaderState } from "./codex-activity-contract";

type AgentMessageItem = Extract<WorkflowTurnItem, { type: "agentMessage" }>;
type ProcessItem = Exclude<
  WorkflowTurnItem,
  { type: "agentMessage" | "userMessage" }
>;

interface Props {
  entries: WorkflowFlowEntry[];
  expanded: boolean;
  isStreaming?: boolean;
  renderActivityGroup: (
    group: WorkflowActivityGroup,
    defaultDetailExpanded: boolean,
    active: boolean,
    thinking: boolean,
  ) => ReactNode;
  renderActivityItem: (item: ProcessItem) => ReactNode;
  renderAssistantMessage: (item: AgentMessageItem) => ReactNode;
}

export function WorkflowAgentFlowSection({
  entries,
  expanded,
  isStreaming = false,
  renderActivityGroup,
  renderActivityItem,
  renderAssistantMessage,
}: Props) {
  const visibleEntries = expanded
    ? entries
    : entries.filter(
        (entry) => entry.kind === "assistantMessage" && entry.isFinal,
      );
  if (!visibleEntries.length) return null;

  return (
    <div className="workflow-agent-flow-section" data-kind="agent-flow-section">
      {visibleEntries.map((entry, index) => {
        if (entry.kind === "assistantMessage")
          return renderAssistantMessage(entry.item);
        if (entry.kind === "activityItem")
          return renderActivityItem(entry.item);
        const headerState = codexActivityHeaderState(entry.group.items, {
          isLatestGroup: index === visibleEntries.length - 1,
          isTurnInProgress: isStreaming,
        });
        return renderActivityGroup(
          entry.group,
          false,
          headerState.kind === "active",
          headerState.kind === "thinking",
        );
      })}
    </div>
  );
}
