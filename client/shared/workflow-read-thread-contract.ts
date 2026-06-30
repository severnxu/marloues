import type { TokenUsage } from './types'

export const WORKFLOW_READ_THREAD_SCHEMA_VERSION = 1 as const

export type WorkflowReadThreadSchemaVersion = typeof WORKFLOW_READ_THREAD_SCHEMA_VERSION

export interface WorkflowReadThreadResponse {
  schemaVersion: WorkflowReadThreadSchemaVersion
  thread: WorkflowThreadInfo
  page: WorkflowThreadPage
  turns: WorkflowTurn[]
}

export interface WorkflowThreadInfo {
  id: string
  title: string
  preview: string
  status: WorkflowThreadStatus
  cwd?: string | null
  createdAt?: number | string | null
  updatedAt?: number | string | null
}

export type WorkflowThreadStatus =
  | { type: 'active'; activeFlags?: unknown }
  | { type: 'idle' }
  | { type: 'notLoaded' }
  | { type: 'systemError' }
  | { type: string; [key: string]: unknown }

export interface WorkflowThreadPage {
  order: 'newest_first'
  limit: number
  nextCursor: string | null
  hasMore: boolean
}

export interface WorkflowTurn {
  id: string
  status: WorkflowTurnStatus
  error: WorkflowTurnError | null
  startedAt?: number | string | null
  completedAt?: number | string | null
  durationMs?: number | null
  modelId?: string | null
  modelName?: string | null
  usage?: TokenUsage
  items: WorkflowTurnItem[]
}

export type WorkflowTurnStatus = 'running' | 'completed' | 'failed' | 'cancelled' | string

export interface WorkflowTurnError {
  message: string
  additionalDetails?: unknown
}

export type WorkflowTextOutput =
  | { text: string; truncated: false }
  | { text: string; truncated: true; originalChars: number }
  | { text: string; truncated?: boolean; originalChars?: number }

export interface WorkflowContextEconomyMeta {
  compressed: boolean
  originalChars: number
  modelChars: number
  strategy: string[]
  preserved: {
    codeBlocks: number
    paths: number
    urls: number
    stackLines: number
    errorLines: number
  }
  omittedChars: number
}

export type WorkflowUserMessageContent =
  | { type: 'text'; text: string; workflowDelegation?: WorkflowDelegation }
  | { type: 'image'; url: string }
  | { type: 'localImage'; path: string }
  | { type: 'skill'; name: string; path?: string }
  | { type: 'mention'; name: string; path?: string }

export interface WorkflowDelegation {
  sourceThreadId: string
  input: string
}

export type WorkflowTurnItem =
  | WorkflowUserMessageItem
  | WorkflowAgentMessageItem
  | WorkflowPlanItem
  | WorkflowReasoningItem
  | WorkflowCommandExecutionItem
  | WorkflowFileChangeItem
  | WorkflowMcpToolCallItem
  | WorkflowDynamicToolCallItem
  | WorkflowCollabAgentToolCallItem
  | WorkflowWebSearchItem
  | WorkflowImageViewItem
  | WorkflowImageGenerationItem
  | WorkflowEnteredReviewModeItem
  | WorkflowExitedReviewModeItem
  | WorkflowHookPromptItem
  | WorkflowPermissionRequestItem
  | WorkflowContextCompactionItem
  | WorkflowUnknownItem

export type WorkflowCanonicalTurnItemType = Exclude<WorkflowTurnItem['type'], 'unknown'>

export interface WorkflowTurnItemBase {
  type: string
  id: string
}

export interface WorkflowUserMessageItem extends WorkflowTurnItemBase {
  type: 'userMessage'
  content: WorkflowUserMessageContent[]
}

export interface WorkflowAgentMessageItem extends WorkflowTurnItemBase {
  type: 'agentMessage'
  text: string
  phase?: string
}

export interface WorkflowPlanItem extends WorkflowTurnItemBase {
  type: 'plan'
  text: string
}

export interface WorkflowReasoningItem extends WorkflowTurnItemBase {
  type: 'reasoning'
  summary: string
  content?: WorkflowTextOutput[]
}

export interface WorkflowCommandExecutionItem extends WorkflowTurnItemBase {
  type: 'commandExecution'
  command: string
  shell?: string
  cwd?: string
  status: WorkflowItemStatus
  exitCode?: number | null
  durationMs?: number | null
  output?: WorkflowTextOutput
}

export interface WorkflowFileChangeItem extends WorkflowTurnItemBase {
  type: 'fileChange'
  status: WorkflowItemStatus
  changes: WorkflowFileChange[]
}

export interface WorkflowFileChange {
  path: string
  kind: string
  diff?: WorkflowTextOutput
}

export interface WorkflowMcpToolCallItem extends WorkflowTurnItemBase {
  type: 'mcpToolCall'
  server?: string
  tool: string
  arguments?: unknown
  status: WorkflowItemStatus
  durationMs?: number | null
  output?: WorkflowTextOutput
  modelOutput?: WorkflowTextOutput
  contextEconomy?: WorkflowContextEconomyMeta
}

