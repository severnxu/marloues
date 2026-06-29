import { readLatestSessionLog, type SessionLogTarget } from './session-log'
import type {
  WorkflowReadThreadResponse,
  WorkflowTextOutput,
  WorkflowTurn,
  WorkflowTurnItem,
} from '../../shared/workflow-read-thread-contract'
import type {
  WorkflowReadThreadInput,
  WorkflowThreadDataSource,
} from '../../shared/workflow-thread-data-source'

const DEFAULT_READ_THREAD_LIMIT = 100

export interface JsonlReplayDataSourceOptions {
  target?: SessionLogTarget
  defaultLimit?: number
}

export function createJsonlReplayWorkflowThreadDataSource(
  options: JsonlReplayDataSourceOptions = {}
): WorkflowThreadDataSource {
  return {
    kind: 'jsonl-replay',
    async readThread(input) {
      return readJsonlReplayThread(input, options)
    },
  }
}

export function readJsonlReplayThread(
  input: WorkflowReadThreadInput = {},
  options: JsonlReplayDataSourceOptions = {}
): WorkflowReadThreadResponse {
  const snapshot = readLatestSessionLog({
    ...options.target,
    sessionId: input.threadId ?? options.target?.sessionId,
  })

  if (!snapshot) {
    throw new Error('No Codex JSONL replay source is available')
  }

  const limit = positiveInteger(input.limit ?? options.defaultLimit) ?? DEFAULT_READ_THREAD_LIMIT
  const offset = cursorToOffset(input.cursor)
  const turns = snapshot.readThread.turns.slice(offset, offset + limit)
  const nextOffset = offset + turns.length
  const hasMore = nextOffset < snapshot.readThread.turns.length

  return {
    ...snapshot.readThread,
    page: {
      ...snapshot.readThread.page,
      limit,
      nextCursor: hasMore ? offsetToCursor(nextOffset) : null,
      hasMore,
    },
    turns: turns.map(turn => normalizeTurnOutputs(turn, input)),
  }
}

export function jsonlReplayCursorForOffset(offset: number): string {
  return offsetToCursor(offset)
}

export function jsonlReplayOffsetForCursor(cursor?: string | null): number {
  return cursorToOffset(cursor)
}

function normalizeTurnOutputs(turn: WorkflowTurn, input: WorkflowReadThreadInput): WorkflowTurn {
  if (input.includeOutputs !== false && !input.maxOutputCharsPerItem) return turn

  return {
    ...turn,
    items: turn.items.map(item => normalizeItemOutput(item, input)),
  }
}

function normalizeItemOutput(item: WorkflowTurnItem, input: WorkflowReadThreadInput): WorkflowTurnItem {
  const outputLimit = positiveInteger(input.maxOutputCharsPerItem)
  const withTruncatedOutputs = outputLimit
    ? truncateItemOutputs(item, outputLimit)
    : item

  if (input.includeOutputs !== false) return withTruncatedOutputs

  if ('output' in withTruncatedOutputs) {
    const { output: _output, ...rest } = withTruncatedOutputs
    return rest as WorkflowTurnItem
  }

  if (withTruncatedOutputs.type === 'reasoning' && withTruncatedOutputs.content) {
    const { content: _content, ...rest } = withTruncatedOutputs
    return rest
  }

  return withTruncatedOutputs
}

function truncateItemOutputs(item: WorkflowTurnItem, maxChars: number): WorkflowTurnItem {
  if ('output' in item && item.output) {
    return {
      ...item,
      output: truncateTextOutput(item.output, maxChars),
    } as WorkflowTurnItem
  }

  if (item.type === 'reasoning' && item.content) {
    return {
      ...item,
      content: item.content.map(output => truncateTextOutput(output, maxChars)),
    }
  }

  if (item.type === 'fileChange') {
    return {
      ...item,
      changes: item.changes.map(change => ({
        ...change,
        diff: change.diff ? truncateTextOutput(change.diff, maxChars) : change.diff,
      })),
    }
  }

  return item
}

function truncateTextOutput(output: WorkflowTextOutput, maxChars: number): WorkflowTextOutput {
  if (output.text.length <= maxChars) return output
  return {
    text: output.text.slice(0, maxChars),
    truncated: true,
    originalChars: 'originalChars' in output && typeof output.originalChars === 'number'
      ? output.originalChars
      : output.text.length,
  }
}

function positiveInteger(value: unknown): number | null {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  return Math.floor(numeric)
}

function cursorToOffset(cursor?: string | null): number {
  if (!cursor) return 0

  if (cursor.startsWith('offset:')) {
    return positiveInteger(cursor.slice('offset:'.length)) ?? 0
  }

  return positiveInteger(cursor) ?? 0
}

function offsetToCursor(offset: number): string {
  return `offset:${Math.max(0, Math.floor(offset))}`
}
