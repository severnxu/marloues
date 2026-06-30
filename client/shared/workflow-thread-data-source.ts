import type { WorkflowReadThreadResponse, WorkflowTurn } from './workflow-read-thread-contract'

export interface WorkflowReadThreadInput {
  threadId?: string
  cursor?: string | null
  limit?: number
  includeOutputs?: boolean
  maxOutputCharsPerItem?: number
}

export interface WorkflowSubscribeThreadInput extends WorkflowReadThreadInput {
  signal?: AbortSignal
}

export type WorkflowThreadDataSourceKind =
  | 'workflow-app-server'
  | 'jsonl-replay'
  | 'static'
  | 'custom'

export interface WorkflowThreadDataSource {
  readonly kind: WorkflowThreadDataSourceKind
  readThread(input: WorkflowReadThreadInput): Promise<WorkflowReadThreadResponse>
  subscribeThread?(
    input: WorkflowSubscribeThreadInput
  ): AsyncIterable<WorkflowReadThreadResponse | WorkflowThreadPatch>
}

export type WorkflowThreadPatch =
  | WorkflowThreadSnapshotPatch
  | WorkflowThreadTurnsPatch
  | WorkflowThreadStatusPatch

export interface WorkflowThreadSnapshotPatch {
  type: 'snapshot'
  snapshot: WorkflowReadThreadResponse
}

export interface WorkflowThreadTurnsPatch {
  type: 'turns'
  order: WorkflowReadThreadResponse['page']['order']
  turns: WorkflowTurn[]
  page?: Partial<WorkflowReadThreadResponse['page']>
}

export interface WorkflowThreadStatusPatch {
  type: 'threadStatus'
  thread: Partial<WorkflowReadThreadResponse['thread']>
}

export type WorkflowThreadSnapshotLoader =
  | WorkflowReadThreadResponse
  | ((input: WorkflowReadThreadInput) => WorkflowReadThreadResponse | Promise<WorkflowReadThreadResponse>)

export function createStaticWorkflowThreadDataSource(
  loader: WorkflowThreadSnapshotLoader
): WorkflowThreadDataSource {
  return {
    kind: 'static',
    async readThread(input) {
      return typeof loader === 'function' ? await loader(input) : loader
    },
  }
}
