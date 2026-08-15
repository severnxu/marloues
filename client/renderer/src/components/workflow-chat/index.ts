// Barrel for the workflow-chat domain. Re-exports everything from the
// composer / turns / activity / content / adapter / fixtures subdirs.
//
// Two flavors of exports per component are provided for back-compat:
// - The source name (e.g. `WorkflowAssistantAnswer`) — used by internal
//   code that lived in the same folder before the subdir split.
// - A short alias (e.g. `AssistantAnswer`) — used by external code that
//   historically imported the shortened name to avoid clashes.

// --- composer/ ---------------------------------------------------------
export { WorkflowComposerShell as ComposerShell } from "./composer/ComposerShell";
export { WorkflowComposerShell } from "./composer/ComposerShell";
export { ContextUsageRing } from "./composer/ContextUsageRing";
export { SandboxGatePrompt } from "./composer/SandboxInstallBanner";
export { SlashCommandPopover } from "./composer/SlashCommandPopover";
export { useConversationScroll } from "./composer/use-conversation-scroll";

// --- turns/ ------------------------------------------------------------
export { WorkflowTurnView as TurnView } from "./turns/TurnView";
export { WorkflowTurnView } from "./turns/TurnView";
export { WorkflowAssistantTurn as AssistantTurn } from "./turns/AssistantTurn";
export { WorkflowAssistantTurn } from "./turns/AssistantTurn";
export { AssistantTurnHeader } from "./turns/AssistantTurnHeader";
export { WorkflowAssistantAnswer as AssistantAnswer } from "./turns/AssistantAnswer";
export { WorkflowAssistantAnswer } from "./turns/AssistantAnswer";
export { WorkflowUserMessage as UserMessage } from "./turns/UserMessage";
export { WorkflowUserMessage } from "./turns/UserMessage";
export { WorkflowThreadView as ThreadView } from "./turns/ThreadView";
export { WorkflowThreadView } from "./turns/ThreadView";
export { WorkflowTurnList as WorkflowTurnList } from "./turns/WorkflowTurnList";
export { WorkflowReadThreadTurnList as ReadThreadTurnList } from "./turns/ReadThreadTurnList";
export { WorkflowReadThreadTurnList } from "./turns/ReadThreadTurnList";
export { QueuedSteersPanel } from "./turns/QueuedSteersPanel";
export { WorkflowSubagentWorkspace as SubagentWorkspace } from "./turns/SubagentWorkspace";
export { WorkflowSubagentWorkspace } from "./turns/SubagentWorkspace";
export { buildTurnPresentationModel } from "./turns/turn-presentation-model";
export type {
  TurnPresentationBlock,
  TurnPresentationModel,
} from "./turns/turn-presentation-model";

