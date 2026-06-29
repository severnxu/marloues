import { log } from '../logger'
import { eventLog, type EventLogEntry } from './event-log'

export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
  threadId: string
  turnId?: string
  sessionId: string
  cwd?: string
}

export interface ToolResult {
  id: string
  name: string
  output: unknown
  success: boolean
  durationMs: number
  error?: string
}

export interface ToolAuditEntry {
  timestamp: number
  toolCall: ToolCall
  result: ToolResult
}

export interface ToolRuntimeConfig {
  defaultTimeoutMs?: number
  maxRetries?: number
  auditLogEnabled?: boolean
}

const DEFAULT_CONFIG: ToolRuntimeConfig = {
  defaultTimeoutMs: 30000,
  maxRetries: 2,
  auditLogEnabled: true,
}

class ToolRuntime {
  private config: ToolRuntimeConfig
  private auditLog: ToolAuditEntry[] = []
  private activeToolCalls: Map<string, { call: ToolCall; startTime: number; timer?: ReturnType<typeof setTimeout> }> = new Map()

  constructor(config?: Partial<ToolRuntimeConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  async execute<T>(
    toolCall: ToolCall,
    executor: (call: ToolCall, signal: AbortSignal) => Promise<T>
  ): Promise<ToolResult & { data?: T }> {
    const startTime = Date.now()
    const controller = new AbortController()

    // Set up timeout
    const timeoutMs = this.config.defaultTimeoutMs || 30000
    const timer = setTimeout(() => {
      controller.abort()
    }, timeoutMs)

    this.activeToolCalls.set(toolCall.id, { call: toolCall, startTime, timer })

    let output: unknown
    let success = true
    let error: string | undefined

    try {
      output = await executor(toolCall, controller.signal)
    } catch (err) {
      success = false
      error = err instanceof Error ? err.message : String(err)
      output = { error }
    } finally {
      clearTimeout(timer)
      this.activeToolCalls.delete(toolCall.id)
    }

    const durationMs = Date.now() - startTime
    const result: ToolResult = {
      id: toolCall.id,
      name: toolCall.name,
      output,
      success,
      durationMs,
      error,
    }

    // Log to event log
    if (this.config.auditLogEnabled) {
      const auditEntry: ToolAuditEntry = { timestamp: Date.now(), toolCall, result }
      this.auditLog.push(auditEntry)

      const logEntry: EventLogEntry = {
        timestamp: Date.now(),
        threadId: toolCall.threadId,
        turnId: toolCall.turnId,
        sessionId: toolCall.sessionId,
        type: 'tool_executed',
        payload: auditEntry,
      }
      eventLog.append(logEntry)

      log(`[ToolRuntime] ${toolCall.name} ${success ? 'completed' : 'failed'} in ${durationMs}ms`)
    }

    return { ...result, data: output as T }
  }

  getActiveToolCalls(): Array<{ call: ToolCall; elapsedMs: number }> {
    const now = Date.now()
    return Array.from(this.activeToolCalls.values()).map(({ call, startTime }) => ({
      call,
      elapsedMs: now - startTime,
    }))
  }

  cancelToolCall(toolId: string): boolean {
    const active = this.activeToolCalls.get(toolId)
    if (active) {
      if (active.timer) clearTimeout(active.timer)
      this.activeToolCalls.delete(toolId)
      return true
    }
    return false
  }

  getAuditLog(filter?: { toolName?: string; startTime?: number; endTime?: number; limit?: number }): ToolAuditEntry[] {
    let entries = [...this.auditLog]

    if (filter) {
      if (filter.toolName) {
        entries = entries.filter(e => e.toolCall.name === filter.toolName)
      }
      if (filter.startTime) {
        entries = entries.filter(e => e.timestamp >= filter.startTime!)
      }
      if (filter.endTime) {
        entries = entries.filter(e => e.timestamp <= filter.endTime!)
      }
    }

    if (filter?.limit) {
      entries = entries.slice(-filter.limit)
    }

    return entries
  }

  clearAuditLog(): void {
    this.auditLog = []
  }
}

export const toolRuntime = new ToolRuntime()
