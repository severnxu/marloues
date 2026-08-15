import type {
  WorkflowMessageBlock,
  WorkflowTurnItem,
} from "../../../../../shared/adapters/workflow-messages-to-read-thread";
import type { WorkflowProcessItem } from "./turn-collapse-rules";
import type { WorkflowFlowEntry } from "./turn-layout";
import type {
  TurnPresentationBlock,
  TurnPresentationModel,
} from "./turn-presentation-model-types";

export function appendProcessBlock(
  blocks: TurnPresentationBlock[],
  placement: "leading" | "trailing",
  entries: WorkflowFlowEntry[],
): void {
  if (!entries.length) return;
  blocks.push({ kind: "process", id: `process:${placement}`, entries });
}

export function withoutFinalDocument(
  entries: WorkflowFlowEntry[],
): WorkflowFlowEntry[] {
  return entries.filter(
    (entry) => entry.kind !== "assistantMessage" || !entry.isFinal,
  );
}

export function finalDocumentEntries(
  entries: WorkflowFlowEntry[],
): Array<Extract<WorkflowFlowEntry, { kind: "assistantMessage" }>> {
  return entries.filter(
    (
      entry,
    ): entry is Extract<WorkflowFlowEntry, { kind: "assistantMessage" }> =>
      entry.kind === "assistantMessage" && entry.isFinal,
  );
}

export function presentationMessage(
  message: WorkflowMessageBlock,
  isLastStreaming: boolean,
  liveItemWindow: number,
): WorkflowMessageBlock {
  const items =
    isLastStreaming && message.items.length > liveItemWindow
      ? message.items.slice(-liveItemWindow)
      : message.items;
  if (turnIsRunning(message, isLastStreaming))
    return items === message.items ? message : { ...message, items };

  const settledItems = items.map((item) => {
    if (item.type !== "reasoning") return item;
    const summary =
      item.summary.trim().toLowerCase() === "reasoning"
        ? "思考过程"
        : item.summary;
    if (item.settled === true && summary === item.summary) return item;
    return { ...item, summary, settled: true };
  });
  return { ...message, items: settledItems };
}

export function turnIsRunning(
  message: WorkflowMessageBlock,
  isLastStreaming: boolean,
): boolean {
  return (
    isLastStreaming ||
    message.status === "running" ||
    message.activity === "thinking" ||
    message.activity === "running" ||
    message.activity === "responding"
  );
}

export function runtimeKind(
  message: WorkflowMessageBlock,
  finalText: string,
  isLastStreaming: boolean,
): TurnPresentationModel["runtime"]["kind"] {
  if (message.status === "cancelled") return "cancelled";
  if (message.status === "failed" || message.activity === "failed")
    return "failed";
  if (message.status === "completed" || message.activity === "done")
    return "completed";
  if (finalText.trim()) return "answering";
  if (isLastStreaming && message.items.length > 0) return "working";
  return "thinking";
}

export function isProcessItem(
  item: WorkflowTurnItem,
): item is WorkflowProcessItem {
  return item.type !== "agentMessage" && item.type !== "userMessage";
}

export function resultItemsForPresentation(
  items: WorkflowProcessItem[],
  showFileChanges: boolean,
): WorkflowProcessItem[] {
  return items.filter((item) => {
    if (item.type !== "fileChange") return true;
    if (!showFileChanges) return false;
    const status = String(item.status).toLowerCase();
    return status === "completed" || status === "done";
  });
}

export function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
