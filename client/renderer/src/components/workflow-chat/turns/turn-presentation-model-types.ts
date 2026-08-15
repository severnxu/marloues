import type { ContextUsageRecord, TokenUsage } from "@shared/types";
import type { WorkflowUserMessageContent } from "@shared/workflow-read-thread-contract";
import type { WorkflowMessageBlock } from "../../../../../shared/adapters/workflow-messages-to-read-thread";
import type { WorkflowProcessItem } from "./turn-collapse-rules";
import type { WorkflowFlowEntry } from "./turn-layout";
import type { WorkflowTurnPresentation } from "./turn-presentation";

export type TurnPresentationBlock =
  | {
      kind: "process";
      id: string;
      entries: WorkflowFlowEntry[];
    }
  | {
      kind: "document";
      id: string;
      itemIds: string[];
      text: string;
      tone: "normal" | "error";
      streaming: boolean;
    }
  | {
      kind: "results";
      id: string;
      items: WorkflowProcessItem[];
      showFileChanges: boolean;
    };

export interface TurnPresentationModel {
  id: string;
  userMessageId?: string;
  prompt: {
    text: string;
    content: WorkflowUserMessageContent[];
    createdAt?: number;
  };
  runtime: {
    activity: WorkflowMessageBlock["activity"];
    status: WorkflowMessageBlock["status"];
    kind:
      | "thinking"
      | "working"
      | "answering"
      | "completed"
      | "failed"
      | "cancelled";
    running: boolean;
    isLastStreaming: boolean;
    continuesPreviousTurn: boolean;
    showDuration: boolean;
    startedAt: number | null;
    completedAt: number | null;
    durationMs: number | null;
  };
  chrome: {
    presentation: WorkflowTurnPresentation;
    label: string;
    tone: string;
  };
  process: {
    hasActivityItems: boolean;
    stepCount: number;
  };
  documentText: string;
  blocks: TurnPresentationBlock[];
  metadata: {
    modelName?: string;
    createdAt?: number;
    usage?: TokenUsage;
    contextUsage?: ContextUsageRecord;
  };
}

export interface BuildTurnPresentationModelOptions {
  isLastStreaming: boolean;
  modelName?: string;
  liveItemWindow?: number;
}
