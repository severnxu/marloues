import { WorkflowCollabAgentToolRow } from "./CollabAgentToolRow";
import { WorkflowCommandExecutionRow } from "./CommandExecutionRow";
import { WorkflowFileChangeRow } from "./FileChangeRow";
import { WorkflowImageGenerationRow } from "./ImageGenerationRow";
import {
  WorkflowContextCompactionMarker,
  WorkflowHookPromptBlock,
  WorkflowImageViewRow,
  WorkflowReviewModeMarker,
  WorkflowUnknownRawJson,
} from "./MarkerRows";
import { WorkflowPermissionRequestRow } from "./PermissionRequestRow";
import { WorkflowReasoningRow } from "./ReasoningRow";
import { WorkflowToolCallRow } from "./ToolCallRow";
import { WorkflowWebSearchRow } from "./WebSearchRow";
import type { ProcessItem } from "../turns/turn-layout";

type RendererMap = {
  [K in ProcessItem["type"]]: (props: {
    item: Extract<ProcessItem, { type: K }>;
  }) => JSX.Element | null;
};

const renderers = {
  plan: WorkflowToolCallRow,
  reasoning: WorkflowReasoningRow,
  commandExecution: WorkflowCommandExecutionRow,
  fileChange: WorkflowFileChangeRow,
  mcpToolCall: WorkflowToolCallRow,
  dynamicToolCall: WorkflowToolCallRow,
  collabAgentToolCall: WorkflowCollabAgentToolRow,
  webSearch: WorkflowWebSearchRow,
  imageView: WorkflowImageViewRow,
  imageGeneration: WorkflowImageGenerationRow,
  enteredReviewMode: WorkflowReviewModeMarker,
  exitedReviewMode: WorkflowReviewModeMarker,
  hookPrompt: WorkflowHookPromptBlock,
  permissionRequest: WorkflowPermissionRequestRow,
  contextCompaction: WorkflowContextCompactionMarker,
  unknown: WorkflowUnknownRawJson,
} satisfies RendererMap;

export function WorkflowTurnItemRenderer({
  item,
  reasoningDefaultOpen = false,
}: {
  item: ProcessItem;
  reasoningDefaultOpen?: boolean;
}) {
  if (item.type === "reasoning") {
    return (
      <WorkflowReasoningRow item={item} defaultOpen={reasoningDefaultOpen} />
    );
  }
  const Renderer = renderers[item.type];
  return Renderer ? <Renderer item={item as never} /> : null;
}
