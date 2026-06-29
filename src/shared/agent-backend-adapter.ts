import type {
  WorkflowReadThreadInput,
  WorkflowSubscribeThreadInput,
  WorkflowThreadDataSource,
  WorkflowThreadPatch,
} from './workflow-thread-data-source'
import type { WorkflowReadThreadResponse } from './workflow-read-thread-contract'

export type AgentBackendAdapterKind =
  | 'workflow-app-server'
  | 'jsonl-replay'
  | 'static'
  | 'custom'

export interface AgentThreadSummary {
  id: string
  title: string
  preview?: string
  status?: WorkflowReadThreadResponse['thread']['status']
  cwd?: string | null
  createdAt?: number | string | null
  updatedAt?: number | string | null
}

export interface AgentSendMessageInput {
  threadId?: string
  cwd?: string
  text: string
  metadata?: Record<string, unknown>
}

export interface AgentThreadOperationInput {
  threadId: string
  cwd?: string
  metadata?: Record<string, unknown>
}

export interface AgentForkThreadInput extends AgentThreadOperationInput {
  targetThreadId?: string
}

export type AgentThreadEvent =
  | WorkflowReadThreadResponse
  | WorkflowThreadPatch

export interface AgentBackendAdapter {
  readonly kind: AgentBackendAdapterKind
  listThreads?(): Promise<AgentThreadSummary[]>
  readThread(input: WorkflowReadThreadInput): Promise<WorkflowReadThreadResponse>
  sendMessage?(input: AgentSendMessageInput): Promise<void>
  subscribeThread?(
    input: WorkflowSubscribeThreadInput
  ): AsyncIterable<AgentThreadEvent>
  forkThread?(input: AgentForkThreadInput): Promise<string>
  resumeThread?(input: AgentThreadOperationInput): Promise<void>
}

export function createAgentBackendAdapterFromDataSource(
  dataSource: WorkflowThreadDataSource
): AgentBackendAdapter {
  return {
    kind: dataSource.kind,
    readThread(input) {
      return dataSource.readThread(input)
    },
    subscribeThread: dataSource.subscribeThread
      ? input => dataSource.subscribeThread?.(input) as AsyncIterable<AgentThreadEvent>
      : undefined,
  }
}
