import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { log } from '../logger'
import { getStateDir } from '../app-paths'

export interface EventLogEntry {
  timestamp: number
  threadId: string
  turnId?: string
  sessionId: string
  type: string
  payload: unknown
}

export interface EventFilter {
  type?: string
  turnId?: string
  startTime?: number
  endTime?: number
  limit?: number
}

class EventLog {
  private basePath: string
  private writeBuffer: Map<string, EventLogEntry[]> = new Map()
  private flushInterval: ReturnType<typeof setInterval> | null = null

  constructor() {
    const userDataPath = getEventLogUserDataPath()
    this.basePath = join(userDataPath, 'events')
    if (!existsSync(this.basePath)) {
      mkdirSync(this.basePath, { recursive: true })
    }
    // Flush buffer every 5 seconds
    this.flushInterval = setInterval(() => this.flush(), 5000)
  }

  private getFilePath(threadId: string): string {
    return join(this.basePath, `${threadId}.jsonl`)
  }

  append(entry: EventLogEntry): void {
    if (!entry.threadId) {
      log('[EventLog] Skipping event without threadId:', entry.type)
      return
    }
    const filePath = this.getFilePath(entry.threadId)
    try {
      const line = JSON.stringify(entry) + '\n'
      appendFileSync(filePath, line, 'utf-8')
    } catch (err) {
      log('[EventLog] Failed to append event:', err)
    }
  }

  query(threadId: string, filter?: EventFilter): EventLogEntry[] {
    const filePath = this.getFilePath(threadId)
    if (!existsSync(filePath)) return []

    try {
      const content = readFileSync(filePath, 'utf-8')
      const lines = content.split('\n').filter(l => l.trim())
      let entries: EventLogEntry[] = lines.map(l => JSON.parse(l))

      if (filter) {
        if (filter.type) {
          entries = entries.filter(e => e.type === filter.type)
        }
        if (filter.turnId) {
          entries = entries.filter(e => e.turnId === filter.turnId)
        }
        if (filter.startTime) {
          entries = entries.filter(e => e.timestamp >= filter.startTime!)
        }
        if (filter.endTime) {
          entries = entries.filter(e => e.timestamp <= filter.endTime!)
        }
        if (filter.limit) {
          entries = entries.slice(-filter.limit)
        }
      }

      return entries
    } catch (err) {
      log('[EventLog] Failed to query events:', err)
      return []
    }
  }

  listThreads(): string[] {
    try {
      return readdirSync(this.basePath)
        .filter(f => f.endsWith('.jsonl'))
        .map(f => f.replace('.jsonl', ''))
    } catch {
      return []
    }
  }

  exportEvents(threadId: string): string {
    const filePath = this.getFilePath(threadId)
    if (!existsSync(filePath)) return ''
    return readFileSync(filePath, 'utf-8')
  }

  private flush(): void {
    // Buffer is already written directly, this is a no-op for now
    // Can be enhanced to batch writes for performance
  }

  destroy(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval)
    }
  }
}

function getEventLogUserDataPath(): string {
  try {
    if (app?.getPath) return app.getPath('userData')
  } catch {
    // Non-Electron scripts use the project state dir.
  }
  return getStateDir()
}

export const eventLog = new EventLog()
