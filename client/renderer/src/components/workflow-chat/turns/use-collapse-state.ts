import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkflowMessageBlock } from "../../../../../shared/adapters/workflow-messages-to-read-thread";
import {
  workflowTurnDefaultCollapsed,
  workflowTurnIsCompleted,
} from "./turn-collapse-rules";
import {
  workflowTurnCollapseStateKey,
  nextWorkflowTurnCollapseState,
  type WorkflowTurnCollapseRuntimeState,
} from "./turn-collapse-state";

export type WorkflowCollapseState = {
  isTurnExpanded: (
    message: Pick<WorkflowMessageBlock, "id" | "activity" | "status">,
  ) => boolean;
  setTurnExpanded: (messageId: string, expanded: boolean) => void;
};

export type WorkflowCollapseMessage = Pick<
  WorkflowMessageBlock,
  "id" | "activity" | "status"
>;

export function useWorkflowCollapseState({
  isStreaming,
  scope,
  workflowMessages,
  defaultExpandedMessageId,
}: {
  isStreaming: boolean;
  scope: string;
  workflowMessages: WorkflowCollapseMessage[];
  defaultExpandedMessageId?: string;
}): WorkflowCollapseState {
  const [collapsedTurnsById, setCollapsedTurnsById] = useState<
    Record<string, boolean>
  >({});
  const previousTurnsRef = useRef(
    new Map<string, WorkflowTurnCollapseRuntimeState>(),
  );

  useEffect(() => {
    previousTurnsRef.current = new Map();
    setCollapsedTurnsById({});
  }, [scope]);

  useEffect(() => {
    setCollapsedTurnsById((current) => {
      const result = nextWorkflowTurnCollapseState({
        collapsedTurnsById: current,
        isStreaming,
        previousRuntimeByKey: previousTurnsRef.current,
        scope,
        workflowMessages,
        defaultExpandedMessageId,
      });
      previousTurnsRef.current = result.runtimeByKey;
      return result.collapsedTurnsById;
    });
  }, [defaultExpandedMessageId, isStreaming, scope, workflowMessages]);

  const isTurnExpanded = useCallback(
    (message: Pick<WorkflowMessageBlock, "id" | "activity" | "status">) => {
      const key = workflowTurnCollapseStateKey(scope, message.id);
      const previous = previousTurnsRef.current.get(key);
      // Collapse synchronously on the first completion render. Waiting for the
      // effect would briefly mount the entire long running trace and can lock
      // the renderer before React gets a chance to apply the collapsed state.
      if (workflowTurnIsCompleted(message) && previous?.isLastStreaming) {
        return message.id === defaultExpandedMessageId;
      }
      const defaultCollapsed =
        workflowTurnDefaultCollapsed(message) &&
        message.id !== defaultExpandedMessageId;
      return !(collapsedTurnsById[key] ?? defaultCollapsed);
    },
    [collapsedTurnsById, defaultExpandedMessageId, scope],
  );

  const setTurnExpanded = useCallback(
    (messageId: string, expanded: boolean) => {
      const key = workflowTurnCollapseStateKey(scope, messageId);
      setCollapsedTurnsById((current) => {
        const collapsed = !expanded;
        if (current[key] === collapsed) return current;
        return { ...current, [key]: collapsed };
      });
    },
    [scope],
  );

  return {
    isTurnExpanded,
    setTurnExpanded,
  };
}
