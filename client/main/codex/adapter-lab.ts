import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join, basename } from 'path'
import { homedir } from 'os'
import { store } from '../store'
import { normalizeCodexRawEvents, type NormalizedThreadItem } from './normalize'

export interface AdapterLabReport {
  generatedAt: string
  sessions: AdapterLabSession[]
  referenceCases: AdapterLabReferenceCase[]
  unknownRawTypes: Record<string, number>
  unknownJsonlTypes: Record<string, number>
}

export interface AdapterLabReferenceCase {
  id: string
  title: string
  description: string
  status: 'covered' | 'missing'
  reference: AdapterLabReferenceMatch | null
  codexWebMatches: AdapterLabReferenceMatch[]
}

export interface AdapterLabReferenceMatch {
  source: 'desktop' | 'cli' | 'codex-web' | 'unknown'
  file?: string
  sessionId: string
  turnId: string
  user: string
  preview: string
  score: number
  features: string[]
}

export interface AdapterLabSession {
  sessionId: string
  runtimeThreadId?: string
  title: string
  updatedAt: number
  rawTurns: AdapterLabRawTurn[]
  matchedLog: AdapterLabLogFile | null
  coverage: {
    rawTurns: number
    completedRawTurns: number
    matchedLogTurns: number
    rawToolCount: number
    logToolCount: number
    missingToolCount: number
    mismatchedTurns: number
    parity: 'pass' | 'fail'
  }
}

export interface AdapterLabRawTurn {
  messageIndex: number
  user: string
  status: string
  threadId: string
  turnId: string
  rawEventCount: number
  methods: Record<string, number>
  toolCount: number
  toolNames: string[]
  files: string[]
  hasCompleted: boolean
  text: string
  preview: string
  parity?: AdapterLabTurnParity
}

export interface AdapterLabTurnParity {
  matches: boolean
  failedChecks: string[]
  checks: {
    matchedLog: boolean
    status: boolean
    text: boolean
    toolCount: boolean
    toolNames: boolean
    files: boolean
  }
  status: {
    raw: string
    log: string | null
  }
  text: {
    rawLength: number
    logLength: number
    rawPreview: string
    logPreview: string
  }
  tools: {
    rawCount: number
    logCount: number
    rawNames: string[]
    logNames: string[]
  }
  files: {
    raw: string[]
    log: string[]
  }
}

export interface AdapterLabLogFile {
  path: string
  basename: string
  sessionId: string
  turns: AdapterLabLogTurn[]
}

export interface AdapterLabLogTurn {
  turnId: string
  user: string
  status: string
  toolCount: number
  toolNames: string[]
  files: string[]
  itemCounts: Record<string, number>
  text: string
  preview: string
  features: string[]
}

interface JsonlEvent {
  timestamp?: string
  type: string
  payload?: Record<string, unknown>
}

const sessionsRoot = join(homedir(), '.codex', 'sessions')
const knownRawItemTypes = new Set([
  'assistantMessage',
  'agentMessage',
  'reasoning',
  'reasoningItem',
  'summary',
  'userMessage',
  'toolCall',
  'functionCall',
  'customToolCall',
  'custom_tool_call',
  'mcpToolCall',
  'mcp_tool_call',
  'commandExecution',
  'command_execution',
  'command',
  'localShellCall',
  'local_shell_call',
  'fileChange',
  'file_change',
  'fileChangeSet',
  'patchChange',
  'patch_change',
  'todoList',
  'todo_list',
  'todo',
  'plan',
  'webSearch',
  'web_search',
  'error',
])
const knownJsonlKeys = new Set([
  'session_meta:',
  'turn_context:',
  'compacted:',
  'event_msg:task_started',
  'event_msg:user_message',
  'event_msg:agent_message',
  'event_msg:token_count',
  'event_msg:task_complete',
  'event_msg:patch_apply_end',
  'event_msg:mcp_tool_call_end',
  'event_msg:context_compacted',
  'response_item:message',
  'response_item:reasoning',
  'response_item:function_call',
  'response_item:function_call_output',
  'response_item:custom_tool_call',
  'response_item:custom_tool_call_output',
])

