import type { ReactNode } from "react";
import { WorkflowActivityRenderer, WorkflowAgentFlowSection } from "../";
import type { AgentMessageItem, WorkflowFlowEntry } from "./turn-layout";

/**
 * 活动流区块：一段 leadingFlow/trailingFlow 的渲染封装。
 * 从 AssistantTurn 提取（Phase 4），渲染逻辑不变。
 */
interface Props {
  entries: WorkflowFlowEntry[];
  expanded: boolean;
  isLastStreaming: boolean;
  renderAssistantMessage: (item: AgentMessageItem) => ReactNode;
}

export function WorkflowTurnFlowSection({
  entries,
  expanded,
  isLastStreaming,
  renderAssistantMessage,
}: Props) {
  if (!entries.length) return null;

  return (
    <WorkflowAgentFlowSection
      entries={entries}
      expanded={expanded}
      isStreaming={isLastStreaming}
      renderActivityGroup={(group, defaultDetailExpanded, active, thinking) => (
        <WorkflowActivityRenderer
          key={group.id}
          kind="activityGroup"
          group={group}
          defaultDetailExpanded={!isLastStreaming && defaultDetailExpanded}
          expanded={expanded}
          active={active}
          thinking={thinking}
        />
      )}
      renderActivityItem={(item) => (
        <WorkflowActivityRenderer
          key={item.id}
          kind="activityItem"
          item={item}
        />
      )}
      renderAssistantMessage={renderAssistantMessage}
    />
  );
}
