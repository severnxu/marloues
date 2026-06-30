import { eventLog, type EventLogEntry, type EventFilter } from './event-log'
import { log } from '../logger'

export interface ReplayEvent {
  timestamp: number
  delayMs: number
  entry: EventLogEntry
}

export interface ReplaySession {
  id: string
  threadId: string
  events: ReplayEvent[]
  currentIndex: number
  isPlaying: boolean
  startTime: number
}

export interface ReplayCallback {
  onEvent: (entry: EventLogEntry, index: number, total: number) => void
  onComplete: () => void
  onError: (error: string) => void
}

class ReplayManager {
  private sessions: Map<string, ReplaySession> = new Map()
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map()

  startReplay(
    sessionId: string,
    threadId: string,
    filter?: EventFilter,
    callback?: ReplayCallback
  ): string {
    // Stop any existing replay for this session
    this.stopReplay(sessionId)

    const entries = eventLog.query(threadId, filter)
    if (entries.length === 0) {
      log('[Replay] No events found for thread:', threadId)
      return ''
    }

    // Calculate delays between events
    const events: ReplayEvent[] = entries.map((entry, index) => {
      const delayMs = index === 0 ? 0 : entry.timestamp - entries[index - 1].timestamp
      return { timestamp: entry.timestamp, delayMs, entry }
    })

    const replayId = `replay-${sessionId}-${Date.now()}`
    const session: ReplaySession = {
      id: replayId,
      threadId,
      events,
      currentIndex: 0,
      isPlaying: true,
      startTime: Date.now(),
    }

    this.sessions.set(replayId, session)

    // Start playback
    this.playNext(replayId, callback)

    log(`[Replay] Started replay ${replayId} with ${events.length} events`)
    return replayId
  }

  private playNext(replayId: string, callback?: ReplayCallback): void {
    const session = this.sessions.get(replayId)
    if (!session || !session.isPlaying) return

    if (session.currentIndex >= session.events.length) {
      session.isPlaying = false
      callback?.onComplete()
      this.sessions.delete(replayId)
      return
    }

    const event = session.events[session.currentIndex]
    const delay = Math.min(event.delayMs, 1000) // Cap delay at 1 second for fast replay

    const timer = setTimeout(() => {
      this.timers.delete(replayId)
      callback?.onEvent(event.entry, session.currentIndex, session.events.length)
      session.currentIndex++
      this.playNext(replayId, callback)
    }, delay)

    this.timers.set(replayId, timer)
  }

  pauseReplay(replayId: string): boolean {
    const session = this.sessions.get(replayId)
    if (!session) return false

    session.isPlaying = false
    const timer = this.timers.get(replayId)
    if (timer) {
      clearTimeout(timer)
      this.timers.delete(replayId)
    }
    return true
  }

  resumeReplay(replayId: string, callback?: ReplayCallback): boolean {
    const session = this.sessions.get(replayId)
    if (!session) return false

    session.isPlaying = true
    this.playNext(replayId, callback)
    return true
  }

  stopReplay(replayId: string): boolean {
    const session = this.sessions.get(replayId)
    if (!session) return false

    session.isPlaying = false
    const timer = this.timers.get(replayId)
    if (timer) {
      clearTimeout(timer)
      this.timers.delete(replayId)
    }
    this.sessions.delete(replayId)
    return true
  }

  getReplayStatus(replayId: string): ReplaySession | undefined {
    return this.sessions.get(replayId)
  }

  listReplays(): ReplaySession[] {
    return Array.from(this.sessions.values())
  }
}

export const replayManager = new ReplayManager()
