import type { WorkflowMessageBlock } from "../../../../../shared/adapters/workflow-messages-to-read-thread";
import {
  workflowTurnIsCompleted,
  workflowTurnShouldCollapseAfterRuntime,
  workflowTurnStateKey,
  type WorkflowTurnRuntimeState,
} from "./turn-collapse-rules";

export type WorkflowTurnCollapseRuntimeState = WorkflowTurnRuntimeState;
type WorkflowCollapseMessage = Pick<
  WorkflowMessageBlock,
  "id" | "activity" | "status"
>;

export type WorkflowTurnCollapseStateResult = {
  collapsedTurnsById: Record<string, boolean>;
  runtimeByKey: Map<string, WorkflowTurnCollapseRuntimeState>;
};

export function workflowTurnCollapseStateKey(
  scope: string,
  messageId: string,
): string {
  return workflowTurnStateKey(scope, messageId);
}

export function nextWorkflowTurnCollapseState({
  collapsedTurnsById,
  isStreaming,
  previousRuntimeByKey,
  scope,
  workflowMessages,
  defaultExpandedMessageId,
}: {
  collapsedTurnsById: Record<string, boolean>;
  isStreaming: boolean;
  previousRuntimeByKey: Map<string, WorkflowTurnCollapseRuntimeState>;
  scope: string;
  workflowMessages: WorkflowCollapseMessage[];
  defaultExpandedMessageId?: string;
}): WorkflowTurnCollapseStateResult {
  let nextCollapsed = collapsedTurnsById;
  const runtimeByKey = new Map<string, WorkflowTurnCollapseRuntimeState>();
  const visibleTurnKeys = new Set<string>();

  workflowMessages.forEach((message, index) => {
    const key = workflowTurnCollapseStateKey(scope, message.id);
    const isLastStreaming =
      isStreaming && index === workflowMessages.length - 1;
    const previous = previousRuntimeByKey.get(key);
    const shouldCollapseAfterRuntime =
      message.id !== defaultExpandedMessageId &&
      workflowTurnIsCompleted(message) &&
      workflowTurnShouldCollapseAfterRuntime(
        message,
        previous,
        isLastStreaming,
      );

    visibleTurnKeys.add(key);
    runtimeByKey.set(key, {
      activity: message.activity,
      status: message.status,
      isLastStreaming,
    });

    if (!shouldCollapseAfterRuntime) return;
    if (key in collapsedTurnsById) return;
    if (nextCollapsed === collapsedTurnsById)
      nextCollapsed = { ...collapsedTurnsById };
    nextCollapsed[key] = true;
  });

  for (const key of Object.keys(nextCollapsed)) {
    if (visibleTurnKeys.has(key)) continue;
    if (nextCollapsed === collapsedTurnsById)
      nextCollapsed = { ...collapsedTurnsById };
    delete nextCollapsed[key];
  }

  return {
    collapsedTurnsById: nextCollapsed,
    runtimeByKey,
  };
}
