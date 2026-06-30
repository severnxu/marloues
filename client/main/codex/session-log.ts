import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join, basename, resolve, sep } from 'path'
import { homedir } from 'os'
import type {
  WorkflowReadThreadResponse,
  WorkflowTextOutput,
  WorkflowTurnItem as ReadThreadTurnItem,
  WorkflowUserMessageContent,
} from '../../shared/workflow-read-thread-contract'
import type { WorkflowTurnItem } from '../../shared/adapters/workflow-messages-to-read-thread'

type TextOutput = WorkflowTextOutput
type WorkflowStreamItem = WorkflowTurnItem

export interface WorkflowMessageBlock {
  id: string
  user: string
  userContent: WorkflowUserMessageContent[]
  status: 'running' | 'completed' | 'failed'
  activity: 'thinking' | 'running' | 'responding' | 'done' | 'failed'
  startedAt?: number
  completedAt?: number
  durationMs: number | null
  items: WorkflowStreamItem[]
}

export interface SessionLogSnapshot {
  source: string
  generatedAt: string
  sessionId: string
  cwd: string
  messages: WorkflowMessageBlock[]
  readThread: WorkflowReadThreadResponse
}

export interface SessionLogTarget {
  source?: string
  sessionId?: string
}

interface JsonlEvent {
  timestamp?: string
  type: string
  payload?: Record<string, unknown>
}

interface ToolRecord {
  id: string
  name: string
  input: string
  output: string
  status: string
  files?: string[]
  patch?: string
  server?: string
}

const sessionsRoot = join(homedir(), '.codex', 'sessions')

export function readLatestSessionLog(target?: SessionLogTarget): SessionLogSnapshot | null {
  const source = target ? sessionFileForTarget(target) : latestSessionFile()
  if (!source) return null
  return parseSessionLog(source)
}

function walk(dir: string, files: string[] = []): string[] {
  if (!existsSync(dir)) return files

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) walk(fullPath, files)
    else if (entry.name.endsWith('.jsonl')) files.push(fullPath)
  }

  return files
}

function latestSessionFile(): string | null {
  return walk(sessionsRoot)
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? null
}

function sessionFileForTarget(target: SessionLogTarget): string | null {
  const source = stringValue(target.source)
  if (source) {
    const resolvedRoot = resolve(sessionsRoot)
    const resolvedSource = resolve(source)
    if ((resolvedSource === resolvedRoot || resolvedSource.startsWith(`${resolvedRoot}${sep}`)) && existsSync(resolvedSource)) {
      return resolvedSource
    }
  }

  const sessionId = stringValue(target.sessionId)
  if (!sessionId) return source ? null : latestSessionFile()

  return walk(sessionsRoot)
    .filter(file => sessionIdFromFile(file) === sessionId)
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? null
}

