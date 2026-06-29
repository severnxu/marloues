import type { WorkflowMessageBlock as WorkflowMessageBlock } from '../../../../shared/adapters/workflow-messages-to-read-thread'
import {
  workflowTurnDefaultCollapsed,
  workflowTurnIsCompleted,
  workflowTurnShouldCollapseAfterRuntime,
  workflowTurnStateKey,
  type WorkflowTurnRuntimeState,
} from './turn-collapse-rules'

export type WorkflowTurnCollapseRuntimeState = WorkflowTurnRuntimeState

export type WorkflowTurnCollapseStateResult = {
  collapsedTurnsById: Record<string, boolean>
  runtimeByKey: Map<string, WorkflowTurnCollapseRuntimeState>
}

export function workflowTurnCollapseStateKey(scope: string, messageId: string): string {
  return workflowTurnStateKey(scope, messageId)
}

export function nextWorkflowTurnCollapseState({
  collapsedTurnsById,
  isStreaming,
  previousRuntimeByKey,
  scope,
  workflowMessages,
}: {
  collapsedTurnsById: Record<string, boolean>
  isStreaming: boolean
  previousRuntimeByKey: Map<string, WorkflowTurnCollapseRuntimeState>
  scope: string
  workflowMessages: WorkflowMessageBlock[]
}): WorkflowTurnCollapseStateResult {
  let nextCollapsed = collapsedTurnsById
  const runtimeByKey = new Map<string, WorkflowTurnCollapseRuntimeState>()
  const visibleTurnKeys = new Set<string>()

  workflowMessages.forEach((message, index) => {
    const key = workflowTurnCollapseStateKey(scope, message.id)
    const isLastStreaming = isStreaming && index === workflowMessages.length - 1
    const defaultCollapsed = workflowTurnDefaultCollapsed(message)
    const previous = previousRuntimeByKey.get(key)
    const desiredCollapsed = isLastStreaming
      ? false
      : workflowTurnIsCompleted(message) && workflowTurnShouldCollapseAfterRuntime(message, previous, isLastStreaming)
        ? true
        : key in collapsedTurnsById
          ? collapsedTurnsById[key]
          : defaultCollapsed

    visibleTurnKeys.add(key)
    runtimeByKey.set(key, {
      activity: message.activity,
      status: message.status,
      isLastStreaming,
    })

    if (collapsedTurnsById[key] === desiredCollapsed) return
    if (nextCollapsed === collapsedTurnsById) nextCollapsed = { ...collapsedTurnsById }
    nextCollapsed[key] = desiredCollapsed
  })

  for (const key of Object.keys(nextCollapsed)) {
    if (visibleTurnKeys.has(key)) continue
    if (nextCollapsed === collapsedTurnsById) nextCollapsed = { ...collapsedTurnsById }
    delete nextCollapsed[key]
  }

  return {
    collapsedTurnsById: nextCollapsed,
    runtimeByKey,
  }
}
