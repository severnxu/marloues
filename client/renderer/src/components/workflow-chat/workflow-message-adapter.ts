import type { WorkflowRawEvent, Message, MessageItem } from '../../types'
import {
  isWorkflowCanonicalTurnItemType,
  type WorkflowItemStatus,
  type WorkflowReadThreadResponse,
  type WorkflowTextOutput,
  type WorkflowUserMessageContent,
} from '../../../../shared/workflow-read-thread-contract'
import {
  workflowMessagesToWorkflowReadThreadResponse,
  type WorkflowReadThreadAdapterOptions,
  type WorkflowMessageBlock as AdapterWorkflowMessageBlock,
  type WorkflowTurnItem,
} from '../../../../shared/adapters/workflow-messages-to-read-thread'

export type WorkflowActivity = 'thinking' | 'running' | 'responding' | 'done' | 'failed'
export type WorkflowTurnStatus = 'running' | 'completed' | 'failed'
export type { WorkflowUserMessageContent }

type TextOutput = WorkflowTextOutput

export type WorkflowStreamItem = WorkflowTurnItem
type WorkflowWebSearchItem = Extract<WorkflowStreamItem, { type: 'webSearch' }>

export type WorkflowMessageBlock = AdapterWorkflowMessageBlock
export type { WorkflowReadThreadAdapterOptions }
export { workflowMessagesToWorkflowReadThreadResponse }

export function messagesToWorkflowReadThreadResponse(
  messages: Message[],
  isStreaming: boolean,
  options: WorkflowReadThreadAdapterOptions = {}
): WorkflowReadThreadResponse {
  return workflowMessagesToWorkflowReadThreadResponse(toWorkflowMessages(messages, isStreaming), options)
}

export function toWorkflowMessages(messages: Message[], isStreaming: boolean): WorkflowMessageBlock[] {
  const blocks: WorkflowMessageBlock[] = []
  let current: WorkflowMessageBlock | null = null

  for (const message of messages) {
    if (message.role === 'user') {
      const block: WorkflowMessageBlock = {
        id: message.id,
        userMessageId: message.id,
        user: message.content,
        userContent: message.userContent?.length ? message.userContent : textUserContent(message.content),
        status: 'running',
        activity: 'thinking',
        startedAt: message.timestamp,
        durationMs: null,
        usage: message.usage,
        modelId: message.modelId,
        modelName: message.modelName,
        items: [],
      }
      current = block
      blocks.push(current)
      continue
    }

    if (!current) {
      const block: WorkflowMessageBlock = {
        id: message.id,
        user: '',
        userContent: [],
        status: 'running',
        activity: 'thinking',
        startedAt: message.startedAt ?? message.timestamp,
        durationMs: null,
        modelId: message.modelId,
        modelName: message.modelName,
        items: [],
      }
      current = block
      blocks.push(current)
    }

    const currentBlock = current
    const rawTurn = turnStateFromRawEvents(message.rawEvents ?? [])
    const completedAt = message.completedAt ?? rawTurn.completedAt
    const startedAt = currentBlock.startedAt ?? message.startedAt ?? message.timestamp
    currentBlock.id = `${currentBlock.id}-${message.id}`
    currentBlock.startedAt = startedAt
    currentBlock.completedAt = completedAt
    currentBlock.durationMs = completedAt ? Math.max(0, completedAt - startedAt) : null
    currentBlock.modelId = message.modelId ?? currentBlock.modelId
    currentBlock.modelName = message.modelName ?? currentBlock.modelName
    currentBlock.usage = message.usage ?? currentBlock.usage
    currentBlock.status = message.status === 'failed' ? 'failed' : message.status === 'completed' || rawTurn.completed ? 'completed' : 'running'
    currentBlock.activity = activityForMessage(message, isStreaming, rawTurn.completed)
    currentBlock.items = compactItems([...currentBlock.items, ...itemsFromAssistantMessage(message)])
  }

  return blocks.filter(block => block.user || block.items.length)
}

