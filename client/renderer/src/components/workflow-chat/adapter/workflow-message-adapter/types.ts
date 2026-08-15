import type { WorkflowRawEvent, Message } from "../../../../types";
import {
  type WorkflowItemStatus,
  type WorkflowReadThreadResponse,
  type WorkflowTextOutput,
  type WorkflowUserMessageContent,
} from "../../../../../../shared/workflow-read-thread-contract";
import {
  type WorkflowReadThreadAdapterOptions,
  type WorkflowMessageBlock as AdapterWorkflowMessageBlock,
  type WorkflowTurnItem,
} from "../../../../../../shared/adapters/workflow-messages-to-read-thread";

export type WorkflowActivity =
  "thinking" | "running" | "responding" | "done" | "failed";
export type WorkflowTurnStatus =
  "running" | "completed" | "failed" | "cancelled";
export type { WorkflowUserMessageContent };

export type WorkflowMessageBlock = AdapterWorkflowMessageBlock;
export type { WorkflowReadThreadAdapterOptions, WorkflowReadThreadResponse };
export type { WorkflowTurnItem };

type WorkflowWebSearchItem = Extract<WorkflowTurnItem, { type: "webSearch" }>;

// Re-exported for internal use by sibling modules
export type {
  WorkflowRawEvent,
  Message,
  WorkflowItemStatus,
  WorkflowTextOutput,
};
export type { WorkflowWebSearchItem };
export type TextOutput = WorkflowTextOutput;
