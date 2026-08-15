import type {
  WorkflowMessageBlock,
  WorkflowTurnItem,
} from "../../../../../../shared/adapters/workflow-messages-to-read-thread";

type AgentMessageItem = Extract<WorkflowTurnItem, { type: "agentMessage" }>;
export type ProcessItem = Exclude<
  WorkflowTurnItem,
  { type: "agentMessage" | "userMessage" }
>;

export type WorkflowActivityItem = AgentMessageItem | ProcessItem;

export type WorkflowActivitySummary = {
  commandCount: number;
  imageCount: number;
  exploredFileCount: number;
  fileCreateCount: number;
  fileEditCount: number;
  fileDeleteCount: number;
  listCount: number;
  searchCount: number;
  toolCount: number;
  webSearchCount: number;
  waitingPermissionRequestCount: number;
  approvedPermissionRequestCount: number;
  deniedPermissionRequestCount: number;
  runningCount: number;
  runningCommandCount: number;
  runningExploredFileCount: number;
  runningFileCreateCount: number;
  runningFileEditCount: number;
  runningFileDeleteCount: number;
  runningFolderCreateCount: number;
  runningListCount: number;
  runningSearchCount: number;
  runningToolCount: number;
  runningWebSearchCount: number;
  runningWrittenLineCount: number;
  addedLineCount: number;
  removedLineCount: number;
  runningAddedLineCount: number;
  runningRemovedLineCount: number;
};

export type WorkflowActivityGroup = {
  id: string;
  items: ProcessItem[];
  summary: WorkflowActivitySummary;
};

export type WorkflowFlowEntry =
  | { kind: "assistantMessage"; item: AgentMessageItem; isFinal: boolean }
  | { kind: "activityItem"; item: ProcessItem }
  | { kind: "activityGroup"; group: WorkflowActivityGroup };

export type WorkflowTurnLayout = {
  leadingFlow: WorkflowFlowEntry[];
  trailingFlow: WorkflowFlowEntry[];
  leadingActivityItems: ProcessItem[];
  trailingActivityItems: ProcessItem[];
  resultItems: ProcessItem[];
  finalText: string;
};

export type WorkflowTurnLayoutOptions = {
  hideReasoning?: boolean;
};

export type { AgentMessageItem };
export type { WorkflowMessageBlock };