// turn layout / collapse / scroll state
export {
  workflowActivityGroupViewState as activityGroupViewState,
  workflowActivitySummaryLabel as activitySummaryLabel,
  workflowTurnLayout as turnLayout,
  workflowActivityGroupViewState,
  workflowActivitySummaryLabel,
  workflowTurnLayout,
} from "./turns/turn-layout";
export type {
  WorkflowActivityGroup as ActivityGroupModel,
  WorkflowActivityGroupViewState as ActivityGroupViewState,
  WorkflowActivityItem as ActivityItem,
  WorkflowActivitySummary as ActivitySummary,
  WorkflowFlowEntry as FlowEntry,
  WorkflowTurnLayout as TurnLayout,
} from "./turns/turn-layout";
export type {
  WorkflowActivityGroup,
  WorkflowFlowEntry,
  WorkflowActivityItem,
  WorkflowActivitySummary,
  WorkflowActivityGroupViewState,
} from "./turns/turn-layout";
export {
  workflowIsCollapsibleActivityItem as isCollapsibleActivityItem,
  workflowIsResultCardSourceItem as isResultCardSourceItem,
  workflowItemIsRunning as itemIsRunning,
  workflowLayoutToolName as layoutToolName,
  workflowShouldKeepSingleActivityItem as shouldKeepSingleActivityItem,
  workflowShouldShowActivityItem as shouldShowActivityItem,
  workflowShouldShowProcessItem as shouldShowProcessItem,
  workflowTurnDefaultCollapsed as turnDefaultCollapsed,
  workflowTurnIsCompleted as turnIsCompleted,
  workflowTurnShouldCollapseAfterRuntime as turnShouldCollapseAfterRuntime,
  workflowTurnStateKey as turnStateKey,
  workflowStatusIsRunning,
  workflowIsCollapsibleActivityItem,
  workflowIsResultCardSourceItem,
  workflowItemIsRunning,
  workflowLayoutToolName,
  workflowShouldKeepSingleActivityItem,
  workflowShouldShowActivityItem,
  workflowShouldShowProcessItem,
  workflowTurnDefaultCollapsed,
  workflowTurnIsCompleted,
  workflowTurnShouldCollapseAfterRuntime,
  workflowTurnStateKey,
} from "./turns/turn-collapse-rules";
export type {
  WorkflowProcessItem as ProcessItem,
  WorkflowTurnRuntimeState as TurnRuntimeState,
  WorkflowProcessItem,
  WorkflowTurnRuntimeState,
} from "./turns/turn-collapse-rules";
export {
  workflowTurnCollapseStateKey as turnCollapseStateKey,
  nextWorkflowTurnCollapseState as nextTurnCollapseState,
  workflowTurnCollapseStateKey,
  nextWorkflowTurnCollapseState,
} from "./turns/turn-collapse-state";
export type {
  WorkflowTurnCollapseRuntimeState as TurnCollapseRuntimeState,
  WorkflowTurnCollapseStateResult as TurnCollapseStateResult,
  WorkflowTurnCollapseRuntimeState,
  WorkflowTurnCollapseStateResult,
} from "./turns/turn-collapse-state";
export {
  workflowTurnDurationLabel as turnDurationLabel,
  workflowTurnStatusLabel as turnStatusLabel,
  workflowTurnStatusTone as turnStatusTone,
  workflowTurnDurationLabel,
  workflowTurnStatusLabel,
  workflowTurnStatusTone,
} from "./turns/turn-status";
export { useWorkflowCollapseState as useWorkflowCollapseState } from "./turns/use-collapse-state";
export type { WorkflowCollapseState as WorkflowCollapseState } from "./turns/use-collapse-state";
export { useWorkflowScrollAnchor as useScrollAnchor } from "./turns/use-scroll-anchor";
export type {
  WorkflowScrollAnchor as ScrollAnchor,
  WorkflowScrollAnchorOptions as ScrollAnchorOptions,
  WorkflowScrollAnchor,
  WorkflowScrollAnchorOptions,
} from "./turns/use-scroll-anchor";
export { useWorkflowTurnExpansion as useTurnExpansion } from "./turns/use-turn-expansion";

