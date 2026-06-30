import type { ReactNode } from 'react'
import type { WorkflowActivityGroup, WorkflowFlowEntry } from './turn-layout'
import type { WorkflowTurnItem as WorkflowStreamItem } from '../../../../shared/adapters/workflow-messages-to-read-thread'

type AgentMessageItem = Extract<WorkflowStreamItem, { type: 'agentMessage' }>
type ProcessItem = Exclude<WorkflowStreamItem, { type: 'agentMessage' | 'userMessage' }>

interface Props {
  entries: WorkflowFlowEntry[]
  expanded: boolean
  renderActivityGroup: (group: WorkflowActivityGroup, defaultDetailExpanded: boolean) => ReactNode
  renderActivityItem: (item: ProcessItem) => ReactNode
  renderAssistantMessage: (item: AgentMessageItem) => ReactNode
  renderDynamicToolGroup: (group: WorkflowActivityGroup) => ReactNode
}

export function WorkflowAgentFlowSection({
  entries,
  expanded,
  renderActivityGroup,
  renderActivityItem,
  renderAssistantMessage,
  renderDynamicToolGroup,
}: Props) {
  const visibleEntries = expanded
    ? entries
    : entries.filter(entry => entry.kind === 'assistantMessage' && entry.isFinal)
  if (!visibleEntries.length) return null

  return (
    <div className="workflow-agent-flow-section" data-kind="agent-flow-section">
      {visibleEntries.map((entry, index) => {
        if (entry.kind === 'assistantMessage') return renderAssistantMessage(entry.item)
        if (entry.kind === 'activityItem') return renderActivityItem(entry.item)
        if (entry.kind === 'dynamicToolGroup') return renderDynamicToolGroup(entry.group)
        return renderActivityGroup(entry.group, !hasLaterAssistantMessage(visibleEntries, index))
      })}
    </div>
  )
}

function hasLaterAssistantMessage(entries: WorkflowFlowEntry[], index: number): boolean {
  return entries.slice(index + 1).some(entry => entry.kind === 'assistantMessage')
}
