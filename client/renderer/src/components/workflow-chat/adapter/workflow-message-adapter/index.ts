// ── Types ──────────────────────────────────────────────────────────────
export type {
  WorkflowActivity,
  WorkflowTurnStatus,
  WorkflowUserMessageContent,
  WorkflowMessageBlock,
  WorkflowReadThreadAdapterOptions,
  WorkflowReadThreadResponse,
} from "./types";

// ── Re-exports from shared ──────────────────────────────────────────────
export { workflowMessagesToWorkflowReadThreadResponse } from "../../../../../../shared/adapters/workflow-messages-to-read-thread";

// ── Normalize / message building ───────────────────────────────────────
export {
  messagesToWorkflowReadThreadResponse,
  toWorkflowMessages,
} from "./normalize";

// ── Text extractors ────────────────────────────────────────────────────
export {
  finalAssistantText,
  itemOutputText,
  itemInputText,
} from "./text-extractors";