// --- activity/ ---------------------------------------------------------
export { WorkflowActivityGroup as ActivityGroup } from "./activity/ActivityGroup";
export type { WorkflowActivityGroupEntry as ActivityGroupEntry } from "./activity/ActivityGroup";
export {
  WorkflowActivityRow as ActivityRow,
  WorkflowActivityStatusBadge as ActivityStatusBadge,
  WorkflowInlineDots as InlineDots,
  WorkflowActivityRow,
  WorkflowActivityStatusBadge,
  WorkflowInlineDots,
} from "./activity/ActivityRow";
export { WorkflowActivityRenderer as ActivityRenderer } from "./activity/ActivityRenderer";
export { WorkflowActivityRenderer } from "./activity/ActivityRenderer";
export { WorkflowAgentFlowSection as AgentFlowSection } from "./activity/AgentFlowSection";
export { WorkflowAgentFlowSection } from "./activity/AgentFlowSection";
export { WorkflowCollabAgentToolRow as CollabAgentToolRow } from "./activity/CollabAgentToolRow";
export { WorkflowCollabAgentToolRow } from "./activity/CollabAgentToolRow";
export { WorkflowCommandExecutionRow as CommandExecutionRow } from "./activity/CommandExecutionRow";
export { WorkflowCommandExecutionRow } from "./activity/CommandExecutionRow";
export { WorkflowFileChangeRow as FileChangeRow } from "./activity/FileChangeRow";
export { WorkflowFileChangeRow } from "./activity/FileChangeRow";
export { WorkflowImageGenerationRow as ImageGenerationRow } from "./activity/ImageGenerationRow";
export { WorkflowImageGenerationRow } from "./activity/ImageGenerationRow";
export { WorkflowImageLightbox as ImageLightbox } from "./activity/ImageLightbox";
export { WorkflowImageLightbox } from "./activity/ImageLightbox";
export type { WorkflowImagePreview } from "./activity/ImageLightbox";
export { WorkflowReasoningRow as ReasoningRow } from "./activity/ReasoningRow";
export { WorkflowReasoningRow } from "./activity/ReasoningRow";
export { WorkflowPermissionRequestRow as PermissionRequestRow } from "./activity/PermissionRequestRow";
export { WorkflowPermissionRequestRow } from "./activity/PermissionRequestRow";
export { WorkflowResultCards as ResultCards } from "./activity/ResultCards";
export { WorkflowResultCards } from "./activity/ResultCards";
export { WorkflowToolCallRow as ToolCallRow } from "./activity/ToolCallRow";
export { WorkflowToolCallRow } from "./activity/ToolCallRow";
export { WorkflowWebSearchRow as WebSearchRow } from "./activity/WebSearchRow";
export { WorkflowWebSearchRow } from "./activity/WebSearchRow";
export {
  WorkflowContextCompactionMarker as ContextCompactionMarker,
  WorkflowHookPromptBlock as HookPromptBlock,
  WorkflowImageViewRow as ImageViewRow,
  WorkflowReviewModeMarker as ReviewModeMarker,
  WorkflowUnknownRawJson as UnknownRawJson,
  WorkflowContextCompactionMarker,
  WorkflowHookPromptBlock,
  WorkflowImageViewRow,
  WorkflowReviewModeMarker,
  WorkflowUnknownRawJson,
} from "./activity/MarkerRows";

// --- content/ ----------------------------------------------------------
export { WorkflowMarkdownContent as MarkdownContent } from "./content/MarkdownContent";
export { WorkflowMarkdownContent } from "./content/MarkdownContent";
export { WorkflowCodeBlock as CodeBlock } from "./content/CodeBlock";
export { WorkflowCodeBlock } from "./content/CodeBlock";
// --- adapter/ ----------------------------------------------------------
export {
  messagesToWorkflowReadThreadResponse,
  toWorkflowMessages,
  finalAssistantText,
  itemOutputText,
  itemInputText,
} from "./adapter/workflow-message-adapter";
export type {
  WorkflowMessageBlock,
  WorkflowActivity,
  WorkflowTurnStatus,
} from "./adapter/workflow-message-adapter";
export { buildWorkflowMessages } from "./adapter/workflow-consumption-model";
export type { WorkflowMessageBlock as WorkflowConsumptionBlock } from "./adapter/workflow-consumption-model";
export { rehypeSharedHighlight } from "./adapter/shared-rehype-highlight";
export {
  itemOutputText as itemOutputTextFromText,
  itemInputText as itemInputTextFromText,
} from "./adapter/item-text";

// --- fixtures/ ---------------------------------------------------------
export {
  WorkflowCodexFixturePage,
  WorkflowChatShellFixturePage,
} from "./fixtures/WorkflowCodexFixturePage";
export { TaskContextFixturePage } from "./fixtures/TaskContextFixturePage";

// --- root files (kept at workflow-chat/ for now) -----------------------
export { WorkflowScrollToBottomButton as ScrollToBottomButton } from "./ScrollToBottomButton";
export { WorkflowScrollToBottomButton } from "./ScrollToBottomButton";
export { ViewportCulling } from "./ViewportCulling";
