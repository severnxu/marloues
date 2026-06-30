export type NormalizedItemType =
  | 'agent_message'
  | 'reasoning'
  | 'command_execution'
  | 'file_change'
  | 'mcp_tool_call'
  | 'web_search'
  | 'todo_list'
  | 'error'

export interface NormalizedThreadItem {
  id: string
  type: NormalizedItemType
  rawType?: string
  phase?: 'started' | 'updated' | 'completed'
  text?: string
  command?: string
  shell?: string
  aggregated_output?: string
  exit_code?: number
  status?: string
  changes?: { path: string; kind: string }[]
  server?: string
  tool?: string
  args?: unknown
  arguments?: unknown
  result?: unknown
  error?: { message: string }
  query?: string
  items?: { text: string; completed: boolean }[]
  message?: string
  rawItem?: unknown
}

export interface CodexRawEvent {
  method: string
  params: unknown
  receivedAt: number
}

export interface NormalizedTurn {
  threadId: string
  turnId: string
  startedAt?: number
  updatedAt?: number
  completedAt?: number
  finalText: string
  items: NormalizedThreadItem[]
  methodCounts: Record<string, number>
  hasCompleted: boolean
  hasFailed: boolean
}

const commandToolNames = new Set([
  'shell',
  'shell_command',
  'local_shell',
  'run_command',
  'exec',
])

const fileToolNames = new Set([
  'apply_patch',
  'edit',
  'write_file',
  'create_file',
])

export function normalizeCodexItem(
  item: Record<string, unknown>,
  params: Record<string, unknown> | undefined,
  phase: NormalizedThreadItem['phase']
): NormalizedThreadItem | null {
  const rawType = stringValue(item.type)
  const id = idFromRawItem(item, params, rawType)
  const status = phase === 'completed' ? 'completed' : phase === 'started' ? 'in_progress' : stringValue(item.status)

  if (rawType === 'userMessage') return null

  if (rawType === 'agentMessage' || rawType === 'assistantMessage' || rawType === 'message') {
    return {
      id,
      type: 'agent_message',
      rawType,
      phase,
      text: extractText(item),
      status,
      rawItem: item,
    }
  }

  if (rawType === 'reasoning' || rawType === 'reasoningItem' || rawType === 'summary') {
    return {
      id,
      type: 'reasoning',
      rawType,
      phase,
      text: extractText(item) || stringValue(item.summary),
      status,
      rawItem: item,
    }
  }

  if (isCommandItem(rawType, item)) {
    const output = firstString(
      item.aggregated_output,
      item.aggregatedOutput,
      item.output,
      item.stdout,
      item.stderr,
      item.result,
      asRecord(item.completed)?.output,
      asRecord(item.completed)?.stdout,
      asRecord(item.completed)?.stderr
    )
    return {
      id,
      type: 'command_execution',
      rawType,
      phase,
      command: commandFromItem(item),
      shell: shellFromItem(item),
      aggregated_output: output,
      exit_code: firstNumber(item.exit_code, item.exitCode, asRecord(item.completed)?.exitCode, asRecord(item.completed)?.exit_code),
      status,
      rawItem: item,
    }
  }

  if (isFileChangeItem(rawType, item)) {
    return {
      id,
      type: 'file_change',
      rawType,
      phase,
      changes: normalizeChanges(item.changes ?? item.files ?? item.patch ?? item.result),
      status,
      rawItem: item,
    }
  }

  if (rawType === 'todoList' || rawType === 'todo_list' || rawType === 'todo' || rawType === 'plan') {
    return {
      id,
      type: 'todo_list',
      rawType,
      phase,
      items: normalizeTodos(item.items ?? item.todos ?? item.plan),
      status,
      rawItem: item,
    }
  }

  if (rawType === 'webSearch' || rawType === 'web_search' || toolName(item).includes('web_search')) {
    return {
      id,
      type: 'web_search',
      rawType,
      phase,
      query: stringValue(item.query) || stringValue(item.text) || stringValue(asRecord(item.arguments)?.query),
      status,
      rawItem: item,
    }
  }

  if (rawType === 'error') {
    const message = stringValue(item.message) || stringValue(asRecord(item.error)?.message) || 'Unknown error'
    return {
      id,
      type: 'error',
      rawType,
      phase,
      message,
      error: { message },
      status: 'error',
      rawItem: item,
    }
  }

  if (isToolItem(rawType, item)) {
    const args = item.arguments ?? item.args ?? item.input ?? {}
    return {
      id,
      type: 'mcp_tool_call',
      rawType,
      phase,
      tool: toolName(item) || 'tool',
      server: stringValue(item.server) || stringValue(item.mcpServer),
      args,
      arguments: args,
      result: item.output ?? item.result,
      status,
      rawItem: item,
    }
  }

  return null
}

