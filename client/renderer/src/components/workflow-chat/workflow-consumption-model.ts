import type { Message } from "../../types";
import {
  toWorkflowMessages,
  type WorkflowMessageBlock,
} from "./workflow-message-adapter";

export type { WorkflowMessageBlock };

export function buildWorkflowMessages(
  messages: Message[],
  isStreaming: boolean,
): WorkflowMessageBlock[] {
  return toWorkflowMessages(messages, isStreaming);
}