export interface WorkflowDynamicToolCallItem extends WorkflowTurnItemBase {
  type: 'dynamicToolCall'
  tool: string
  arguments?: unknown
  status: WorkflowItemStatus
  success?: boolean
  durationMs?: number | null
  output?: WorkflowTextOutput
  modelOutput?: WorkflowTextOutput
  contextEconomy?: WorkflowContextEconomyMeta
}

export interface WorkflowCollabAgentToolCallItem extends WorkflowTurnItemBase {
  type: 'collabAgentToolCall'
  tool: string
  status: WorkflowItemStatus
  senderThreadId?: string
  receiverThreadIds?: string[]
  prompt?: string
  model?: string
  reasoningEffort?: string
}

export interface WorkflowWebSearchItem extends WorkflowTurnItemBase {
  type: 'webSearch'
  query?: string
  action?: unknown
}

export interface WorkflowImageViewItem extends WorkflowTurnItemBase {
  type: 'imageView'
  path: string
}

export interface WorkflowImageGenerationItem extends WorkflowTurnItemBase {
  type: 'imageGeneration'
  status: WorkflowItemStatus
  revisedPrompt?: string
  result?: unknown
  savedPath?: string | null
}

export interface WorkflowEnteredReviewModeItem extends WorkflowTurnItemBase {
  type: 'enteredReviewMode'
  review?: unknown
}

export interface WorkflowExitedReviewModeItem extends WorkflowTurnItemBase {
  type: 'exitedReviewMode'
  review?: unknown
}

export interface WorkflowHookPromptItem extends WorkflowTurnItemBase {
  type: 'hookPrompt'
  fragmentCount: number
}

export interface WorkflowPermissionRequestItem extends WorkflowTurnItemBase {
  type: 'permissionRequest'
  toolName: string
  reason: string
  status: WorkflowItemStatus
  timeoutMs?: number | null
}

export interface WorkflowContextCompactionItem extends WorkflowTurnItemBase {
  type: 'contextCompaction'
}

export interface WorkflowUnknownItem extends WorkflowTurnItemBase {
  type: 'unknown'
  rawType?: string
  raw: unknown
}

export type WorkflowItemStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'error'
  | 'cancelled'
  | string

export type WorkflowActivityItem = Extract<
  WorkflowTurnItem,
  {
    type:
      | 'reasoning'
      | 'commandExecution'
      | 'fileChange'
      | 'mcpToolCall'
      | 'dynamicToolCall'
      | 'collabAgentToolCall'
      | 'webSearch'
      | 'imageView'
      | 'imageGeneration'
      | 'enteredReviewMode'
      | 'exitedReviewMode'
      | 'hookPrompt'
      | 'permissionRequest'
      | 'contextCompaction'
      | 'unknown'
  }
>

export type WorkflowContentItem = Extract<WorkflowTurnItem, { type: 'userMessage' | 'agentMessage' | 'plan' }>

export type WorkflowResultItem = Extract<WorkflowTurnItem, { type: 'fileChange' | 'imageGeneration' | 'webSearch' }>

export type WorkflowToolLikeItem = Extract<
  WorkflowTurnItem,
  { type: 'commandExecution' | 'mcpToolCall' | 'dynamicToolCall' | 'collabAgentToolCall' | 'webSearch' }
>

export const WORKFLOW_CANONICAL_TURN_ITEM_TYPES = [
  'userMessage',
  'agentMessage',
  'plan',
  'reasoning',
  'commandExecution',
  'fileChange',
  'mcpToolCall',
  'dynamicToolCall',
  'collabAgentToolCall',
  'webSearch',
  'imageView',
  'imageGeneration',
  'enteredReviewMode',
  'exitedReviewMode',
  'hookPrompt',
  'permissionRequest',
  'contextCompaction',
] as const satisfies readonly WorkflowCanonicalTurnItemType[]

export function isWorkflowCanonicalTurnItemType(value: string): value is WorkflowCanonicalTurnItemType {
  return (WORKFLOW_CANONICAL_TURN_ITEM_TYPES as readonly string[]).includes(value)
}

export function isWorkflowActivityItem(item: WorkflowTurnItem): item is WorkflowActivityItem {
  switch (item.type) {
    case 'reasoning':
    case 'commandExecution':
    case 'fileChange':
    case 'mcpToolCall':
    case 'dynamicToolCall':
    case 'collabAgentToolCall':
    case 'webSearch':
    case 'imageView':
    case 'imageGeneration':
    case 'enteredReviewMode':
    case 'exitedReviewMode':
    case 'hookPrompt':
    case 'permissionRequest':
    case 'contextCompaction':
    case 'unknown':
      return true
    default:
      return false
  }
}

export function isWorkflowContentItem(item: WorkflowTurnItem): item is WorkflowContentItem {
  return item.type === 'userMessage' || item.type === 'agentMessage' || item.type === 'plan'
}

export function isWorkflowResultItem(item: WorkflowTurnItem): item is WorkflowResultItem {
  return item.type === 'fileChange' || item.type === 'imageGeneration' || item.type === 'webSearch'
}

export function isWorkflowToolLikeItem(item: WorkflowTurnItem): item is WorkflowToolLikeItem {
  switch (item.type) {
    case 'commandExecution':
    case 'mcpToolCall':
    case 'dynamicToolCall':
    case 'collabAgentToolCall':
    case 'webSearch':
      return true
    default:
      return false
  }
}