export function parseSessionLog(source: string): SessionLogSnapshot {
  const events = readFileSync(source, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => {
      try {
        return JSON.parse(line) as JsonlEvent
      } catch {
        return null
      }
    })
    .filter((event): event is JsonlEvent => Boolean(event))

  const meta = events.find(event => event.type === 'session_meta')?.payload ?? {}
  const messages: WorkflowMessageBlock[] = []
  const calls = new Map<string, ToolRecord>()
  let current: WorkflowMessageBlock | null = null
  let currentStartedAt: number | undefined
  let lastWebSearchCallId: string | null = null

  const ensureMessage = (): WorkflowMessageBlock => {
    if (!current) {
      current = {
        id: `message-${messages.length + 1}`,
        user: '',
        userContent: [],
        status: 'running',
        activity: 'thinking',
        startedAt: currentStartedAt,
        durationMs: null,
        items: [],
      }
      messages.push(current)
    }
    return current
  }

  const addItem = (item: WorkflowStreamItem): WorkflowStreamItem => {
    const message = ensureMessage()
    message.items.push(item)
    return item
  }

  for (const event of events) {
    const payload = event.payload ?? {}

    if (event.type === 'event_msg' && payload.type === 'task_started') {
      calls.clear()
      lastWebSearchCallId = null
      currentStartedAt = toMs(payload.started_at) ?? toMs(event.timestamp) ?? Date.now()
      current = null
      continue
    }

    if (event.type === 'event_msg' && payload.type === 'user_message') {
      const userContent = userContentFromPayload(payload)
      const user = cleanUserMessage(userContentText(userContent) || stringValue(payload.message))
      current = {
        id: stringValue(payload.turn_id) || `message-${messages.length + 1}`,
        user,
        userContent: userContent.length ? userContent : textUserContent(user),
        status: 'running',
        activity: 'thinking',
        startedAt: currentStartedAt ?? toMs(event.timestamp),
        durationMs: null,
        items: [],
      }
      messages.push(current)
      continue
    }

    if (event.type === 'response_item' && payload.type === 'message' && payload.role === 'user') {
      const userContent = userContentFromPayload(payload)
      const user = cleanUserMessage(userContentText(userContent) || messageContentText(payload.content))
      current = {
        id: stringValue(payload.id) || `message-${messages.length + 1}`,
        user,
        userContent: userContent.length ? userContent : textUserContent(user),
        status: 'running',
        activity: 'thinking',
        startedAt: currentStartedAt ?? toMs(event.timestamp),
        durationMs: null,
        items: [],
      }
      messages.push(current)
      continue
    }

    if (event.type === 'event_msg' && payload.type === 'agent_message') {
      const text = assistantVisibleText(payload.message)
      if (text) {
        ensureMessage().activity = 'responding'
        addAssistantItems(`assistant-${messages.length}-${ensureMessage().items.length}`, text, addItem)
      }
      continue
    }

    if (event.type === 'event_msg' && payload.type === 'agent_reasoning') {
      const text = reasoningVisibleText(payload.text)
      addItem({
        id: `agent-reasoning-${messages.length}-${ensureMessage().items.length}`,
        type: 'reasoning',
        summary: text,
        content: text ? [{ text }] : undefined,
        encrypted: !text,
      })
      continue
    }

    if (event.type === 'response_item' && payload.type === 'message' && payload.role === 'assistant') {
      const text = assistantVisibleText(messageContentText(payload.content))
      if (text) {
        ensureMessage().activity = 'responding'
        addAssistantItems(`assistant-message-${messages.length}-${ensureMessage().items.length}`, text, addItem)
      }
      continue
    }

    if (event.type === 'response_item' && payload.type === 'reasoning') {
      const text = reasoningText(payload)
      addItem({
        id: `reasoning-${messages.length}-${ensureMessage().items.length}`,
        type: 'reasoning',
        summary: text,
        content: text ? [{ text }] : undefined,
        encrypted: !text && Boolean(payload.encrypted_content),
      })
      continue
    }

    if (event.type === 'response_item' && payload.type === 'plan') {
      addItem({
        id: stringValue(payload.id) || `plan-${messages.length}-${ensureMessage().items.length}`,
        type: 'plan',
        text: stringValue(payload.text) || planText(compactOutput(payload)),
      })
      continue
    }

    if (event.type === 'response_item' && payload.type === 'mcp_tool_call') {
      const id = stringValue(payload.call_id) || stringValue(payload.id) || `mcp-tool-${calls.size + 1}`
      const server = stringValue(payload.server)
      const tool = stringValue(payload.tool) || stringValue(payload.name) || 'mcp_tool_call'
      const input = parseArgs(payload.arguments ?? payload.args ?? payload.input)
      calls.set(id, {
        id,
        name: tool,
        input,
        output: '',
        status: stringValue(payload.status) || 'running',
        server,
      })
      ensureMessage().activity = 'running'
      addItem({
        id,
        type: 'mcpToolCall',
        server,
        tool,
        arguments: payload.arguments ?? payload.args ?? input,
        status: stringValue(payload.status) || 'running',
      })
      continue
    }

    if (event.type === 'response_item' && payload.type === 'collab_agent_tool_call') {
      const id = stringValue(payload.call_id) || stringValue(payload.id) || `collab-agent-${calls.size + 1}`
      ensureMessage().activity = 'running'
      addItem({
        id,
        type: 'collabAgentToolCall',
        tool: stringValue(payload.tool) || stringValue(payload.name) || 'collab_agent',
        status: stringValue(payload.status) || 'running',
        senderThreadId: stringValue(payload.senderThreadId) || stringValue(payload.sender_thread_id) || undefined,
        receiverThreadIds: stringArray(payload.receiverThreadIds ?? payload.receiver_thread_ids),
        prompt: stringValue(payload.prompt) || stringValue(payload.input),
        model: stringValue(payload.model) || undefined,
        reasoningEffort: stringValue(payload.reasoningEffort) || stringValue(payload.reasoning_effort) || undefined,
      })
      continue
    }

    if (event.type === 'response_item' && payload.type === 'tool_search_call') {
      const id = stringValue(payload.call_id) || `tool-search-${calls.size + 1}`
      const input = parseArgs(payload.arguments)
      calls.set(id, {
        id,
        name: 'tool_search',
        input,
        output: '',
        status: stringValue(payload.status) || 'completed',
      })
      ensureMessage().activity = 'running'
      addItem({
        id,
        type: 'dynamicToolCall',
        tool: 'tool_search',
        arguments: input,
        status: stringValue(payload.status) || 'running',
      })
      continue
    }

    if (event.type === 'response_item' && payload.type === 'tool_search_output') {
      const id = stringValue(payload.call_id)
      const output = toolSearchOutput(payload)
      const tool = calls.get(id)
      if (tool) tool.output = output
      updateToolOutput(ensureMessage(), id, output)
      ensureMessage().activity = 'thinking'
      continue
    }

    if ((event.type === 'event_msg' || event.type === 'response_item') && payload.type === 'web_search_call') {
      const payloadCallId = stringValue(payload.call_id) || stringValue(payload.id)
      const id: string = payloadCallId || lastWebSearchCallId || `web-search-${calls.size + 1}`
      const input = webSearchInput(payload)
      lastWebSearchCallId = id
      calls.set(id, {
        id,
        name: 'web_search',
        input,
        output: '',
        status: stringValue(payload.status) || 'running',
      })
      ensureMessage().activity = 'running'
      upsertWebSearchItem(ensureMessage(), id, input, stringValue(payload.status) || 'running')
      continue
    }

    if (event.type === 'event_msg' && payload.type === 'web_search_end') {
      const payloadCallId = stringValue(payload.call_id)
      const id: string = calls.has(payloadCallId) ? payloadCallId : lastWebSearchCallId || payloadCallId || `web-search-${calls.size + 1}`
      const output = webSearchOutput(payload)
      lastWebSearchCallId = id
      const tool = calls.get(id)
      if (tool) tool.output = output
      else {
        calls.set(id, {
          id,
          name: 'web_search',
          input: webSearchInput(payload),
          output,
          status: 'completed',
        })
      }
      upsertWebSearchItem(ensureMessage(), id, webSearchInput(payload), 'completed', output)
      ensureMessage().activity = 'thinking'
      continue
    }

    if ((event.type === 'event_msg' || event.type === 'response_item') && payload.type === 'image_generation_call') {
      const id = stringValue(payload.id) || stringValue(payload.call_id) || `image-generation-${calls.size + 1}`
      const input = imageGenerationInput(payload)
      const output = imageGenerationOutput(payload)
      const status = stringValue(payload.status) === 'completed' || Boolean(stringValue(payload.result)) ? 'completed' : 'running'
      calls.set(id, {
        id,
        name: 'image_generation',
        input,
        output,
        status,
      })
      ensureMessage().activity = 'running'
      upsertImageGenerationItem(ensureMessage(), id, input, status, output, imageGenerationResult(payload), imageGenerationSavedPath(payload))
      continue
    }

    if (event.type === 'event_msg' && payload.type === 'image_generation_end') {
      const id = stringValue(payload.id) || stringValue(payload.call_id) || `image-generation-${calls.size + 1}`
      const output = imageGenerationOutput(payload)
      const tool = calls.get(id)
      if (tool) {
        tool.output = output
        tool.status = 'completed'
      }
      upsertImageGenerationItem(ensureMessage(), id, imageGenerationInput(payload), 'completed', output, imageGenerationResult(payload), imageGenerationSavedPath(payload))
      ensureMessage().activity = 'thinking'
      continue
    }

    if (event.type === 'response_item' && payload.type === 'local_shell_call') {
      const id = stringValue(payload.call_id) || stringValue(payload.id) || `local-shell-${calls.size + 1}`
      const command = stringValue(payload.command) || parseArgs(payload.arguments ?? payload.input)
      const output = compactOutput(payload.output ?? payload.aggregated_output ?? payload.stdout ?? payload.stderr)
      addItem({
        id,
        type: 'commandExecution',
        command,
        shell: shellFromPayload(payload),
        cwd: stringValue(payload.cwd) || undefined,
        status: stringValue(payload.status) || 'completed',
        exitCode: numberValue(payload.exit_code) ?? numberValue(payload.exitCode) ?? null,
        output: textOutput(output),
      })
      ensureMessage().activity = 'running'
      continue
    }

    if (event.type === 'response_item' && (payload.type === 'function_call' || payload.type === 'custom_tool_call')) {
      const id = stringValue(payload.call_id) || `call-${calls.size + 1}`
      const name = stringValue(payload.name) || 'tool_call'
      const input = parseArgs(payload.arguments ?? payload.input)
      const tool: ToolRecord = {
        id,
        name,
        input,
        output: '',
        status: stringValue(payload.status) || 'completed',
      }
      calls.set(id, tool)
      ensureMessage().activity = 'running'

      if (name === 'apply_patch') {
        const patchText = patchInput(payload)
        const files = patchFiles(patchText)
        tool.files = files
        tool.patch = patchText
        addItem({
          id: `editing-${id}`,
          type: 'fileChange',
          status: 'running',
          changes: files.map(path => ({ path, kind: 'modified', diff: patchText ? { text: patchText } : undefined })),
        })
      }

      if (name !== 'apply_patch') {
        addItem(toolItemFromCall(id, name, input, tool.status, payload))
      }
      continue
    }

    if (event.type === 'response_item' && payload.type === 'image_view') {
      addItem({
        id: stringValue(payload.id) || `image-view-${messages.length}-${ensureMessage().items.length}`,
        type: 'imageView',
        path: stringValue(payload.path) || stringValue(payload.url),
      })
      continue
    }

    if (event.type === 'response_item' && (payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output')) {
      const id = stringValue(payload.call_id)
      const tool = calls.get(id)
      const output = compactOutput(payload.output)
      if (tool) tool.output = output
      if (tool?.name === 'apply_patch' && isFailureOutput(output)) {
        failFileItem(ensureMessage(), id, tool.files ?? patchFiles(tool.input), tool.patch ?? tool.input)
      }
      updateToolOutput(ensureMessage(), id, output)
      ensureMessage().activity = 'thinking'
      continue
    }

    if (event.type === 'event_msg' && payload.type === 'patch_apply_end') {
      const id = stringValue(payload.call_id)
      const output = compactOutput({
        success: payload.success,
        status: payload.status,
        changes: payload.changes,
        stdout: payload.stdout,
        stderr: payload.stderr,
      })
      const tool = calls.get(id)
      if (tool) tool.output = output
      updateToolOutput(ensureMessage(), id, output)
      ensureMessage().activity = 'thinking'

      const changes = Array.isArray(payload.changes) ? payload.changes : []
      const files = changes.length
        ? changes.map(change => {
            const record = asRecord(change)
            return stringValue(record?.path) || stringValue(record?.file)
          }).filter(Boolean)
        : tool?.files ?? patchFiles(tool?.input ?? '')

      completeFileItem(ensureMessage(), id, files, tool?.patch ?? tool?.input ?? '')
      continue
    }

    if (event.type === 'event_msg' && payload.type === 'mcp_tool_call_end') {
      const id = stringValue(payload.call_id)
      const tool = calls.get(id)
      const output = compactOutput(payload.result || payload.invocation || 'completed')
      if (tool && !tool.output) tool.output = output
      if (!tool && id) {
        const invocation = asRecord(payload.invocation)
        addItem({
          id,
          type: 'mcpToolCall',
          server: stringValue(invocation?.server),
          tool: stringValue(invocation?.tool) || stringValue(invocation?.name) || 'mcp_tool_call',
          arguments: invocation?.arguments ?? invocation?.args,
          output: textOutput(output),
          status: 'completed',
        })
      }
      updateToolOutput(ensureMessage(), id, output)
      updateToolStatus(ensureMessage(), id, 'completed')
      ensureMessage().activity = 'thinking'
      continue
    }

    if (event.type === 'event_msg' && payload.type === 'entered_review_mode') {
      addItem({
        id: `entered-review-mode-${toMs(event.timestamp) ?? messages.length}`,
        type: 'enteredReviewMode',
        review: payload.review ?? payload,
      })
      continue
    }

    if (event.type === 'event_msg' && payload.type === 'exited_review_mode') {
      addItem({
        id: `exited-review-mode-${toMs(event.timestamp) ?? messages.length}`,
        type: 'exitedReviewMode',
        review: payload.review ?? payload,
      })
      continue
    }

    if (event.type === 'event_msg' && payload.type === 'hook_prompt') {
      const fragments = payload.fragments
      addItem({
        id: `hook-prompt-${toMs(event.timestamp) ?? messages.length}`,
        type: 'hookPrompt',
        fragmentCount: Array.isArray(fragments) ? fragments.length : numberValue(payload.fragment_count) ?? 0,
        fragments,
      })
      continue
    }

    if (event.type === 'event_msg' && payload.type === 'item_completed') {
      const item = asRecord(payload.item)
      if (stringValue(item?.type).toLowerCase() === 'plan') {
        addItem({
          id: stringValue(item?.id) || `plan-snapshot-${messages.length}-${ensureMessage().items.length}`,
          type: 'plan',
          text: stringValue(item?.text),
        })
      }
      continue
    }

    if (event.type === 'event_msg' && payload.type === 'thread_rolled_back') {
      addItem({
        id: `thread-rolled-back-${toMs(event.timestamp) ?? messages.length}`,
        type: 'dynamicToolCall',
        tool: 'thread_rolled_back',
        arguments: {},
        output: textOutput(compactOutput({ num_turns: numberValue(payload.num_turns) ?? 1 })),
        status: 'completed',
      })
      continue
    }

    if (payload.type === 'token_count') {
      if (!current) continue
      upsertUsageItem(current, tokenCountOutput(payload))
      continue
    }

    if (event.type === 'event_msg' && payload.type === 'context_compacted') {
      addItem({
        id: `context-compacted-${toMs(event.timestamp) ?? messages.length}`,
        type: 'contextCompaction',
      })
      ensureMessage().activity = 'thinking'
      continue
    }

    if (event.type === 'event_msg' && payload.type === 'turn_aborted') {
      const message = ensureMessage()
      const completedAt = toMs(payload.completed_at) ?? unixSecondsToMs(payload.completed_at) ?? toMs(event.timestamp) ?? Date.now()
      message.status = 'failed'
      message.activity = 'failed'
      message.completedAt = completedAt
      message.durationMs = numberValue(payload.duration_ms) ?? (
        message.startedAt ? Math.max(0, completedAt - message.startedAt) : null
      )
      addItem({
        id: `turn-aborted-${stringValue(payload.turn_id) || messages.length}`,
        type: 'dynamicToolCall',
        tool: 'turn_aborted',
        arguments: {},
        output: textOutput(compactOutput({
          reason: payload.reason || 'interrupted',
          completed_at: payload.completed_at,
          duration_ms: payload.duration_ms,
        })),
        status: 'error',
      })
      continue
    }

    if (event.type === 'event_msg' && (payload.type === 'task_failed' || payload.type === 'error')) {
      const message = ensureMessage()
      message.status = 'failed'
      message.activity = 'failed'
      message.completedAt = toMs(payload.completed_at) ?? unixSecondsToMs(payload.completed_at) ?? toMs(event.timestamp) ?? Date.now()
      message.durationMs = message.startedAt && message.completedAt ? Math.max(0, message.completedAt - message.startedAt) : null
      addItem({
        id: `error-${messages.length}-${message.items.length}`,
        type: 'dynamicToolCall',
        tool: 'error',
        arguments: {},
        output: textOutput(compactOutput(payload.message ?? payload.error ?? payload)),
        status: 'error',
      })
      continue
    }

    if (event.type === 'event_msg' && payload.type === 'task_complete') {
      const message = ensureMessage()
      const durationMs = numberValue(payload.duration_ms)
      message.status = 'completed'
      message.activity = 'done'
      message.completedAt = toMs(payload.completed_at) ?? unixSecondsToMs(payload.completed_at) ?? toMs(event.timestamp) ?? Date.now()
      message.durationMs = durationMs ?? (
        message.startedAt && message.completedAt ? Math.max(0, message.completedAt - message.startedAt) : null
      )

      const lastMessage = assistantVisibleText(payload.last_agent_message)
      if (lastMessage && !message.items.some(item => item.type === 'agentMessage' && item.text === lastMessage)) {
        addAssistantItems(`assistant-final-${messages.length}`, lastMessage, addItem)
      }
    }
  }

  const normalizedMessages = compactSessionMessages(
    messages
      .filter(message => message.user || message.items.length)
      .map(message => ({ ...message, items: compactItems(message.items) }))
  )
  const sessionId = stringValue(meta.id) || sessionIdFromFile(source)
  const cwd = stringValue(meta.cwd)

  return {
    source,
    generatedAt: new Date().toISOString(),
    sessionId,
    cwd,
    messages: normalizedMessages,
    readThread: sessionMessagesToReadThread(normalizedMessages, {
      threadId: sessionId,
      cwd,
      title: sessionId,
      limit: normalizedMessages.length,
      hasMore: false,
    }),
  }
}

function sessionMessagesToReadThread(
  messages: WorkflowMessageBlock[],
  options: {
    threadId: string
    title: string
    cwd: string
    limit: number
    hasMore: boolean
  }
): WorkflowReadThreadResponse {
  const chronologicalTurns = messages.map(message => {
    const items: ReadThreadTurnItem[] = message.items.map(workflowItemToReadThreadItem)
    if (message.userContent.length && !items.some(item => item.type === 'userMessage')) {
      items.unshift({
        type: 'userMessage',
        id: `${message.id}:user`,
        content: message.userContent,
      })
    }

    return {
      id: message.id,
      status: message.status,
      error: null,
      startedAt: message.startedAt ?? null,
      completedAt: message.completedAt ?? null,
      durationMs: message.durationMs,
      items,
    }
  })
  const turns = [...chronologicalTurns].reverse()
  const firstTurn = chronologicalTurns[0]
  const latestTurn = chronologicalTurns[chronologicalTurns.length - 1]
  const preview = readThreadPreview(latestTurn) ?? readThreadPreview(firstTurn) ?? ''
  const hasRunningTurn = chronologicalTurns.some(turn => turn.status === 'running')

  return {
    schemaVersion: 1,
    thread: {
      id: options.threadId,
      title: options.title || preview || 'Codex Thread',
      preview,
      status: hasRunningTurn ? { type: 'active', activeFlags: {} } : { type: 'idle' },
      cwd: options.cwd || null,
      createdAt: firstTurn?.startedAt ?? null,
      updatedAt: latestTurn?.completedAt ?? latestTurn?.startedAt ?? null,
    },
    page: {
      order: 'newest_first',
      limit: options.limit,
      nextCursor: null,
      hasMore: options.hasMore,
    },
    turns,
  }
}

function workflowItemToReadThreadItem(item: WorkflowStreamItem): ReadThreadTurnItem {
  if (item.type === 'webSearch') {
    return {
      type: 'webSearch',
      id: item.id,
      query: item.query,
      action: item.action,
    }
  }

  if (item.type === 'hookPrompt') {
    return {
      type: 'hookPrompt',
      id: item.id,
      fragmentCount: item.fragmentCount,
    }
  }

  if (item.type === 'mcpToolCall') {
    return {
      type: 'mcpToolCall',
      id: item.id,
      server: item.server,
      tool: item.tool,
      arguments: item.arguments,
      status: item.status,
      durationMs: item.durationMs,
    }
  }

  if (item.type === 'dynamicToolCall') {
    return {
      type: 'dynamicToolCall',
      id: item.id,
      tool: item.tool,
      arguments: item.arguments,
      status: item.status,
      success: item.success,
      durationMs: item.durationMs,
    }
  }

  if (item.type === 'reasoning') {
    return {
      type: 'reasoning',
      id: item.id,
      summary: item.summary,
      content: item.content,
    }
  }

  return item
}

function readThreadPreview(turn: WorkflowReadThreadResponse['turns'][number] | undefined): string | undefined {
  if (!turn) return undefined
  for (let index = turn.items.length - 1; index >= 0; index -= 1) {
    const item = turn.items[index]
    if (item.type === 'agentMessage' && item.text.trim()) return item.text.trim().slice(0, 160)
    if (item.type === 'userMessage') {
      const text = item.content.find(entry => entry.type === 'text')?.text.trim()
      if (text) return text.slice(0, 160)
    }
  }
  return undefined
}

function addAssistantItems(
  id: string,
  text: string,
  addItem: (item: WorkflowStreamItem) => WorkflowStreamItem
): void {
  const blocks = assistantItems(id, text)
  for (const item of blocks) addItem(item)
}

function assistantItems(id: string, text: string): WorkflowStreamItem[] {
  const visible = assistantVisibleText(text)
  return visible ? [{ id, type: 'agentMessage', text: visible, phase: 'completed' }] : []
}

function textUserContent(text: string): WorkflowUserMessageContent[] {
  return text ? [{ type: 'text', text }] : []
}

function compactItems(items: WorkflowStreamItem[]): WorkflowStreamItem[] {
  const compacted: WorkflowStreamItem[] = []
  const seenText = new Set<string>()

  for (const item of items) {
    if (item.type === 'agentMessage') {
      const text = assistantVisibleText(item.text)
      if (!text) continue
      const normalized = normalizeForCompare(text)
      if (seenText.has(normalized)) continue
      seenText.add(normalized)
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
    compacted.push(item)
  }

  return compacted
}

function compactSessionMessages(messages: WorkflowMessageBlock[]): WorkflowMessageBlock[] {
  return messages.filter((message, index) => {
    if (!isUserOnlyMessage(message)) return true
    const next = messages[index + 1]
    if (!next) return true
    return normalizedUserText(message) !== normalizedUserText(next)
  })
}

function isUserOnlyMessage(message: WorkflowMessageBlock): boolean {
  return Boolean(normalizedUserText(message)) && message.items.length === 0
}

function normalizedUserText(message: WorkflowMessageBlock): string {
  return normalizeForCompare(userContentText(message.userContent) || message.user)
}

function patchInput(payload: Record<string, unknown>): string {
  const directInput = stringValue(payload.input)
  if (directInput) return directInput

  const args = payload.arguments
  if (typeof args === 'string') {
    try {
      const parsed = JSON.parse(args)
      return stringValue(asRecord(parsed)?.patch) || stringValue(asRecord(parsed)?.input) || args
    } catch {
      return args
    }
  }

  const record = asRecord(args)
  return stringValue(record?.patch) || stringValue(record?.input)
}

function reasoningText(payload: Record<string, unknown>): string {
  const summary = payload.summary
  if (Array.isArray(summary)) {
    return summary.map(part => {
      if (typeof part === 'string') return part
      const record = asRecord(part)
      return stringValue(record?.text) || stringValue(record?.summary)
    }).filter(Boolean).join('\n\n').trim()
  }
  return stringValue(summary).trim()
}

function reasoningVisibleText(value: unknown): string {
  return stripThinkTags(normalizeText(value))
}

function messageContentText(content: unknown): string {
  return extractTextContent(content)
}

function webSearchInput(payload: Record<string, unknown>): string {
  const action = asRecord(payload.action)
  if (!action) return compactOutput(payload)
  return compactOutput({
    type: stringValue(action.type),
    query: stringValue(action.query),
    url: stringValue(action.url),
    queries: Array.isArray(action.queries) ? action.queries : undefined,
  })
}

function webSearchOutput(payload: Record<string, unknown>): string {
  const action = asRecord(payload.action)
  return compactOutput({
    query: stringValue(payload.query),
    type: stringValue(action?.type),
    url: stringValue(action?.url),
  })
}

function imageGenerationInput(payload: Record<string, unknown>): string {
  return compactOutput({
    prompt: stringValue(payload.revised_prompt) || stringValue(payload.prompt),
    status: stringValue(payload.status),
  })
}

function imageGenerationOutput(payload: Record<string, unknown>): string {
  const result = stringValue(payload.result)
  return compactOutput({
    status: stringValue(payload.status),
    has_result: Boolean(result),
    result_bytes: result ? Math.round(result.length * 0.75) : undefined,
  })
}

function imageGenerationResult(payload: Record<string, unknown>): string {
  return stringValue(payload.result)
    || stringValue(payload.image)
    || stringValue(payload.base64)
    || stringValue(payload.b64_json)
}

function imageGenerationSavedPath(payload: Record<string, unknown>): string | null {
  return stringValue(payload.saved_path)
    || stringValue(payload.savedPath)
    || stringValue(payload.path)
    || stringValue(payload.file)
    || null
}

function toolSearchOutput(payload: Record<string, unknown>): string {
  const tools = Array.isArray(payload.tools) ? payload.tools : []
  if (!tools.length) return compactOutput(payload)

  const names = tools.flatMap(tool => {
    const record = asRecord(tool)
    if (!record) return []
    const namespace = stringValue(record.name)
    const nestedTools = Array.isArray(record.tools) ? record.tools : []
    if (!nestedTools.length) return namespace ? [namespace] : []
    return nestedTools.map(entry => {
      const nested = asRecord(entry)
      const name = stringValue(nested?.name)
      return namespace && name ? `${namespace}.${name}` : name || namespace
    }).filter(Boolean)
  })

  return names.length ? `Found ${names.length} tools:\n${names.join('\n')}` : compactOutput(payload)
}

function toolItemFromCall(id: string, name: string, input: string, status: string, payload: Record<string, unknown>): WorkflowStreamItem {
  const output = textOutput('')
  if (isShellCommandName(name)) {
    return {
      type: 'commandExecution',
      id,
      command: input,
      shell: shellFromPayload(payload),
      status,
      output,
    }
  }

  if (name === 'update_plan') {
    return {
      type: 'plan',
      id,
      text: planText(input),
    }
  }

  if (name === 'view_image') {
    const args = asRecord(payload.arguments) ?? parseJsonRecord(payload.arguments)
    return {
      type: 'imageView',
      id,
      path: stringValue(args?.path) || stringValue(args?.image_path) || stringValue(args?.url) || input,
    }
  }

  if (name === 'js' || name.includes('browser')) {
    return {
      type: 'webSearch',
      id,
      action: input,
      status,
      output,
    }
  }

  if (name === 'image_generation') {
    return {
      type: 'imageGeneration',
      id,
      status,
      revisedPrompt: input,
    }
  }

  return {
    type: 'dynamicToolCall',
    id,
    tool: name || 'tool_call',
    arguments: payload.arguments ?? payload.input ?? input,
    status,
    output,
  }
}

function isShellCommandName(name: string): boolean {
  const normalized = name.toLowerCase()
  return normalized === 'shell_command'
    || normalized.includes('shell')
    || normalized.includes('command')
}

function shellFromPayload(payload: Record<string, unknown>): string | undefined {
  const args = asRecord(payload.arguments) ?? parseJsonRecord(payload.arguments)
    ?? asRecord(payload.input) ?? parseJsonRecord(payload.input)
  return stringValue(payload.shell)
    || stringValue(payload.shellName)
    || stringValue(payload.shell_name)
    || stringValue(payload.shellType)
    || stringValue(payload.shell_type)
    || stringValue(payload.executor)
    || stringValue(args?.shell)
    || stringValue(args?.shellName)
    || stringValue(args?.shell_name)
    || stringValue(args?.shellType)
    || stringValue(args?.shell_type)
    || undefined
}

function textOutput(text: string): TextOutput | undefined {
  return text ? { text } : undefined
}

function userContentFromPayload(payload: Record<string, unknown>): WorkflowUserMessageContent[] {
  const content = payload.content
  const message = payload.message
  const parts: WorkflowUserMessageContent[] = []

  if (typeof message === 'string' && message.trim()) {
    parts.push({ type: 'text', text: cleanUserMessage(message) })
  }

  if (typeof content === 'string' && content.trim()) {
    parts.push({ type: 'text', text: cleanUserMessage(content) })
  }

  if (Array.isArray(content)) {
    for (const part of content) {
      const item = userContentPart(part)
      if (item) parts.push(item)
    }
  }

  for (const image of arrayRecords(payload.images)) {
    const url = stringValue(image.url)
    const path = stringValue(image.path) || stringValue(image.file) || stringValue(image.local_path)
    if (path) parts.push({ type: 'localImage', path })
    else if (url) parts.push({ type: 'image', url })
  }

  return dedupeUserContent(parts)
}

function userContentPart(value: unknown): WorkflowUserMessageContent | null {
  if (typeof value === 'string') return value.trim() ? { type: 'text', text: cleanUserMessage(value) } : null

  const record = asRecord(value)
  if (!record) return null

  const type = stringValue(record.type)
  const text = stringValue(record.text) || stringValue(record.content)
  if ((type === 'text' || type === 'input_text' || !type) && text.trim()) return { type: 'text', text: cleanUserMessage(text) }

  const imageUrl = stringValue(record.image_url) || stringValue(asRecord(record.image_url)?.url) || stringValue(record.url)
  if (type === 'image' || type === 'input_image' || imageUrl) {
    const path = stringValue(record.path) || stringValue(record.local_path) || stringValue(record.file)
    if (path) return { type: 'localImage', path }
    if (imageUrl) return { type: 'image', url: imageUrl }
  }

  if (type === 'localImage') {
    const path = stringValue(record.path) || stringValue(record.local_path) || stringValue(record.file)
    return path ? { type: 'localImage', path } : null
  }

  if (type === 'skill') {
    const name = stringValue(record.name) || stringValue(record.title)
    return name ? { type: 'skill', name, path: stringValue(record.path) || undefined } : null
  }

  if (type === 'mention') {
    const name = stringValue(record.name) || stringValue(record.title)
    return name ? { type: 'mention', name, path: stringValue(record.path) || undefined } : null
  }

  return text.trim() ? { type: 'text', text: cleanUserMessage(text) } : null
}

function userContentText(content: WorkflowUserMessageContent[]): string {
  return content
    .filter((item): item is Extract<WorkflowUserMessageContent, { type: 'text' }> => item.type === 'text')
    .map(item => item.text)
    .filter(Boolean)
    .join('\n\n')
}

function dedupeUserContent(content: WorkflowUserMessageContent[]): WorkflowUserMessageContent[] {
  const seen = new Set<string>()
  return content.filter(item => {
    const key = JSON.stringify(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function arrayRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item)) : []
}

function parseJsonRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'string') return asRecord(value)
  try {
    return asRecord(JSON.parse(value))
  } catch {
    return undefined
  }
}

function isOutputItem(item: WorkflowStreamItem): item is Extract<WorkflowStreamItem, { output?: TextOutput }> {
  return item.type === 'commandExecution'
    || item.type === 'mcpToolCall'
    || item.type === 'dynamicToolCall'
    || item.type === 'webSearch'
}

function patchFiles(patch: string): string[] {
  const files = new Set<string>()
  const pattern = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm
  let match: RegExpExecArray | null
  while ((match = pattern.exec(patch)) !== null) {
    const file = match[1]?.trim()
    if (file) files.add(file)
  }
  return Array.from(files)
}

function completeFileItem(message: WorkflowMessageBlock, callId: string, files: string[], patch = ''): void {
  const editingId = callId ? `editing-${callId}` : ''
  const existing = message.items.find(item => item.type === 'fileChange' && item.id === editingId)
  if (existing?.type === 'fileChange') {
    existing.status = 'completed'
    existing.changes = (files.length ? files : existing.changes.map(change => change.path))
      .map(path => ({ path, kind: 'modified', diff: patch ? { text: patch } : existing.changes.find(change => change.path === path)?.diff }))
    return
  }

  if (files.length) {
    message.items.push({
      id: `patch-${callId || message.items.length}`,
      type: 'fileChange',
      status: 'completed',
      changes: files.map(path => ({ path, kind: 'modified', diff: patch ? { text: patch } : undefined })),
    })
  }
}

function failFileItem(message: WorkflowMessageBlock, callId: string, files: string[], patch = ''): void {
  const editingId = callId ? `editing-${callId}` : ''
  const existing = message.items.find(item => item.type === 'fileChange' && item.id === editingId)
  if (existing?.type === 'fileChange') {
    existing.status = 'failed'
    existing.changes = (files.length ? files : existing.changes.map(change => change.path))
      .map(path => ({ path, kind: 'modified', diff: patch ? { text: patch } : existing.changes.find(change => change.path === path)?.diff }))
  }
}

function upsertUsageItem(message: WorkflowMessageBlock, output: string): void {
  const id = `token-count-${message.id}`
  const existing = message.items.find(item => item.type === 'dynamicToolCall' && item.id === id)
  if (existing?.type === 'dynamicToolCall') {
    existing.output = textOutput(output)
    return
  }

  message.items.push({
    id,
    type: 'dynamicToolCall',
    tool: 'token_count',
    arguments: {},
    output: textOutput(output),
    status: 'completed',
  })
}

function tokenCountOutput(payload: Record<string, unknown>): string {
  const info = asRecord(payload.info)
  const total = asRecord(info?.total_token_usage)
  const last = asRecord(info?.last_token_usage)
  const rateLimits = asRecord(payload.rate_limits)
  const primary = asRecord(rateLimits?.primary)
  const secondary = asRecord(rateLimits?.secondary)

  return compactOutput({
    total_tokens: numberValue(total?.total_tokens),
    input_tokens: numberValue(total?.input_tokens),
    cached_input_tokens: numberValue(total?.cached_input_tokens),
    output_tokens: numberValue(total?.output_tokens),
    reasoning_output_tokens: numberValue(total?.reasoning_output_tokens),
    last_total_tokens: numberValue(last?.total_tokens),
    context_window: numberValue(info?.model_context_window),
    rate_limit_primary_percent: numberValue(primary?.used_percent),
    rate_limit_secondary_percent: numberValue(secondary?.used_percent),
    plan_type: stringValue(rateLimits?.plan_type),
  })
}

function isFailureOutput(output: string): boolean {
  return /failed|error|cannot|could not|verification failed/i.test(output)
}

function updateToolOutput(message: WorkflowMessageBlock, id: string, output: string): void {
  const item = message.items.find(entry => isOutputItem(entry) && entry.id === id)
  if (item && isOutputItem(item) && !item.output) item.output = textOutput(output)
}

function updateToolStatus(
  message: WorkflowMessageBlock,
  id: string,
  status: string,
): void {
  const item = message.items.find(entry => 'status' in entry && entry.id === id)
  if (item && 'status' in item) item.status = status
}

function upsertWebSearchItem(
  message: WorkflowMessageBlock,
  id: string,
  input: string,
  status: string,
  output = '',
): void {
  const existing = message.items.find(item => item.type === 'webSearch' && item.id === id)
  if (existing?.type === 'webSearch') {
    if (input) existing.action = input
    if (status) existing.status = status
    if (output) existing.output = textOutput(output)
    return
  }

  message.items.push({
    id,
    type: 'webSearch',
    query: '',
    action: input,
    status,
    output: textOutput(output),
  })
}

function upsertImageGenerationItem(
  message: WorkflowMessageBlock,
  id: string,
  input: string,
  status: string,
  _output = '',
  result = '',
  savedPath: string | null = null,
): void {
  const existing = message.items.find(item => item.type === 'imageGeneration' && item.id === id)
  if (existing?.type === 'imageGeneration') {
    if (input) existing.revisedPrompt = input
    if (status) existing.status = status
    if (result) existing.result = result
    if (savedPath) existing.savedPath = savedPath
    return
  }

  message.items.push({
    id,
    type: 'imageGeneration',
    revisedPrompt: input,
    result,
    savedPath,
    status,
  })
}

function parseArgs(args: unknown): string {
  if (!args) return ''

  try {
    const object = typeof args === 'string' ? JSON.parse(args) : args
    const record = asRecord(object)
    if (record?.command) return stringValue(record.command)
    if (record?.title || record?.code) return [record.title, record.code].filter(Boolean).join('\n')
    return JSON.stringify(object, null, 2)
  } catch {
    return String(args)
  }
}

function planText(input: string): string {
  if (!input.trim()) return ''
  try {
    const parsed = JSON.parse(input)
    const record = asRecord(parsed)
    const plan = record?.plan
    if (!Array.isArray(plan)) return input
    return plan.map((entry, index) => {
      const item = asRecord(entry)
      const step = stringValue(item?.step)
      const status = stringValue(item?.status)
      return step ? `${index + 1}. [${status || 'pending'}] ${step}` : ''
    }).filter(Boolean).join('\n')
  } catch {
    return input
  }
}

function cleanUserMessage(message = ''): string {
  const marker = '## My request for Codex:'
  const index = message.indexOf(marker)
  return (index >= 0 ? message.slice(index + marker.length) : message).trim()
}

function compactOutput(output: unknown): string {
  return normalizeText(output).replace(/\r/g, '')
}

function normalizeText(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return stripAnsi(value).trim()
  const text = extractTextContent(value)
  if (text) return stripAnsi(text).trim()
  return stripAnsi(JSON.stringify(value, null, 2)).trim()
}

function assistantVisibleText(value: unknown): string {
  return dedupeRepeatedParagraphs(stripThinkTags(normalizeText(value)))
}

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return String(text ?? '').replace(/\u001b\[[0-9;]*m/g, '')
}

function stripThinkTags(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<think>[\s\S]*$/g, '')
    .replace(/<\/think>/g, '')
    .replace(/<think>/g, '')
    .trim()
}