const referenceCases: Array<{
  id: string
  title: string
  description: string
  requiredFeatures: string[]
  optionalFeatures?: string[]
}> = [
  {
    id: 'basic_qa',
    title: '普通问答',
    description: '没有工具调用，只包含最终助手回答。',
    requiredFeatures: ['final_answer'],
  },
  {
    id: 'shell_success',
    title: 'Shell 成功',
    description: '执行一条 shell 命令，并成功返回输出。',
    requiredFeatures: ['tool_call', 'tool_output'],
    optionalFeatures: ['shell_command'],
  },
  {
    id: 'multi_tool',
    title: '多工具连续调用',
    description: '同一轮对话中包含多个工具调用。',
    requiredFeatures: ['multi_tool'],
  },
  {
    id: 'reasoning',
    title: 'Reasoning 块',
    description: '日志中包含 response_item:reasoning 记录。',
    requiredFeatures: ['reasoning'],
  },
  {
    id: 'file_patch',
    title: '文件修改',
    description: 'apply_patch 或 patch_apply_end 能生成文件变更 UI 项。',
    requiredFeatures: ['file_patch'],
  },
  {
    id: 'custom_tool',
    title: '自定义工具',
    description: '包含 custom_tool_call / custom_tool_call_output。',
    requiredFeatures: ['custom_tool'],
  },
  {
    id: 'mcp_tool',
    title: 'MCP 工具',
    description: '包含 mcp_tool_call_end 或浏览器类工具输出。',
    requiredFeatures: ['mcp_tool'],
  },
  {
    id: 'failure_or_interrupt',
    title: '失败或中断',
    description: '对话轮次失败、被中断，或命令输出中报告失败。',
    requiredFeatures: ['failure'],
  },
]

export function readAdapterLabReport(limit = 12): AdapterLabReport {
  const rawSessions = store.getSessions()
    .filter(session => session.messages.some(message => message.rawEvents?.length))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit)

  const jsonlFiles = findJsonlFiles(sessionsRoot)
    .sort((a, b) => statSafe(b) - statSafe(a))
    .slice(0, 80)

  const unknownRawTypes: Record<string, number> = {}
  const unknownJsonlTypes: Record<string, number> = {}
  const referenceCandidates = collectReferenceCandidates(jsonlFiles)

  const sessions = rawSessions.map(session => {
    const rawTurns = reduceRawTurns(session)
    for (const turn of rawTurns) {
      for (const [method, count] of Object.entries(turn.methods)) {
        if (!knownRawMethod(method)) unknownRawTypes[method] = (unknownRawTypes[method] ?? 0) + count
      }
    }

    const legacyThreadId = (session as typeof session & Record<string, unknown>)['co' + 'dexThreadId']
    const runtimeThreadId = session.runtimeThreadId ?? (typeof legacyThreadId === 'string' ? legacyThreadId : undefined)
    const matchedLog = findMatchingLog(jsonlFiles, rawTurns, runtimeThreadId)
    if (matchedLog) {
      for (const turn of matchedLog.turns) {
        for (const [key, count] of Object.entries(turn.itemCounts)) {
          if (!knownJsonlKeys.has(key)) unknownJsonlTypes[key] = (unknownJsonlTypes[key] ?? 0) + count
        }
      }
    }

    const matchedTurnIds = new Set(matchedLog?.turns.map(turn => turn.turnId).filter(Boolean) ?? [])
    const rawToolCount = sum(rawTurns.map(turn => turn.toolCount))
    const logToolCount = sum(matchedLog?.turns.map(turn => turn.toolCount) ?? [])
    const logTurnsById = new Map((matchedLog?.turns ?? []).map(turn => [turn.turnId, turn]))
    const rawTurnsWithParity = rawTurns.map(turn => ({
      ...turn,
      parity: compareTurnParity(turn, logTurnsById.get(turn.turnId)),
    }))
    const mismatchedTurns = rawTurnsWithParity.filter(turn => !turn.parity.matches).length
    const parity: AdapterLabSession['coverage']['parity'] =
      mismatchedTurns === 0 && rawTurns.length > 0 ? 'pass' : 'fail'

    return {
      sessionId: session.id,
      runtimeThreadId,
      title: session.title,
      updatedAt: session.updatedAt,
      rawTurns: rawTurnsWithParity,
      matchedLog,
      coverage: {
        rawTurns: rawTurns.length,
        completedRawTurns: rawTurns.filter(turn => turn.hasCompleted || turn.status === 'completed').length,
        matchedLogTurns: rawTurns.filter(turn => matchedTurnIds.has(turn.turnId)).length,
        rawToolCount,
        logToolCount,
        missingToolCount: Math.max(0, logToolCount - rawToolCount),
        mismatchedTurns,
        parity,
      },
    }
  })

  return {
    generatedAt: new Date().toISOString(),
    sessions,
    referenceCases: buildReferenceCases(referenceCandidates, sessions),
    unknownRawTypes,
    unknownJsonlTypes,
  }
}