export function normalizeCodexRawEvents(rawEvents: CodexRawEvent[]): NormalizedTurn {
  const items = new Map<string, NormalizedThreadItem>()
  const agentTextById = new Map<string, string>()
  const methodCounts: Record<string, number> = {}
  let threadId = ''
  let turnId = ''
  let latestAgentId = ''
  let completedAt: number | undefined
  let hasCompleted = false
  let hasFailed = false

  for (const event of rawEvents) {
    methodCounts[event.method] = (methodCounts[event.method] ?? 0) + 1
    const params = asRecord(event.params)
    threadId ||= stringValue(params?.threadId)
    turnId ||= stringValue(params?.turnId)

    if (event.method === 'turn/completed') {
      hasCompleted = true
      completedAt = event.receivedAt
      const turn = asRecord(params?.turn)
      turnId ||= stringValue(turn?.id)
      continue
    }

    if (event.method === 'turn/failed') {
      hasFailed = true
      completedAt = event.receivedAt
      continue
    }

    if (event.method === 'item/agentMessage/delta') {
      const itemId = stringValue(params?.itemId)
      const delta = stringValue(params?.delta)
      if (!itemId || !delta) continue
      const text = `${agentTextById.get(itemId) ?? ''}${delta}`
      agentTextById.set(itemId, text)
      latestAgentId = itemId
      continue
    }

    if (event.method.endsWith('/result')) {
      ingestProbeResult(items, event)
      continue
    }

    if (event.method !== 'item/started' && event.method !== 'item/updated' && event.method !== 'item/completed') {
      continue
    }

    const item = asRecord(params?.item)
    if (!item) continue
    const phase = event.method === 'item/started' ? 'started' : event.method === 'item/updated' ? 'updated' : 'completed'
    const normalized = normalizeCodexItem(item, params, phase)
    if (!normalized) continue

    if (normalized.type === 'agent_message' && normalized.text) {
      agentTextById.set(normalized.id, normalized.text)
      latestAgentId = normalized.id
    }

    const existing = items.get(normalized.id)
    items.set(normalized.id, mergeItem(existing, normalized))
  }

  return {
    threadId,
    turnId,
    startedAt: rawEvents[0]?.receivedAt,
    updatedAt: rawEvents[rawEvents.length - 1]?.receivedAt,
    completedAt,
    finalText: latestAgentId ? (agentTextById.get(latestAgentId) ?? '') : '',
    items: Array.from(items.values()),
    methodCounts,
    hasCompleted,
    hasFailed,
  }
}

function ingestProbeResult(items: Map<string, NormalizedThreadItem>, event: CodexRawEvent): void {
  const params = asRecord(event.params)
  const result = asRecord(params?.result)
  const candidates = [
    result?.items,
    asRecord(result?.turn)?.items,
    result?.turns,
  ]

  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue
    for (const item of flattenProbeItems(candidate)) {
      const normalized = normalizeCodexItem(item, undefined, 'completed')
      if (!normalized) continue
      items.set(normalized.id, mergeItem(items.get(normalized.id), normalized))
    }
  }
}

function flattenProbeItems(entries: unknown[]): Record<string, unknown>[] {
  return entries.flatMap(entry => {
    const record = asRecord(entry)
    if (!record) return []
    const item = asRecord(record.item)
    if (item) return [item]
    if (Array.isArray(record.items)) return flattenProbeItems(record.items)
    return [record]
  })
}

function mergeItem(existing: NormalizedThreadItem | undefined, next: NormalizedThreadItem): NormalizedThreadItem {
  if (!existing) return next
  return {
    ...existing,
    ...next,
    text: next.text || existing.text,
    command: next.command || existing.command,
    shell: next.shell || existing.shell,
    aggregated_output: next.aggregated_output || existing.aggregated_output,
    exit_code: next.exit_code ?? existing.exit_code,
    changes: next.changes?.length ? next.changes : existing.changes,
    items: next.items?.length ? next.items : existing.items,
    result: next.result ?? existing.result,
    args: isEmptyObject(next.args) ? existing.args : next.args,
    arguments: isEmptyObject(next.arguments) ? existing.arguments : next.arguments,
  }
}

