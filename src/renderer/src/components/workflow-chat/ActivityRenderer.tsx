import { WorkflowActivityGroup } from './ActivityGroup'
import type { WorkflowActivityGroupEntry } from './ActivityGroup'
import { WorkflowAssistantAnswer } from './AssistantAnswer'
import { WorkflowCollabAgentToolRow } from './CollabAgentToolRow'
import { WorkflowCommandExecutionRow } from './CommandExecutionRow'
import { WorkflowFileChangeRow } from './FileChangeRow'
import { WorkflowImageGenerationRow } from './ImageGenerationRow'
import { WorkflowContextCompactionMarker, WorkflowHookPromptBlock, WorkflowImageViewRow, WorkflowReviewModeMarker, WorkflowUnknownRawJson } from './MarkerRows'
import { WorkflowPermissionRequestRow } from './PermissionRequestRow'
import { WorkflowReasoningRow } from './ReasoningRow'
import { WorkflowToolCallRow } from './ToolCallRow'
import { WorkflowWebSearchRow } from './WebSearchRow'
import type { WorkflowTurnItem as WorkflowStreamItem } from '../../../../shared/adapters/workflow-messages-to-read-thread'
import type { WorkflowActivityGroup as WorkflowActivityGroupModel } from './turn-layout'

type AgentMessageItem = Extract<WorkflowStreamItem, { type: 'agentMessage' }>
type ProcessItem = Exclude<WorkflowStreamItem, { type: 'agentMessage' | 'userMessage' }>
type AgentBodyItem = AgentMessageItem | ProcessItem
type CommandItemModel = Extract<WorkflowStreamItem, { type: 'commandExecution' }>
type RendererMap = {
  [K in ProcessItem['type']]: (props: { item: Extract<ProcessItem, { type: K }> }) => JSX.Element | null
}

type Props =
  | { kind: 'assistantMessage'; item: AgentMessageItem }
  | { kind: 'activityItem'; item: ProcessItem }
  | { kind: 'dynamicToolGroup'; group: WorkflowActivityGroupModel }
  | { kind: 'activityGroup'; group: WorkflowActivityGroupModel; defaultDetailExpanded?: boolean; expanded: boolean }

export function WorkflowActivityRenderer(props: Props) {
  if (props.kind === 'assistantMessage') {
    return <WorkflowAssistantAnswer text={props.item.text} hasLeadingContent={false} />
  }

  if (props.kind === 'activityItem') {
    return <WorkflowTurnItemRenderer item={props.item} />
  }

  if (props.kind === 'dynamicToolGroup') {
    return <DynamicToolGroup group={props.group} />
  }

  return <ActivityGroupBridge group={props.group} defaultDetailExpanded={props.defaultDetailExpanded} expanded={props.expanded} />
}

function DynamicToolGroup({ group }: { group: WorkflowActivityGroupModel }) {
  return (
    <>
      {group.items.map(item => <WorkflowTurnItemRenderer key={item.id} item={item} />)}
    </>
  )
}

function ActivityGroupBridge({ group, defaultDetailExpanded, expanded }: { group: WorkflowActivityGroupModel; defaultDetailExpanded?: boolean; expanded: boolean }) {
  return (
    <WorkflowActivityGroup
      group={group}
      defaultDetailExpanded={defaultDetailExpanded}
      expanded={expanded}
      toEntries={groupAgentBodyItems}
      renderCommandGroup={(id, items) => (
        <div key={id} className="grid gap-0">
          {items.map(item => <WorkflowCommandExecutionRow key={item.id} item={item} />)}
        </div>
      )}
      renderItem={item => {
        if (item.type === 'agentMessage') return <WorkflowAssistantAnswer key={item.id} text={item.text} hasLeadingContent={false} />
        return <WorkflowTurnItemRenderer key={item.id} item={settledGroupItem(group, item)} />
      }}
    />
  )
}

function settledGroupItem(group: WorkflowActivityGroupModel, item: ProcessItem): ProcessItem {
  if (
    item.type === 'permissionRequest'
    && group.summary.waitingPermissionRequestCount === 0
    && group.summary.deniedPermissionRequestCount > 0
    && isRunningStatus(item.status)
  ) {
    return { ...item, status: 'denied' }
  }
  if (
    group.summary.runningCount === 0
    && group.summary.deniedPermissionRequestCount > 0
    && 'status' in item
    && isRunningStatus(item.status)
  ) {
    return { ...item, status: 'failed' } as ProcessItem
  }
  return item
}

function isRunningStatus(status: unknown): boolean {
  const value = String(status).toLowerCase()
  return value === 'running' || value === 'pending' || value === 'in_progress' || value === 'inprogress'
}

function groupAgentBodyItems(items: AgentBodyItem[]): WorkflowActivityGroupEntry[] {
  const entries: WorkflowActivityGroupEntry[] = []
  let commandGroup: CommandItemModel[] = []

  const flushCommands = () => {
    if (!commandGroup.length) return
    if (commandGroup.length === 1) entries.push({ type: 'item', item: commandGroup[0] })
    else entries.push({ type: 'commandGroup', id: commandGroup.map(item => item.id).join('-'), items: commandGroup })
    commandGroup = []
  }

  for (const item of items) {
    if (item.type === 'commandExecution') {
      commandGroup.push(item)
      continue
    }

    flushCommands()
    entries.push({ type: 'item', item })
  }

  flushCommands()
  return entries
}

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
} satisfies RendererMap

function WorkflowTurnItemRenderer({ item }: { item: ProcessItem }) {
  const Renderer = renderers[item.type]
  return Renderer ? <Renderer item={item as never} /> : null
}