export function normalizeWorkflowMessages(value: unknown): WorkflowMessageBlock[] {
  if (!Array.isArray(value)) return []

  return value.map((entry, index) => {
    const record = asRecord(entry) ?? {}
    const user = stringValue(record.user)
    const startedAt = numberValue(record.startedAt)
    const completedAt = numberValue(record.completedAt)
    const status = normalizeTurnStatus(stringValue(record.status))
    const activity = normalizeActivity(stringValue(record.activity), status)
    const items = Array.isArray(record.items)
      ? compactItems(record.items.map((item, itemIndex) => normalizeExternalItem(item, `external-${index}-${itemIndex}`)))
      : []

    return {
      id: stringValue(record.id) || `external-${index}`,
      userMessageId: stringValue(record.userMessageId) || undefined,
      user,
      userContent: Array.isArray(record.userContent) ? record.userContent as WorkflowUserMessageContent[] : textUserContent(user),
      status,
      activity,
      startedAt,
      completedAt,
      durationMs: numberValue(record.durationMs) ?? null,
      items,
    }
  }).filter(message => message.user || message.items.length)
}

export function finalAssistantText(block: WorkflowMessageBlock): string {
  const indexes = finalAssistantMessageIndexes(block.items)
  if (indexes.size) {
    return [...indexes]
      .sort((a, b) => a - b)
      .map(index => block.items[index])
      .filter((item): item is Extract<WorkflowStreamItem, { type: 'agentMessage' }> => item?.type === 'agentMessage')
      .map(item => stripThinkTags(item.text))
      .filter(Boolean)
      .join('\n\n')
  }

  for (let index = block.items.length - 1; index >= 0; index -= 1) {
    const item = block.items[index]
    if (item?.type !== 'agentMessage') continue
    const text = stripThinkTags(item.text)
    if (text) return text
  }
  return ''
}

function finalAssistantMessageIndexes(items: WorkflowStreamItem[]): Set<number> {
  const indexes = new Set<number>()
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item?.type !== 'agentMessage' || !stripThinkTags(item.text)) continue
    indexes.add(index)
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const previous = items[cursor]
      if (!previous || previous.type === 'userMessage') continue
      if (previous.type === 'agentMessage') {
        if (stripThinkTags(previous.text)) indexes.add(cursor)
        continue
      }
      if (isSilentFinalBoundary(previous)) continue
      break
    }
    return indexes
  }
  return indexes
}

function isSilentFinalBoundary(item: Exclude<WorkflowStreamItem, { type: 'agentMessage' } | { type: 'userMessage' }>): boolean {
  if (item.type === 'contextCompaction') return true
  if (item.type === 'dynamicToolCall') return item.tool.toLowerCase() === 'token_count'
  if (item.type === 'mcpToolCall') {
    const name = [item.server, item.tool].filter(Boolean).join('.').toLowerCase()
    return name === 'token_count' || name.endsWith('.token_count')
  }
  return false
}

function normalizeExternalItem(value: unknown, fallbackId: string): WorkflowStreamItem {
  const item = asRecord(value) ?? {}
  const type = stringValue(item.type)
  if (isCanonicalType(type)) return item as unknown as WorkflowStreamItem

  const kind = stringValue(item.kind)
  const id = stringValue(item.id) || fallbackId

  if (kind === 'assistant') {
    return { type: 'agentMessage', id, text: stringValue(item.text), phase: 'completed' }
  }

  if (kind === 'reasoning') {
    const text = stringValue(item.text)
    return { type: 'reasoning', id, summary: text, encrypted: Boolean(item.encrypted), content: text ? [{ text }] : undefined }
  }

  if (kind === 'file') {
    const files = Array.isArray(item.files) ? item.files.filter((file): file is string => typeof file === 'string') : []
    const patch = stringValue(item.patch)
    return {
      type: 'fileChange',
      id,
      status: item.failed ? 'failed' : item.pending ? 'running' : 'completed',
      changes: files.map(path => ({ path, kind: stringValue(item.action) || 'modified', diff: patch ? { text: patch } : undefined })),
    }
  }

  if (kind === 'tool') {
    const name = stringValue(item.name)
    const input = stringValue(item.input)
    const output = stringValue(item.output)
    const status = stringValue(item.status) || 'completed'

    if (name === 'shell_command' || name.includes('command')) {
      return { type: 'commandExecution', id, command: input, shell: shellFromRaw(item), status, output: textOutput(output) }
    }

    if (name === 'web_search' || Boolean(item.usedBrowser)) {
      return { type: 'webSearch', id, query: '', action: input, status, output: textOutput(output) }
    }

    if (name === 'image_generation') {
      return { type: 'imageGeneration', id, status, revisedPrompt: input, result: output }
    }

    if (name === 'update_plan') return { type: 'plan', id, text: output || input }
    if (name === 'context_compacted') return { type: 'contextCompaction', id }
    if (name === 'plan_snapshot') return { type: 'plan', id, text: output || input }

    return { type: 'dynamicToolCall', id, tool: name || 'tool_call', arguments: input, status, output: textOutput(output) }
  }

  return { type: 'unknown', id, rawType: type || kind, raw: value }
}