function isCommandItem(rawType: string, item: Record<string, unknown>): boolean {
  const name = toolName(item)
  return (
    rawType === 'commandExecution' ||
    rawType === 'command_execution' ||
    rawType === 'command' ||
    rawType === 'localShellCall' ||
    rawType === 'local_shell_call' ||
    commandToolNames.has(name)
  )
}

function isToolItem(rawType: string, item: Record<string, unknown>): boolean {
  return (
    rawType === 'toolCall' ||
    rawType === 'functionCall' ||
    rawType === 'customToolCall' ||
    rawType === 'custom_tool_call' ||
    rawType === 'mcpToolCall' ||
    rawType === 'mcp_tool_call' ||
    Boolean(toolName(item))
  )
}

function isFileChangeItem(rawType: string, item: Record<string, unknown>): boolean {
  return (
    rawType === 'fileChange' ||
    rawType === 'file_change' ||
    rawType === 'fileChangeSet' ||
    rawType === 'patchChange' ||
    rawType === 'patch_change' ||
    fileToolNames.has(toolName(item))
  )
}

function commandFromItem(item: Record<string, unknown>): string {
  const args = asRecord(item.arguments) ?? asRecord(item.args) ?? asRecord(item.input)
  return firstString(
    item.command,
    item.cmd,
    item.name,
    args?.command,
    args?.cmd,
    args?.script,
    asRecord(item.started)?.command
  ) || 'shell'
}

function shellFromItem(item: Record<string, unknown>): string | undefined {
  const args = asRecord(item.arguments) ?? asRecord(item.args) ?? asRecord(item.input)
  const started = asRecord(item.started)
  const completed = asRecord(item.completed)
  return firstString(
    item.shell,
    item.shellName,
    item.shell_name,
    item.shellType,
    item.shell_type,
    item.executor,
    item.runtime,
    args?.shell,
    args?.shellName,
    args?.shell_name,
    args?.shellType,
    args?.shell_type,
    started?.shell,
    started?.shellName,
    started?.shell_name,
    completed?.shell,
    completed?.shellName,
    completed?.shell_name
  ) || undefined
}

function toolName(item: Record<string, unknown>): string {
  return firstString(item.name, item.tool, item.server, item.functionName, item.callType).toLowerCase()
}

function extractText(item: Record<string, unknown>): string {
  const content = item.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map(part => {
      if (typeof part === 'string') return part
      const record = asRecord(part)
      return stringValue(record?.text) || stringValue(record?.content)
    }).filter(Boolean).join('')
  }
  return firstString(item.text, item.message, item.summary)
}

function normalizeChanges(value: unknown): { path: string; kind: string }[] {
  if (Array.isArray(value)) {
    return value.map(change => normalizeChange(asRecord(change))).filter((change): change is { path: string; kind: string } => Boolean(change?.path))
  }

  const record = asRecord(value)
  if (!record) return []

  const direct = normalizeChange(record)
  if (direct?.path) return [direct]

  return ['added', 'modified', 'deleted', 'files'].flatMap(key => {
    const list = record[key]
    if (!Array.isArray(list)) return []
    return list.map(entry => normalizeChange(asRecord(entry), key)).filter((change): change is { path: string; kind: string } => Boolean(change?.path))
  })
}

function normalizeChange(record: Record<string, unknown> | undefined, fallbackKind = 'modified'): { path: string; kind: string } | null {
  if (!record) return null
  const path = stringValue(record.path) || stringValue(record.file) || stringValue(record.name)
  if (!path) return null
  return {
    path,
    kind: stringValue(record.kind) || stringValue(record.type) || stringValue(record.status) || fallbackKind,
  }
}

function normalizeTodos(value: unknown): { text: string; completed: boolean }[] {
  if (!Array.isArray(value)) return []
  return value.map(todo => {
    if (typeof todo === 'string') return { text: todo, completed: false }
    const record = asRecord(todo)
    return {
      text: stringValue(record?.text) || stringValue(record?.title) || stringValue(record?.message),
      completed: Boolean(record?.completed ?? record?.done ?? record?.status === 'completed'),
    }
  }).filter(todo => todo.text)
}

function idFromRawItem(item: Record<string, unknown>, params: Record<string, unknown> | undefined, rawType: string): string {
  return stringValue(item.id) || stringValue(item.itemId) || stringValue(params?.itemId) || `${rawType || 'item'}-${Date.now()}`
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value) return value
  }
  return ''
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number') return value
  }
  return undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined
}

function isEmptyObject(value: unknown): boolean {
  return value != null && typeof value === 'object' && Object.keys(value).length === 0
}