function reduceRawTurns(session: ReturnType<typeof store.getSessions>[number]): AdapterLabRawTurn[] {
  const turns: AdapterLabRawTurn[] = []

  session.messages.forEach((message, index) => {
    if (message.role !== 'assistant' || !message.rawEvents?.length) return

    const normalizedTurn = normalizeCodexRawEvents(message.rawEvents)
    const methods: Record<string, number> = { ...normalizedTurn.methodCounts }

    for (const event of message.rawEvents) {
      const params = asRecord(event.params)
      if (event.method !== 'item/started' && event.method !== 'item/updated' && event.method !== 'item/completed') continue
      const item = asRecord(params?.item)
      if (!item) continue
      const rawType = stringValue(item.type)
      if (rawType && !knownRawItemTypes.has(rawType)) methods[`item:${rawType}`] = (methods[`item:${rawType}`] ?? 0) + 1
    }

    const toolCount = normalizedTurn.items.filter(item =>
      item.type === 'command_execution' ||
      item.type === 'mcp_tool_call' ||
      item.type === 'web_search' ||
      item.type === 'file_change'
    ).length
    const text = stripThinkTags(normalizedTurn.finalText || (message.content ?? ''))

    turns.push({
      messageIndex: index,
      user: previousUser(session.messages, index),
      status: normalizedTurn.hasFailed ? 'failed' : message.status ?? 'unknown',
      threadId: normalizedTurn.threadId,
      turnId: normalizedTurn.turnId,
      rawEventCount: message.rawEvents.length,
      methods,
      toolCount,
      toolNames: unique(normalizedTurn.items.filter(isComparableToolItem).map(rawToolName)),
      files: unique(normalizedTurn.items.flatMap(rawItemFiles)),
      hasCompleted: normalizedTurn.hasCompleted,
      text,
      preview: preview(text),
    })
  })

  return turns
}

function findMatchingLog(files: string[], rawTurns: AdapterLabRawTurn[], runtimeThreadId?: string): AdapterLabLogFile | null {
  const threadIds = new Set([
    runtimeThreadId,
    ...rawTurns.map(turn => turn.threadId),
  ].filter(Boolean))
  const turnIds = new Set(rawTurns.map(turn => turn.turnId).filter(Boolean))
  let best: { path: string; score: number; sessionId: string; turns: AdapterLabLogTurn[] } | null = null

  for (const path of files) {
    const events = readJsonl(path)
    if (!events.length) continue
    const sessionId = stringValue(events.find(event => event.type === 'session_meta')?.payload?.id)
    const turns = reduceLogTurns(events)
    const score =
      (sessionId && threadIds.has(sessionId) ? 20 : 0) +
      turns.filter(turn => turnIds.has(turn.turnId)).length * 10

    if (score > 0 && (!best || score > best.score)) {
      best = { path, score, sessionId, turns }
    }
  }

  if (!best) return null
  return {
    path: best.path,
    basename: basename(best.path),
    sessionId: best.sessionId,
    turns: best.turns,
  }
}

