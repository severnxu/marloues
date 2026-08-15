import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkflowMessageBlock as WorkflowMessageBlock } from "../../../../../shared/adapters/workflow-messages-to-read-thread";
import {
  workflowTurnDefaultCollapsed,
  workflowTurnShouldCollapseAfterRuntime,
  type WorkflowTurnRuntimeState,
} from "./turn-collapse-rules";

export type WorkflowTurnExpansionState = {
  expanded: boolean;
  setTurnExpanded: (next: boolean | ((current: boolean) => boolean)) => void;
  toggleTurnExpanded: () => void;
};

export function useWorkflowTurnExpansion({
  expanded: controlledExpanded,
  isLastStreaming,
  message,
  onExpandedChange,
}: {
  expanded?: boolean;
  isLastStreaming: boolean;
  message: Pick<WorkflowMessageBlock, "activity" | "id" | "status">;
  onExpandedChange?: (expanded: boolean) => void;
}): WorkflowTurnExpansionState {
  const defaultExpanded = !workflowTurnDefaultCollapsed(message);
  const [uncontrolledExpanded, setUncontrolledExpanded] =
    useState(defaultExpanded);
  const expanded = controlledExpanded ?? uncontrolledExpanded;
  const previousTurnStateRef = useRef<
    WorkflowTurnRuntimeState & { id: string }
  >({
    id: message.id,
    activity: message.activity,
    status: message.status,
    isLastStreaming,
  });

  const setTurnExpanded = useCallback(
    (next: boolean | ((current: boolean) => boolean)) => {
      const value = typeof next === "function" ? next(expanded) : next;
      if (controlledExpanded === undefined) setUncontrolledExpanded(value);
      onExpandedChange?.(value);
    },
    [controlledExpanded, expanded, onExpandedChange],
  );

  useEffect(() => {
    const previous = previousTurnStateRef.current;

    if (previous.id !== message.id) setTurnExpanded(defaultExpanded);
    if (isLastStreaming) setTurnExpanded(true);
    else if (
      workflowTurnShouldCollapseAfterRuntime(message, previous, isLastStreaming)
    )
      setTurnExpanded(false);

    previousTurnStateRef.current = {
      id: message.id,
      activity: message.activity,
      status: message.status,
      isLastStreaming,
    };
  }, [
    defaultExpanded,
    isLastStreaming,
    message,
    message.activity,
    message.id,
    message.status,
    setTurnExpanded,
  ]);

  const toggleTurnExpanded = useCallback(() => {
    setTurnExpanded((value) => !value);
  }, [setTurnExpanded]);

  return {
    expanded,
    setTurnExpanded,
    toggleTurnExpanded,
  };
}
