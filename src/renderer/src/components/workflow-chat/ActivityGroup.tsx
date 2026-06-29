import { useEffect, useState, type ReactNode } from 'react'
import { FileText, FolderTree, Search, ShieldQuestion, SquareTerminal, Wrench } from 'lucide-react'
import type { WorkflowTurnItem as WorkflowStreamItem } from '../../../../shared/adapters/workflow-messages-to-read-thread'
import { WorkflowActivityRowContent } from './ActivityRow'
import {
  workflowActivityGroupViewState,
  workflowActivitySummaryLabel,
  type WorkflowActivityGroup as WorkflowActivityGroupModel,
} from './turn-layout'

type AgentMessageItem = Extract<WorkflowStreamItem, { type: 'agentMessage' }>
type ProcessItem = Exclude<WorkflowStreamItem, { type: 'agentMessage' | 'userMessage' }>
type AgentBodyItem = AgentMessageItem | ProcessItem
type CommandItemModel = Extract<WorkflowStreamItem, { type: 'commandExecution' }>

export type WorkflowActivityGroupEntry =
  | { type: 'item'; item: AgentBodyItem }
  | { type: 'commandGroup'; id: string; items: CommandItemModel[] }

interface Props {
  group: WorkflowActivityGroupModel
  defaultDetailExpanded?: boolean
  expanded: boolean
  toEntries: (items: AgentBodyItem[]) => WorkflowActivityGroupEntry[]
  renderCommandGroup: (id: string, items: CommandItemModel[]) => ReactNode
  renderItem: (item: AgentBodyItem) => ReactNode
}

export function WorkflowActivityGroup({ group, defaultDetailExpanded = true, expanded, toEntries, renderCommandGroup, renderItem }: Props) {
  const [summaryExpanded, setSummaryExpanded] = useState(defaultDetailExpanded)
  const viewState = workflowActivityGroupViewState(expanded, summaryExpanded)

  useEffect(() => {
    setSummaryExpanded(defaultDetailExpanded)
  }, [defaultDetailExpanded, group.id])

  if (!viewState.showDetail) {
    return <ActivitySummaryRow group={group} expanded={viewState.summaryExpanded} onToggle={() => setSummaryExpanded(true)} />
  }

  const entries = toEntries(group.items)

  return (
    <div className="workflow-activity-group" data-kind="activity-group">
      {viewState.showSummary ? <ActivitySummaryRow group={group} expanded={viewState.summaryExpanded} onToggle={() => setSummaryExpanded(false)} /> : null}
      <div className="workflow-activity-group-detail">
        {entries.map(entry => {
          if (entry.type === 'commandGroup') return renderCommandGroup(entry.id, entry.items)
          return renderItem(entry.item)
        })}
      </div>
    </div>
  )
}

function ActivitySummaryRow({ group, expanded, onToggle }: { group: WorkflowActivityGroupModel; expanded: boolean; onToggle: () => void }) {
  const label = workflowActivitySummaryLabel(group.summary)
  if (!label) return null

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      data-kind="activity-row"
      data-activity-kind="summary"
      className="workflow-activity-row-button flex min-h-6 w-full max-w-full items-center gap-2 rounded text-left text-[12px] leading-5 text-text-muted transition hover:text-text-normal"
    >
      <span className="grid h-4 w-4 place-items-center text-text-subtle">
        <ActivitySummaryIcon group={group} />
      </span>
      <WorkflowActivityRowContent
        label={(
          <>
            {label}
            <InlineDiffStats added={group.summary.addedLineCount} removed={group.summary.removedLineCount} />
            {group.summary.runningCount > 0 ? <InlineDots /> : null}
          </>
        )}
        interactive
        open={expanded}
      />
    </button>
  )
}

function ActivitySummaryIcon({ group }: { group: WorkflowActivityGroupModel }) {
  const fileCount = group.summary.fileCreateCount + group.summary.fileEditCount + group.summary.fileDeleteCount
  const explorationCount = group.summary.exploredFileCount + group.summary.listCount
  const permissionCount = group.summary.waitingPermissionRequestCount + group.summary.approvedPermissionRequestCount + group.summary.deniedPermissionRequestCount
  const onlyFolderCreation = group.summary.runningFolderCreateCount > 0 && group.summary.commandCount === group.summary.runningFolderCreateCount
  if (onlyFolderCreation) return <FolderTree className="h-3.5 w-3.5" />
  if ((fileCount > 0 || explorationCount > 0) && group.summary.commandCount === 0 && group.summary.searchCount === 0) return <FileText className="h-3.5 w-3.5" />
  if ((group.summary.searchCount > 0 || group.summary.webSearchCount > 0) && group.summary.commandCount === 0 && fileCount === 0) return <Search className="h-3.5 w-3.5" />
  if (permissionCount > 0 && group.summary.commandCount === 0 && fileCount === 0 && explorationCount === 0) return <ShieldQuestion className="h-3.5 w-3.5" />
  if (group.summary.commandCount > 0) return <SquareTerminal className="h-3.5 w-3.5" />
  return <Wrench className="h-3.5 w-3.5" />
}

function InlineDots() {
  return (
    <span className="ml-0.5 inline-flex translate-y-[-1px] gap-[3px] align-middle">
      <span className="h-1 w-1 rounded-full bg-current opacity-40 animate-typing-dot-1" />
      <span className="h-1 w-1 rounded-full bg-current opacity-40 animate-typing-dot-2" />
      <span className="h-1 w-1 rounded-full bg-current opacity-40 animate-typing-dot-3" />
    </span>
  )
}

function InlineDiffStats({ added, removed }: { added: number; removed: number }) {
  if (!added && !removed) return null
  return (
    <span className="ml-2 inline-flex gap-1.5 font-mono text-[11px]">
      {added ? <span className="text-accent">+{added}</span> : null}
      {removed ? <span className="text-danger">-{removed}</span> : null}
    </span>
  )
}