function reduceLogTurns(events: JsonlEvent[]): AdapterLabLogTurn[] {
  const turns: AdapterLabLogTurn[] = []
  let current: AdapterLabLogTurn | null = null
  const calls = new Set<string>()

  for (const event of events) {
    const payload = event.payload ?? {}
    const key = `${event.type}:${stringValue(payload.type)}`

    if (event.type === 'event_msg' && payload.type === 'task_started') {
      current = {
        turnId: stringValue(payload.turn_id) || stringValue(payload.turnId),
        user: '',
        status: 'running',
        toolCount: 0,
        toolNames: [],
        files: [],
        itemCounts: { [key]: 1 },
        text: '',
        preview: '',
        features: [],
      }
      calls.clear()
      continue
    }

    if (!current) continue
    current.itemCounts[key] = (current.itemCounts[key] ?? 0) + 1

    if (event.type === 'event_msg' && payload.type === 'user_message') {
      current.user = cleanUserMessage(stringValue(payload.message))
      continue
    }

    if (event.type === 'event_msg' && payload.type === 'agent_message') {
      current.text = stripThinkTags(stringValue(payload.message))
      current.preview = preview(current.text)
      continue
    }

    if (event.type === 'response_item' && (payload.type === 'function_call' || payload.type === 'custom_tool_call')) {
      const callId = stringValue(payload.call_id) || stringValue(payload.id) || `${current.turnId}-${calls.size}`
      calls.add(callId)
      current.toolCount = calls.size
      const toolName = stringValue(payload.name) || stringValue(payload.type) || 'tool_call'
      if (!current.toolNames.includes(toolName)) current.toolNames.push(toolName)
      continue
    }

    if (event.type === 'event_msg' && payload.type === 'patch_apply_end') {
      const changes = Array.isArray(payload.changes) ? payload.changes : []
      current.files.push(...changes.map(change => {
        const record = asRecord(change)
        return stringValue(record?.path) || stringValue(record?.file)
      }).filter(Boolean))
      continue
    }

    if (event.type === 'event_msg' && payload.type === 'task_complete') {
      current.status = 'completed'
      current.turnId ||= stringValue(payload.turn_id) || stringValue(payload.turnId)
      current.text = stripThinkTags(stringValue(payload.last_agent_message) || current.text)
      current.preview = preview(current.text)
      current.files = unique(current.files)
      turns.push(current)
      current = null
    }
  }

  if (current) turns.push(current)
  return turns.map(turn => ({ ...turn, features: featuresForLogTurn(turn) }))
}

function collectReferenceCandidates(files: string[]): AdapterLabReferenceMatch[] {
  const matches: AdapterLabReferenceMatch[] = []

  for (const file of files) {
    const events = readJsonl(file)
    if (!events.length) continue
    const meta = events.find(event => event.type === 'session_meta')?.payload ?? {}
    const sessionId = stringValue(meta.id)
    const source = sourceFromMeta(meta)
    const turns = reduceLogTurns(events)

    for (const turn of turns) {
      matches.push({
        source,
        file,
        sessionId,
        turnId: turn.turnId,
        user: turn.user,
        preview: turn.preview,
        score: 0,
        features: turn.features,
      })
    }
  }

  return matches
}

function buildReferenceCases(
  candidates: AdapterLabReferenceMatch[],
  sessions: AdapterLabSession[]
): AdapterLabReferenceCase[] {
  const codexWebMatches = sessions.flatMap(session =>
    session.rawTurns.map(turn => ({
      source: 'codex-web' as const,
      sessionId: session.sessionId,
      turnId: turn.turnId,
      user: turn.user,
      preview: turn.preview,
      score: 0,
      features: featuresForRawTurn(turn),
    }))
  )

  return referenceCases.map(testCase => {
    const desktopCandidates = candidates
      .filter(match => match.source === 'desktop' && hasRequiredFeatures(match.features, testCase.requiredFeatures))
      .map(match => scoreReferenceMatch(match, testCase.requiredFeatures, testCase.optionalFeatures ?? []))
      .sort((a, b) => b.score - a.score)

    const fallbackCandidates = candidates
      .filter(match => match.source !== 'desktop' && hasRequiredFeatures(match.features, testCase.requiredFeatures))
      .map(match => scoreReferenceMatch(match, testCase.requiredFeatures, testCase.optionalFeatures ?? []))
      .sort((a, b) => b.score - a.score)

    const reference = desktopCandidates[0] ?? fallbackCandidates[0] ?? null
    const matchingCodexWeb = codexWebMatches
      .filter(match => hasRequiredFeatures(match.features, testCase.requiredFeatures))
      .map(match => scoreReferenceMatch(match, testCase.requiredFeatures, testCase.optionalFeatures ?? []))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)

    return {
      id: testCase.id,
      title: testCase.title,
      description: testCase.description,
      status: reference ? 'covered' : 'missing',
      reference,
      codexWebMatches: matchingCodexWeb,
    }
  })
}