function isCanonicalType(type: string): boolean {
  return type === 'unknown' || isWorkflowCanonicalTurnItemType(type)
}

function normalizeTurnStatus(value: string): WorkflowTurnStatus {
  if (value === 'failed') return 'failed'
  if (value === 'completed') return 'completed'
  return 'running'
}

function normalizeActivity(value: string, status: WorkflowTurnStatus): WorkflowActivity {
  if (value === 'thinking' || value === 'running' || value === 'responding' || value === 'done' || value === 'failed') return value
  if (status === 'completed') return 'done'
  if (status === 'failed') return 'failed'
  return 'running'
}

export function itemOutputText(item: WorkflowStreamItem): string {
  if ('output' in item && item.output) return item.output.text
  return ''
}

export function itemInputText(item: WorkflowStreamItem): string {
  if (item.type === 'commandExecution') return item.command
  if (item.type === 'mcpToolCall' || item.type === 'dynamicToolCall') return formatValue(item.arguments ?? '')
  if (item.type === 'webSearch') return formatValue(item.action ?? item.query ?? '')
  if (item.type === 'imageGeneration') return item.revisedPrompt ?? ''
  if (item.type === 'collabAgentToolCall') return item.prompt ?? ''
  if (item.type === 'plan') return item.text
  if (item.type === 'reasoning') return item.summary
  return ''
}

function activityForMessage(message: Message, isStreaming: boolean, rawCompleted = false): WorkflowActivity {
  if (message.status === 'failed') return 'failed'
  if (message.status === 'completed' || rawCompleted) return 'done'
  if (message.status === 'running') return 'running'
  if (isStreaming) return message.content ? 'responding' : 'thinking'
  return message.content ? 'responding' : 'thinking'
}

function turnStateFromRawEvents(rawEvents: WorkflowRawEvent[]): { completed: boolean; completedAt?: number } {
  for (let index = rawEvents.length - 1; index >= 0; index -= 1) {
    const event = rawEvents[index]
    if (event.method === 'turn/completed') {
      return { completed: true, completedAt: event.receivedAt }
    }
  }
  return { completed: false }
}

function itemsFromAssistantMessage(message: Message): WorkflowStreamItem[] {
  const rawItems = message.rawEvents?.length ? itemsFromRawEvents(message.rawEvents) : []
  const normalizedItems = message.items.length ? itemsFromNormalizedItems(message.items) : []
  const items = rawItems.length ? mergeById(normalizedItems, rawItems) : normalizedItems
  const hasAgentMessage = items.some(item => item.type === 'agentMessage' && stripThinkTags(item.text))

  if (message.content && !hasAgentMessage) {
    items.push(...agentItems(message.id, message.content))
  }

  return compactItems(items)
}

function itemsFromRawEvents(rawEvents: WorkflowRawEvent[]): WorkflowStreamItem[] {
  const items: WorkflowStreamItem[] = []
  const agentText = new Map<string, string>()

  for (const event of rawEvents) {
    const params = asRecord(event.params)

    if (event.method === 'item/agentMessage/delta') {
      const itemId = stringValue(params?.itemId)
      const delta = stringValue(params?.delta)
      if (!itemId || !delta) continue
      const fullText = (agentText.get(itemId) ?? '') + delta
      agentText.set(itemId, fullText)
      upsertAgent(items, itemId, fullText)
      continue
    }

    if (event.method !== 'item/started' && event.method !== 'item/updated' && event.method !== 'item/completed') {
      continue
    }

    const rawItem = asRecord(params?.item)
    if (!rawItem) continue

    const phase = event.method === 'item/completed' ? 'completed' : 'running'
    const rawType = stringValue(rawItem.type)
    const id = stringValue(rawItem.id) || stringValue(params?.itemId) || `${rawType}-${event.receivedAt}`

    upsertItem(items, canonicalFromRawItem(id, rawType, rawItem, phase))
  }

  return items
}

