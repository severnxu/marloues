import type {
  WorkflowMessageBlock,
  WorkflowTurnItem,
} from "../../../../../shared/adapters/workflow-messages-to-read-thread";
import {
  workflowItemIsRunning,
  workflowShouldShowActivityItem,
  type WorkflowProcessItem,
} from "./turn-collapse-rules";
import type { WorkflowTurnLayout } from "./turn-layout";

export type WorkflowTurnPresentation =
  | {
      type: "thinking-empty";
      showHeader: false;
      showThinkingPlaceholder: true;
      statusLabel: string;
      thinkingVisible: boolean;
    }
  | { type: "active-flow"; showHeader: true; showThinkingPlaceholder: false }
  | {
      type: "answering";
      showHeader: true;
      showThinkingPlaceholder: boolean;
      statusLabel?: string;
      thinkingVisible?: boolean;
    }
  | {
      type: "processing-hidden";
      showHeader: true;
      showThinkingPlaceholder: false;
    }
  | {
      type: "complete";
      showHeader: boolean;
      showThinkingPlaceholder: false;
    }
  | { type: "continuation"; showHeader: false; showThinkingPlaceholder: false }
  | { type: "failed"; showHeader: true; showThinkingPlaceholder: false }
  | { type: "none"; showHeader: false; showThinkingPlaceholder: false };

export function workflowTurnPresentation(
  message: WorkflowMessageBlock,
  layout: WorkflowTurnLayout,
  isLastStreaming: boolean,
): WorkflowTurnPresentation {
  // An applied steer splits one visual turn into chronological slices. Only
  // the first slice owns the status header; continuation slices never add a
  // second "processed" / "processing" row.
  if (message.continuesPreviousTurn) {
    return {
      type: "continuation",
      showHeader: false,
      showThinkingPlaceholder: false,
    };
  }

  if (message.activity === "failed" || message.status === "failed") {
    return { type: "failed", showHeader: true, showThinkingPlaceholder: false };
  }

  if (message.activity === "done" || message.status === "completed") {
    return {
      type: "complete",
      showHeader: true,
      showThinkingPlaceholder: false,
    };
  }

  if (layout.finalText.trim()) {
    const showGapThinking = isLastStreaming && hasAnswerGap(layout);
    return {
      type: "answering",
      showHeader: true,
      showThinkingPlaceholder: showGapThinking,
      statusLabel: showGapThinking ? "正在思考" : undefined,
      thinkingVisible: showGapThinking ? true : undefined,
    };
  }

  if (layout.leadingFlow.length > 0 || layout.trailingFlow.length > 0) {
    if (
      hasVisibleRunningWork([
        ...layout.leadingActivityItems,
        ...layout.trailingActivityItems,
      ])
    ) {
      return {
        type: "active-flow",
        showHeader: true,
        showThinkingPlaceholder: false,
      };
    }
    if (isLastStreaming && message.status === "running") {
      return {
        type: "answering",
        showHeader: true,
        showThinkingPlaceholder: true,
        statusLabel: "正在思考",
        thinkingVisible: true,
      };
    }
    return {
      type: "processing-hidden",
      showHeader: true,
      showThinkingPlaceholder: false,
    };
  }

  if (!isLastStreaming || message.status !== "running") {
    return { type: "none", showHeader: false, showThinkingPlaceholder: false };
  }

  if (hasHiddenRunningWork(message.items)) {
    return {
      type: "thinking-empty",
      showHeader: false,
      showThinkingPlaceholder: true,
      statusLabel: "正在思考",
      thinkingVisible: true,
    };
  }

  return {
    type: "thinking-empty",
    showHeader: false,
    showThinkingPlaceholder: true,
    statusLabel: "正在思考",
    thinkingVisible: true,
  };
}

function hasVisibleRunningWork(items: WorkflowProcessItem[]): boolean {
  return items.some(workflowItemIsRunning);
}

function hasHiddenRunningWork(items: WorkflowTurnItem[]): boolean {
  return items.some((item) => {
    if (item.type === "userMessage" || item.type === "agentMessage")
      return false;
    const processItem = item as WorkflowProcessItem;
    return (
      workflowItemIsRunning(processItem) &&
      !workflowShouldShowActivityItem(processItem)
    );
  });
}

function hasAnswerGap(layout: WorkflowTurnLayout): boolean {
  const flow = [...layout.leadingFlow, ...layout.trailingFlow];
  const lastEntry = flow[flow.length - 1];
  if (!lastEntry || lastEntry.kind === "assistantMessage") return false;
  return !hasVisibleRunningWork([
    ...layout.leadingActivityItems,
    ...layout.trailingActivityItems,
  ]);
}