function scoreReferenceMatch(
  match: AdapterLabReferenceMatch,
  required: string[],
  optional: string[]
): AdapterLabReferenceMatch {
  const requiredScore = required.filter(feature => match.features.includes(feature)).length * 10
  const optionalScore = optional.filter(feature => match.features.includes(feature)).length * 3
  const sourceScore = match.source === 'desktop' ? 5 : match.source === 'codex-web' ? 2 : 0
  return { ...match, score: requiredScore + optionalScore + sourceScore }
}

function hasRequiredFeatures(features: string[], required: string[]): boolean {
  return required.every(feature => features.includes(feature))
}

function compareTurnParity(rawTurn: AdapterLabRawTurn, logTurn: AdapterLabLogTurn | undefined): AdapterLabTurnParity {
  const rawText = normalizeForCompare(rawTurn.text)
  const logText = normalizeForCompare(logTurn?.text ?? '')
  const rawToolNames = [...rawTurn.toolNames].sort()
  const logToolNames = [...(logTurn?.toolNames ?? [])].sort()
  const rawFiles = [...rawTurn.files].sort()
  const logFiles = [...(logTurn?.files ?? [])].sort()
  const checks = {
    matchedLog: Boolean(logTurn),
    status: Boolean(logTurn && rawTurn.status === logTurn.status),
    text: Boolean(logTurn && rawText === logText),
    toolCount: Boolean(logTurn && rawTurn.toolCount === logTurn.toolCount),
    toolNames: Boolean(logTurn && sameList(rawToolNames, logToolNames)),
    files: Boolean(logTurn && sameList(rawFiles, logFiles)),
  }

  return {
    matches: Object.values(checks).every(Boolean),
    failedChecks: Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key),
    checks,
    status: {
      raw: rawTurn.status,
      log: logTurn?.status ?? null,
    },
    text: {
      rawLength: rawTurn.text.length,
      logLength: logTurn?.text.length ?? 0,
      rawPreview: preview(rawTurn.text),
      logPreview: preview(logTurn?.text ?? ''),
    },
    tools: {
      rawCount: rawTurn.toolCount,
      logCount: logTurn?.toolCount ?? 0,
      rawNames: rawToolNames,
      logNames: logToolNames,
    },
    files: {
      raw: rawFiles,
      log: logFiles,
    },
  }
}

function isComparableToolItem(item: NormalizedThreadItem): boolean {
  return (
    item.type === 'command_execution' ||
    item.type === 'mcp_tool_call' ||
    item.type === 'web_search' ||
    item.type === 'file_change'
  )
}

function rawToolName(item: NormalizedThreadItem): string {
  if (item.type === 'command_execution') return item.command || item.rawType || 'shell_command'
  if (item.type === 'file_change') return item.rawType || 'apply_patch'
  if (item.type === 'web_search') return 'web_search'
  return item.tool || item.server || item.rawType || 'tool_call'
}

function rawItemFiles(item: NormalizedThreadItem): string[] {
  if (item.type !== 'file_change') return []
  return item.changes?.map(change => change.path).filter(Boolean) ?? []
}