function canonicalFromRawItem(id: string, rawType: string, rawItem: Record<string, unknown>, phase: 'running' | 'completed'): WorkflowStreamItem {
  if (rawType === 'agentMessage') {
    return { type: 'agentMessage', id, text: extractTextContent(rawItem.text) || extractTextContent(rawItem.content), phase }
  }

  if (rawType === 'plan') {
    return { type: 'plan', id, text: stringValue(rawItem.text) }
  }

  if (rawType === 'reasoning' || rawType === 'reasoningItem') {
    const summary = extractTextContent(rawItem.text) || extractTextContent(rawItem.summary)
    return { type: 'reasoning', id, summary, encrypted: Boolean(rawItem.encrypted_content), content: summary ? [{ text: summary }] : undefined }
  }

  if (rawType === 'fileChange' || rawType === 'file_change' || rawType === 'fileChangeSet') {
    const changes = normalizeChanges(rawItem.changes ?? rawItem.files)
    const diff = stringValue(rawItem.patch) || stringValue(rawItem.diff)
    return {
      type: 'fileChange',
      id,
      status: phase,
      changes: changes.map(change => ({ ...change, diff: diff ? { text: diff } : undefined })),
    }
  }

  if (rawType === 'commandExecution' || rawType === 'command_execution' || rawType === 'command') {
    return {
      type: 'commandExecution',
      id,
      command: stringValue(rawItem.command) || stringValue(rawItem.cmd) || stringValue(rawItem.name),
      shell: shellFromRaw(rawItem),
      status: phase,
      exitCode: numberValue(rawItem.exitCode) ?? numberValue(rawItem.exit_code) ?? null,
      output: textOutput(extractTextContent(rawItem.aggregated_output) || extractTextContent(rawItem.output) || extractTextContent(rawItem.stdout) || extractTextContent(rawItem.stderr)),
    }
  }

  if (rawType === 'webSearch' || rawType === 'web_search') {
    return workflowWebSearchItem({
      id,
      query: stringValue(rawItem.query),
      action: rawItem.action ?? rawItem,
      status: phase,
      output: formatValue(rawItem.result ?? rawItem.output ?? ''),
    })
  }

  if (rawType === 'imageView') {
    return { type: 'imageView', id, path: stringValue(rawItem.path) || stringValue(rawItem.url) }
  }

  if (rawType === 'imageGeneration') {
    return {
      type: 'imageGeneration',
      id,
      status: phase,
      revisedPrompt: stringValue(rawItem.revisedPrompt) || stringValue(rawItem.revised_prompt) || stringValue(rawItem.prompt),
      result: stringValue(rawItem.result),
      savedPath: stringValue(rawItem.savedPath) || stringValue(rawItem.saved_path) || null,
    }
  }

  if (rawType === 'contextCompaction' || rawType === 'context_compaction' || rawType === 'context_compacted') return { type: 'contextCompaction', id }

  if (rawType === 'enteredReviewMode' || rawType === 'entered_review_mode') {
    return { type: 'enteredReviewMode', id, review: rawItem.review ?? rawItem }
  }

  if (rawType === 'exitedReviewMode' || rawType === 'exited_review_mode') {
    return { type: 'exitedReviewMode', id, review: rawItem.review ?? rawItem }
  }

  if (rawType === 'hookPrompt' || rawType === 'hook_prompt') {
    const fragments = rawItem.fragments
    return {
      type: 'hookPrompt',
      id,
      fragmentCount: Array.isArray(fragments) ? fragments.length : numberValue(rawItem.fragmentCount) ?? numberValue(rawItem.fragment_count) ?? 0,
      fragments,
    }
  }

  if (rawType === 'permissionRequest' || rawType === 'permission_request' || rawType === 'approvalRequest' || rawType === 'approval_request') {
    return {
      type: 'permissionRequest',
      id,
      toolName: stringValue(rawItem.toolName) || stringValue(rawItem.tool_name) || stringValue(rawItem.tool) || 'tool',
      reason: stringValue(rawItem.reason) || extractTextContent(rawItem.inputSummary) || extractTextContent(rawItem.input_summary),
      status: stringValue(rawItem.status) || phase,
      timeoutMs: numberValue(rawItem.timeoutMs) ?? numberValue(rawItem.timeout_ms) ?? null,
    }
  }

  if (rawType === 'collabAgentToolCall' || rawType === 'collab_agent_tool_call') {
    return {
      type: 'collabAgentToolCall',
      id,
      tool: stringValue(rawItem.tool) || stringValue(rawItem.name) || 'collab_agent',
      status: phase,
      senderThreadId: stringValue(rawItem.senderThreadId) || stringValue(rawItem.sender_thread_id) || undefined,
      receiverThreadIds: stringArray(rawItem.receiverThreadIds ?? rawItem.receiver_thread_ids),
      prompt: stringValue(rawItem.prompt) || extractTextContent(rawItem.input),
      model: stringValue(rawItem.model) || undefined,
      reasoningEffort: stringValue(rawItem.reasoningEffort) || stringValue(rawItem.reasoning_effort) || undefined,
    }
  }

  if (rawType === 'mcpToolCall' || rawType === 'toolCall' || rawType === 'functionCall') {
    const tool = stringValue(rawItem.tool) || stringValue(rawItem.name) || stringValue(rawItem.server) || 'tool_call'
    return {
      type: rawType === 'mcpToolCall' ? 'mcpToolCall' : 'dynamicToolCall',
      id,
      tool,
      server: stringValue(rawItem.server) || undefined,
      arguments: rawItem.arguments ?? rawItem.args,
      status: phase,
      output: textOutput(formatValue(rawItem.output ?? rawItem.result ?? '')),
    } as WorkflowStreamItem
  }

  return { type: 'unknown', id, rawType, raw: rawItem }
}

