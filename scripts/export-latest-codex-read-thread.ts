import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseSessionLog } from '../src/main/codex/session-log'

const sessionsRoot = join(homedir(), '.codex', 'sessions')
const snapshot = latestUsefulSnapshot()

if (!snapshot || snapshot.readThread.turns.length === 0) {
  console.log(JSON.stringify({
    ok: false,
    reason: 'No useful Codex session log with visible user turns was found.',
  }))
  process.exit(0)
}

console.log(JSON.stringify({
  ok: true,
  source: snapshot.source,
  sessionId: snapshot.sessionId,
  cwd: snapshot.cwd,
  generatedAt: snapshot.generatedAt,
  turnCount: snapshot.readThread.turns.length,
  readThread: snapshot.readThread,
}))

function latestUsefulSnapshot() {
  return walk(sessionsRoot)
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    .slice(0, 80)
    .map(source => {
      try {
        return withoutContextOnlyTurns(parseSessionLog(source))
      } catch {
        return null
      }
    })
    .find(snapshot => Boolean(
      snapshot
        && hasVisibleUserTurn(snapshot)
        && isCompletedSnapshot(snapshot)
        && JSON.stringify(snapshot.readThread).length < 8_000_000,
    )) ?? null
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

function hasVisibleUserTurn(snapshot: ReturnType<typeof parseSessionLog>): boolean {
  const userTexts = snapshot.readThread.turns.flatMap(turn => {
    const userItem = turn.items.find(item => item.type === 'userMessage')
    if (!userItem || userItem.type !== 'userMessage') return []
    return userItem.content
      .filter(entry => entry.type === 'text')
      .map(entry => entry.text)
      .join('\n')
      .trim()
  })
  if (userTexts.length === 0) return false
  if (userTexts.some(isContextOnlyUserText)) return false
  return userTexts.some(text => text.length > 0 && text.length < 2000)
}

function isCompletedSnapshot(snapshot: ReturnType<typeof parseSessionLog>): boolean {
  return snapshot.readThread.turns.length > 0
    && snapshot.readThread.turns.every(turn => turn.status === 'completed')
}

function isContextOnlyUserText(text: string): boolean {
  return text.includes('<codex_internal_context')
    || text.includes('<environment_context>')
    || text.includes('# AGENTS.md instructions')
    || text.includes('<INSTRUCTIONS>')
}

function withoutContextOnlyTurns(snapshot: ReturnType<typeof parseSessionLog>): ReturnType<typeof parseSessionLog> {
  const turns = snapshot.readThread.turns.filter(turn => {
    const userItem = turn.items.find(item => item.type === 'userMessage')
    if (!userItem || userItem.type !== 'userMessage') return true
    const text = userItem.content
      .filter(entry => entry.type === 'text')
      .map(entry => entry.text)
      .join('\n')
      .trim()
    return !isContextOnlyUserText(text)
  })
  const visibleTurnIds = new Set(turns.map(turn => turn.id))
  const messages = snapshot.messages.filter(message => visibleTurnIds.has(message.id))
  return {
    ...snapshot,
    messages,
    readThread: {
      ...snapshot.readThread,
      page: {
        ...snapshot.readThread.page,
        limit: turns.length,
      },
      turns,
    },
  }
}