function dedupeRepeatedParagraphs(text: string): string {
  const seen = new Set<string>()
  const parts = text.replace(/\r/g, '').split(/\n{2,}/)
  const next: string[] = []

  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const key = normalizeForCompare(trimmed)
    if (seen.has(key)) continue
    seen.add(key)
    next.push(trimmed)
  }

  return next.join('\n\n')
}

function extractTextContent(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value.map(extractTextContent).filter(Boolean).join('\n\n')
  }

  const record = asRecord(value)
  if (!record) return ''

  const directText = stringValue(record.text)
    || stringValue(record.content)
    || stringValue(record.output_text)
    || stringValue(record.input_text)
    || stringValue(record.message)
  if (directText) return directText

  for (const key of ['content', 'output', 'message', 'result', 'parts']) {
    const nested = extractTextContent(record[key])
    if (nested) return nested
  }

  return ''
}

function normalizeForCompare(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const values = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
  return values.length ? values : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function toMs(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? undefined : parsed
}

function unixSecondsToMs(value: unknown): number | undefined {
  if (typeof value !== 'number') return undefined
  const ms = value < 100000000000 ? value * 1000 : value
  return Number.isFinite(ms) ? ms : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined
}

function sessionIdFromFile(source: string): string {
  const match = basename(source).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)
  return match?.[1] ?? ''
}
