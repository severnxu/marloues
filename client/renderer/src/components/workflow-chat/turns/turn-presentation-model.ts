import type { WorkflowMessageBlock } from "../../../../../shared/adapters/workflow-messages-to-read-thread";
import { workflowShouldShowProcessItem } from "./turn-collapse-rules";
import {
  workflowTurnDurationLabel,
  workflowTurnStatusLabel,
  workflowTurnStatusTone,
} from "./turn-status";
import { workflowTurnLayout } from "./turn-layout";
import { workflowTurnPresentation } from "./turn-presentation";
import {
  appendProcessBlock,
  finalDocumentEntries,
  finiteNumber,
  isProcessItem,
  presentationMessage,
  resultItemsForPresentation,
  runtimeKind,
  turnIsRunning,
  withoutFinalDocument,
} from "./turn-presentation-model-helpers";
import type {
  BuildTurnPresentationModelOptions,
  TurnPresentationBlock,
  TurnPresentationModel,
} from "./turn-presentation-model-types";

export function buildTurnPresentationModel(
  message: WorkflowMessageBlock,
  {
    isLastStreaming,
    modelName,
    liveItemWindow = DEFAULT_LIVE_ITEM_WINDOW,
  }: BuildTurnPresentationModelOptions,
): TurnPresentationModel {
  const renderedMessage = presentationMessage(
    message,
    isLastStreaming,
    liveItemWindow,
  );
  const layout = workflowTurnLayout(renderedMessage);
  const activityItems = [
    ...layout.leadingActivityItems,
    ...layout.trailingActivityItems,
  ];
  const hasActivityItems = activityItems.length > 0;
  const running = turnIsRunning(renderedMessage, isLastStreaming);
  const startedAt = finiteNumber(renderedMessage.startedAt);
  const completedAt = finiteNumber(renderedMessage.completedAt);
  const durationMs =
    finiteNumber(renderedMessage.durationMs) ??
    (startedAt != null && completedAt != null
      ? Math.max(0, completedAt - startedAt)
      : null);
  const finalEntries = finalDocumentEntries([
    ...layout.leadingFlow,
    ...layout.trailingFlow,
  ]);
  const showFileChanges = !running && renderedMessage.activity === "done";
  const resultItems = resultItemsForPresentation(
    layout.resultItems,
    showFileChanges,
  );
  const blocks: TurnPresentationBlock[] = [];

  appendProcessBlock(
    blocks,
    "leading",
    withoutFinalDocument(layout.leadingFlow),
  );
  if (layout.finalText.trim()) {
    blocks.push({
      kind: "document",
      id: `${renderedMessage.id}:document`,
      itemIds: finalEntries.map((entry) => entry.item.id),
      text: layout.finalText,
      tone:
        renderedMessage.activity === "failed" && !isLastStreaming
          ? "error"
          : "normal",
      streaming: running && isLastStreaming,
    });
  }
  appendProcessBlock(
    blocks,
    "trailing",
    withoutFinalDocument(layout.trailingFlow),
  );
  if (resultItems.length > 0) {
    blocks.push({
      kind: "results",
      id: `${renderedMessage.id}:results`,
      items: resultItems,
      showFileChanges,
    });
  }

  return {
    id: renderedMessage.id,
    userMessageId: renderedMessage.userMessageId,
    prompt: {
      text: renderedMessage.user,
      content: renderedMessage.userContent,
      createdAt: renderedMessage.startedAt,
    },
    runtime: {
      activity: renderedMessage.activity,
      status: renderedMessage.status,
      kind: runtimeKind(renderedMessage, layout.finalText, isLastStreaming),
      running,
      isLastStreaming,
      continuesPreviousTurn: Boolean(renderedMessage.continuesPreviousTurn),
      showDuration:
        !renderedMessage.continuesPreviousTurn &&
        (running || !(isLastStreaming && !hasActivityItems)),
      startedAt,
      completedAt,
      durationMs,
    },
    chrome: {
      presentation: workflowTurnPresentation(
        renderedMessage,
        layout,
        isLastStreaming,
      ),
      label: workflowTurnStatusLabel(renderedMessage, {
        hasActivityItems,
        isLastStreaming,
      }),
      tone: workflowTurnStatusTone(renderedMessage),
    },
    process: {
      hasActivityItems,
      stepCount: renderedMessage.items
        .filter(isProcessItem)
        .filter(workflowShouldShowProcessItem).length,
    },
    documentText: layout.finalText,
    blocks,
    metadata: {
      modelName:
        renderedMessage.modelName ?? renderedMessage.modelId ?? modelName,
      createdAt: renderedMessage.completedAt ?? renderedMessage.startedAt,
      usage: renderedMessage.usage,
      contextUsage: renderedMessage.contextUsage,
    },
  };
}

export const DEFAULT_LIVE_ITEM_WINDOW = 256;
export { workflowTurnDurationLabel };
export type {
  BuildTurnPresentationModelOptions,
  TurnPresentationBlock,
  TurnPresentationModel,
} from "./turn-presentation-model-types";
