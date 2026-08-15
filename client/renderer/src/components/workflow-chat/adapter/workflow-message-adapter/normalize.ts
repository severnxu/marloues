import type {
  WorkflowRawEvent,
  Message,
  WorkflowMessageBlock,
  WorkflowReadThreadAdapterOptions,
  WorkflowReadThreadResponse,
} from "./types";
import { workflowMessagesToWorkflowReadThreadResponse } from "../../../../../../shared/adapters/workflow-messages-to-read-thread";
import { textUserContent } from "./shared-helpers";
import { compactItems, itemsFromAssistantMessage } from "./streaming";

export function messagesToWorkflowReadThreadResponse(
  messages: Message[],
  isStreaming: boolean,
  options: WorkflowReadThreadAdapterOptions = {},
): WorkflowReadThreadResponse {
  return workflowMessagesToWorkflowReadThreadResponse(
    toWorkflowMessages(messages, isStreaming),
    options,
  );
}

export function toWorkflowMessages(
  messages: Message[],
  isStreaming: boolean,
): WorkflowMessageBlock[] {
  const blocks: WorkflowMessageBlock[] = [];
  let current: WorkflowMessageBlock | null = null;

  for (const message of messages) {
    if (message.role === "user") {
      const block: WorkflowMessageBlock = {
        id: message.id,
        userMessageId: message.id,
        user: message.content,
        userContent: message.userContent?.length
          ? message.userContent
          : textUserContent(message.content),
        status: "running",
        activity: "thinking",
        startedAt: message.timestamp,
        durationMs: null,
        usage: message.usage,
        modelId: message.modelId,
        modelName: message.modelName,
        items: [],
      };
      current = block;
      blocks.push(current);
      continue;
    }

    if (!current) {
      const block: WorkflowMessageBlock = {
        id: message.id,
        user: "",
        userContent: [],
        status: "running",
        activity: "thinking",
        startedAt: message.startedAt ?? message.timestamp,
        durationMs: null,
        modelId: message.modelId,
        modelName: message.modelName,
        items: [],
      };
      current = block;
      blocks.push(current);
    }

    const currentBlock = current;
    const rawTurn = turnStateFromRawEvents(message.rawEvents ?? []);
    const completedAt = message.completedAt ?? rawTurn.completedAt;
    const startedAt =
      currentBlock.startedAt ?? message.startedAt ?? message.timestamp;
    currentBlock.id = `${currentBlock.id}-${message.id}`;
    currentBlock.startedAt = startedAt;
    currentBlock.completedAt = completedAt;
    currentBlock.durationMs = completedAt
      ? Math.max(0, completedAt - startedAt)
      : null;
    currentBlock.modelId = message.modelId ?? currentBlock.modelId;
    currentBlock.modelName = message.modelName ?? currentBlock.modelName;
    currentBlock.usage = message.usage ?? currentBlock.usage;
    currentBlock.status =
      message.status === "failed"
        ? "failed"
        : message.status === "completed" || rawTurn.completed
          ? "completed"
          : "running";
    currentBlock.activity = activityForMessage(
      message,
      isStreaming,
      rawTurn.completed,
    );
    currentBlock.items = compactItems([
      ...currentBlock.items,
      ...itemsFromAssistantMessage(message),
    ]);
  }

  return blocks.filter((block) => block.user || block.items.length);
}

function activityForMessage(
  message: Message,
  isStreaming: boolean,
  rawCompleted = false,
): WorkflowMessageBlock["activity"] {
  if (message.status === "failed") return "failed";
  if (message.status === "completed" || rawCompleted) return "done";
  if (message.status === "running") return "running";
  if (isStreaming) return message.content ? "responding" : "thinking";
  return message.content ? "responding" : "thinking";
}

function turnStateFromRawEvents(rawEvents: WorkflowRawEvent[]): {
  completed: boolean;
  completedAt?: number;
} {
  for (let index = rawEvents.length - 1; index >= 0; index -= 1) {
    const event = rawEvents[index];
    if (event.method === "turn/completed") {
      return { completed: true, completedAt: event.receivedAt };
    }
  }
  return { completed: false };
}