function featuresForRawTurn(turn: AdapterLabRawTurn): string[] {
  const features = new Set<string>()
  if (turn.preview) features.add('final_answer')
  if (turn.toolCount > 0) features.add('tool_call')
  if (turn.toolCount > 0) features.add('tool_output')
  if (turn.toolCount > 1) features.add('multi_tool')
  if (turn.hasCompleted || turn.status === 'completed') features.add('completed')
  if (turn.status === 'failed') features.add('failure')
  if (turn.methods['item/agentMessage/delta']) features.add('streaming_text')
  for (const method of Object.keys(turn.methods)) {
    if (method.includes('reasoning')) features.add('reasoning')
    if (method.includes('mcp')) features.add('mcp_tool')
    if (method.includes('customTool') || method.includes('custom_tool')) features.add('custom_tool')
    if (method.includes('localShell') || method.includes('commandExecution')) features.add('shell_command')
    if (method.includes('fileChange') || method.includes('patch')) features.add('file_patch')
  }
  return Array.from(features)
}

function featuresForLogTurn(turn: AdapterLabLogTurn): string[] {
  const features = new Set<string>()
  if (turn.preview) features.add('final_answer')
  if (turn.toolCount > 0) features.add('tool_call')
  if (turn.itemCounts['response_item:function_call_output'] || turn.itemCounts['response_item:custom_tool_call_output']) {
    features.add('tool_output')
  }
  if (turn.toolCount > 1) features.add('multi_tool')
  if (turn.itemCounts['response_item:reasoning']) features.add('reasoning')
  if (turn.itemCounts['event_msg:patch_apply_end'] || turn.toolNames.includes('apply_patch')) features.add('file_patch')
  if (turn.itemCounts['response_item:custom_tool_call'] || turn.itemCounts['response_item:custom_tool_call_output']) features.add('custom_tool')
  if (turn.itemCounts['event_msg:mcp_tool_call_end'] || turn.toolNames.some(name => name.includes('browser') || name.includes('mcp'))) features.add('mcp_tool')
  if (turn.status === 'failed' || /Exit code:\s*[1-9]/.test(turn.preview)) features.add('failure')
  if (turn.status === 'completed') features.add('completed')
  if (turn.toolNames.includes('shell_command')) features.add('shell_command')
  return Array.from(features)
}

function sourceFromMeta(meta: Record<string, unknown>): AdapterLabReferenceMatch['source'] {
  const originator = stringValue(meta.originator).toLowerCase()
  const source = stringValue(meta.source).toLowerCase()
  if (originator.includes('desktop')) return 'desktop'
  if (originator.includes('codex-tui') || source === 'cli') return 'cli'
  return 'unknown'
}

function findJsonlFiles(root: string, files: string[] = []): string[] {
  if (!existsSync(root)) return files
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const fullPath = join(root, entry.name)
    if (entry.isDirectory()) findJsonlFiles(fullPath, files)
    else if (entry.name.endsWith('.jsonl')) files.push(fullPath)
  }
  return files
}

function readJsonl(path: string): JsonlEvent[] {
  return readFileSync(path, 'utf8')
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
}

function knownRawMethod(method: string): boolean {
  return (
    method === 'remoteControl/status/changed' ||
    method === 'thread/started' ||
    method === 'thread/status/changed' ||
    method === 'mcpServer/startupStatus/updated' ||
    method === 'warning' ||
    method === 'turn/started' ||
    method === 'turn/completed' ||
    method === 'turn/failed' ||
    method === 'item/started' ||
    method === 'item/updated' ||
    method === 'item/completed' ||
    method === 'item/agentMessage/delta' ||
    method === 'account/rateLimits/updated' ||
    method.endsWith('/result')
  )
}

function previousUser(messages: { role: string; content: string }[], index: number): string {
  for (let i = index - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') return messages[i].content
  }
  return ''
}

function cleanUserMessage(message: string): string {
  const marker = '## My request for Codex:'
  const index = message.indexOf(marker)
  return (index >= 0 ? message.slice(index + marker.length) : message).trim()
}

function stripThinkTags(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<think>[\s\S]*$/g, '')
    .replace(/<\/think>/g, '')
    .replace(/<think>/g, '')
    .trim()
}

function preview(text: string): string {
  return stripThinkTags(text).replace(/\s+/g, ' ').trim().slice(0, 180)
}

function normalizeForCompare(text: string): string {
  return stripThinkTags(text).replace(/\s+/g, ' ').trim()
}

function statSafe(path: string): number {
  try {
    return statSync(path).mtimeMs
  } catch {
    return 0
  }
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function sameList(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined
}
