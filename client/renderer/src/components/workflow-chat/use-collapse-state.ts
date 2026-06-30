import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorkflowMessageBlock as WorkflowMessageBlock } from '../../../../shared/adapters/workflow-messages-to-read-thread'
import {
  workflowTurnCollapseStateKey,
  nextWorkflowTurnCollapseState,
  type WorkflowTurnCollapseRuntimeState,
} from './turn-collapse-state'
import { workflowTurnDefaultCollapsed } from './turn-collapse-rules'

export type WorkflowCollapseState = {
  isTurnExpanded: (message: Pick<WorkflowMessageBlock, 'id' | 'activity' | 'status'>) => boolean
  setTurnExpanded: (messageId: string, expanded: boolean) => void
}

export function useWorkflowCollapseState({
  isStreaming,
  scope,
  workflowMessages,
}: {
  isStreaming: boolean
  scope: string
  workflowMessages: WorkflowMessageBlock[]
}): WorkflowCollapseState {
  const [collapsedTurnsById, setCollapsedTurnsById] = useState<Record<string, boolean>>({})
  const previousTurnsRef = useRef(new Map<string, WorkflowTurnCollapseRuntimeState>())

  useEffect(() => {
    previousTurnsRef.current = new Map()
    setCollapsedTurnsById({})
  }, [scope])

  useEffect(() => {
    setCollapsedTurnsById(current => {
      const result = nextWorkflowTurnCollapseState({
        collapsedTurnsById: current,
        isStreaming,
        previousRuntimeByKey: previousTurnsRef.current,
        scope,
        workflowMessages,
      })
      previousTurnsRef.current = result.runtimeByKey
      return result.collapsedTurnsById
    })
  }, [isStreaming, scope, workflowMessages])

  const isTurnExpanded = useCallback((message: Pick<WorkflowMessageBlock, 'id' | 'activity' | 'status'>) => {
    const key = workflowTurnCollapseStateKey(scope, message.id)
    return !(collapsedTurnsById[key] ?? workflowTurnDefaultCollapsed(message))
  }, [collapsedTurnsById, scope])

  const setTurnExpanded = useCallback((messageId: string, expanded: boolean) => {
    const key = workflowTurnCollapseStateKey(scope, messageId)
    setCollapsedTurnsById(current => {
      const collapsed = !expanded
      if (current[key] === collapsed) return current
      return { ...current, [key]: collapsed }
    })
  }, [scope])

  return {
    isTurnExpanded,
    setTurnExpanded,
  }
}