function itemsFromNormalizedItems(sourceItems: MessageItem[]): WorkflowStreamItem[] {
  const items: WorkflowStreamItem[] = []

  for (const item of sourceItems) {
    if (item.type === 'reasoning') {
      upsertItem(items, { type: 'reasoning', id: item.id, summary: item.text ?? '', encrypted: false, content: item.text ? [{ text: item.text }] : undefined })
      continue
    }

    if (item.type === 'agent_message') {
      if (item.text) upsertAgent(items, item.id, item.text)
      continue
    }

    if (item.type === 'file_change') {
      upsertItem(items, {
        type: 'fileChange',
        id: item.id,
        status: item.phase === 'completed' ? 'completed' : 'running',
        changes: (item.changes ?? []).map(change => ({ path: change.path, kind: change.kind, diff: item.patch ? { text: item.patch } : undefined })),
      })
      continue
    }

    if (item.type === 'command_execution') {
      upsertItem(items, {
        type: 'commandExecution',
        id: item.id,
        command: item.command ?? '',
        shell: item.shell,
        status: item.status ?? 'completed',
        exitCode: item.exit_code ?? null,
        output: textOutput(item.aggregated_output ?? ''),
      })
      continue
    }

    if (item.type === 'mcp_tool_call') {
      upsertItem(items, {
        type: 'mcpToolCall',
        id: item.id,
        server: item.server,
        tool: item.tool ?? item.server ?? 'mcp_tool_call',
        arguments: item.args ?? item.arguments,
        status: item.status ?? (item.phase === 'completed' ? 'completed' : 'running'),
        output: textOutput(formatValue(item.result ?? item.error?.message ?? item.message ?? '')),
      })
      continue
    }

    if (item.type === 'web_search') {
      upsertItem(items, workflowWebSearchItem({
        id: item.id,
        query: item.query,
        action: item.args ?? item.arguments,
        status: item.status ?? (item.phase === 'completed' ? 'completed' : 'running'),
        output: formatValue(item.result ?? ''),
      }))
      continue
    }

    if (item.type === 'todo_list') {
      upsertItem(items, {
        type: 'plan',
        id: item.id,
        text: (item.items ?? []).map((entry, index) => `${index + 1}. ${entry.completed ? '[completed]' : '[pending]'} ${entry.text}`).join('\n'),
      })
      continue
    }

    if (item.type === 'permission_request') {
      upsertItem(items, {
        type: 'permissionRequest',
        id: item.id,
        toolName: item.toolName ?? item.tool ?? 'tool',
        reason: item.reason ?? item.message ?? '',
        status: item.status ?? (item.phase === 'completed' ? 'completed' : 'running'),
        timeoutMs: item.timeoutMs ?? null,
      })
      continue
    }

    if (item.type === 'error') {
      upsertItem(items, {
        type: 'dynamicToolCall',
        id: item.id,
        tool: 'error',
        arguments: {},
        status: 'error',
        success: false,
        output: textOutput(item.error?.message ?? item.message ?? ''),
      })
    }
  }

  return items
}

function upsertAgent(items: WorkflowStreamItem[], id: string, text: string): void {
  for (const item of agentItems(id, text)) upsertItem(items, item)
}

function agentItems(id: string, text: string): WorkflowStreamItem[] {
  const visible = stripThinkTags(text)
  return visible ? [{ type: 'agentMessage', id, text: visible }] : []
}

function compactItems(items: WorkflowStreamItem[]): WorkflowStreamItem[] {
  const compacted: WorkflowStreamItem[] = []
  const seenText = new Set<string>()

  for (const item of items) {
    if (item.type === 'agentMessage') {
      const text = stripThinkTags(item.text)
      const key = text.replace(/\s+/g, ' ').trim()
      if (!key || seenText.has(key)) continue
      seenText.add(key)
      compacted.push({ ...item, text })
      continue
    }

    if (item.type === 'reasoning') {
      const key = `${item.summary}|${item.encrypted ? 'encrypted' : 'plain'}`
      if (seenText.has(key)) continue
      seenText.add(key)
      compacted.push({ ...item })
      continue
    }

    compacted.push({ ...item })
  }

  return compacted
}

function mergeById(primary: WorkflowStreamItem[], override: WorkflowStreamItem[]): WorkflowStreamItem[] {
  const merged = new Map<string, WorkflowStreamItem>()
  for (const item of primary) merged.set(item.id, item)
  for (const item of override) merged.set(item.id, item)
  return Array.from(merged.values())
}

function upsertItem(items: WorkflowStreamItem[], item: WorkflowStreamItem): void {
  const index = items.findIndex(existing => existing.id === item.id)
  if (index >= 0) items[index] = item
  else items.push(item)
}

function textOutput(text: string): TextOutput | undefined {
  return text ? { text } : undefined
}

function workflowWebSearchItem({
  id,
  query = '',
  action,
  status,
  output = '',
}: {
  id: string
  query?: string
  action?: unknown
  status?: WorkflowItemStatus
  output?: string
}): WorkflowWebSearchItem {
  return {
    type: 'webSearch',
    id,
    query,
    action,
    status,
    output: textOutput(output),
  }
}

function textUserContent(text: string): WorkflowUserMessageContent[] {
  return text ? [{ type: 'text', text }] : []
}

function stripThinkTags(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<think>[\s\S]*$/g, '')
    .replace(/<\/think>/g, '')
    .replace(/<think>/g, '')
    .trim()
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value === 'string') return value
  const text = extractTextContent(value)
  if (text) return text
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function extractTextContent(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(extractTextContent).filter(Boolean).join('\n\n')

  const record = asRecord(value)
  if (!record) return ''

  const direct = stringValue(record.text)
    || stringValue(record.content)
    || stringValue(record.output_text)
    || stringValue(record.input_text)
    || stringValue(record.message)
  if (direct) return direct

  for (const key of ['content', 'output', 'message', 'result', 'parts']) {
    const nested = extractTextContent(record[key])
    if (nested) return nested
  }

  return ''
}

function shellFromRaw(item: Record<string, unknown>): string | undefined {
  const args = asRecord(item.arguments) ?? asRecord(item.args) ?? asRecord(item.input)
  return stringValue(item.shell)
    || stringValue(item.shellName)
    || stringValue(item.shell_name)
    || stringValue(item.shellType)
    || stringValue(item.shell_type)
    || stringValue(item.executor)
    || stringValue(args?.shell)
    || stringValue(args?.shellName)
    || stringValue(args?.shell_name)
    || stringValue(args?.shellType)
    || stringValue(args?.shell_type)
    || undefined
}

function normalizeChanges(value: unknown): { path: string; kind: string }[] {
  if (!Array.isArray(value)) return []
  return value.map(change => {
    const record = asRecord(change)
    return {
      path: stringValue(record?.path) || stringValue(record?.file) || stringValue(record?.name),
      kind: stringValue(record?.kind) || stringValue(record?.type) || stringValue(record?.status) || 'modified',
    }
  }).filter(change => change.path)
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const values = value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()))
  return values.length ? values : undefined
}
