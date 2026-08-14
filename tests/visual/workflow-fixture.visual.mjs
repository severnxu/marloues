import { existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..', '..', 'client')
const require = createRequire(join(root, 'package.json'))
const { chromium } = require('@playwright/test')
const viteCli = resolve(dirname(require.resolve('vite/package.json')), 'bin', 'vite.js')
const tsxCli = require.resolve('tsx/cli')
const port = Number(process.env.MARLOUES_FIXTURE_PORT || 5187)
const fixtureState = process.env.MARLOUES_FIXTURE_STATE || 'completed'
const fixtureSurface = process.env.MARLOUES_FIXTURE_SURFACE || 'turn'
const fixtureData = process.env.MARLOUES_FIXTURE_DATA || 'workflow'
const workflowFixture = fixtureSurface === 'shell' ? 'chatShell' : 'codex'
const url = `http://127.0.0.1:${port}/?workflowFixture=${encodeURIComponent(workflowFixture)}&workflowFixtureState=${encodeURIComponent(fixtureState)}&workflowFixtureData=${encodeURIComponent(fixtureData)}`
const viewport = {
  width: Number(process.env.MARLOUES_FIXTURE_WIDTH || 1440),
  height: Number(process.env.MARLOUES_FIXTURE_HEIGHT || 900),
}
const outputDir = resolve(root, 'test-results', 'workflow-fixture-visual')
const screenshotPath = join(outputDir, `marloues-workflow-fixture-${fixtureSurface}-${fixtureData}-${fixtureState}.png`)
const latestCodexReadThread = fixtureData === 'latestCodexReadThread'
  ? loadLatestCodexReadThread()
  : null

if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true })

const server = spawn(process.execPath, [
  viteCli,
  '--config',
  resolve(root, 'vite.renderer.config.ts'),
  '--host',
  '127.0.0.1',
  '--port',
  String(port),
  '--strictPort',
], {
  cwd: root,
  env: {
    ...process.env,
    BROWSER: 'none',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let serverOutput = ''
server.stdout.on('data', chunk => {
  serverOutput += chunk.toString()
})
server.stderr.on('data', chunk => {
  serverOutput += chunk.toString()
})

try {
  await waitForHttp(url, 15_000)
  const browser = await chromium.launch()
  const page = await browser.newPage({
    viewport,
    deviceScaleFactor: 1,
  })
  const consoleMessages = []
  page.on('console', message => {
    consoleMessages.push(`[${message.type()}] ${message.text()}`)
  })
  page.on('pageerror', error => {
    consoleMessages.push(`[pageerror] ${error.message}`)
  })
  if (latestCodexReadThread?.readThread) {
    await page.addInitScript(readThread => {
      window.__MARLOUES_WORKFLOW_FIXTURE_READ_THREAD__ = readThread
    }, latestCodexReadThread.readThread)
  }

  await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 })
  await page.screenshot({ path: screenshotPath, fullPage: false })

  const metrics = await page.evaluate(() => {
    const rectFromElement = element => {
      if (!element) return null
      const rect = element.getBoundingClientRect()
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
      }
    }
    const rectOf = selector => {
      const element = document.querySelector(selector)
      return rectFromElement(element)
    }
    const rectOfIndex = (selector, index) => {
      const element = document.querySelectorAll(selector)[index]
      return rectFromElement(element)
    }
    const colorOf = selector => {
      const element = document.querySelector(selector)
      return element ? getComputedStyle(element).color : ''
    }
    const styleMetric = selector => {
      const element = document.querySelector(selector)
      if (!element) return null
      const style = getComputedStyle(element)
      return {
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
      }
    }
    const visibleCount = selector => Array.from(document.querySelectorAll(selector))
      .filter(element => Boolean(element.offsetWidth || element.offsetHeight || element.getClientRects().length))
      .length
    const resultCardMetrics = Array.from(document.querySelectorAll('[data-kind="result-card"]')).map(element => ({
      kind: element.getAttribute('data-result-kind') ?? '',
      rect: rectFromElement(element),
      rowCount: element.querySelectorAll('.workflow-result-file-row').length,
    }))
    const text = document.body.innerText.replace(/\s+/g, ' ').trim()
    const mojibakeMatches = text.match(/[锟�]|(?:绗|涓|紝|姝|宸|鐞|浠|枃|鎬|鍦|杈|妯|懡)/g) ?? []

    return {
      title: document.title,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      fixturePage: rectOf('.workflow-fixture-page'),
      fixtureShell: rectOf('.workflow-fixture-shell'),
      firstUserMessage: rectOf('[data-kind="user-message"]'),
      firstUserBubble: rectOf('[data-kind="user-message-bubble"]'),
      firstHeader: rectOf('[data-kind="turn-header"]'),
      firstAssistantAnswer: rectOf('[data-kind="assistant-answer"]'),
      firstAssistantAnswerStyle: styleMetric('[data-kind="assistant-answer"]'),
      firstResultCard: rectOf('[data-kind="result-card"]'),
      firstActivityRow: rectOf('[data-kind="activity-row"]'),
      firstActivityIcon: rectOf('[data-kind="activity-row"] svg'),
      firstActivityIconColor: colorOf('[data-kind="activity-row"] svg'),
      firstResultButton: rectOfIndex('[data-kind="result-card"] button', 0),
      chatPage: rectOf('.chat-page'),
      messagesScroll: rectOf('.messages-scroll'),
      messagesInner: rectOf('.messages-inner'),
      chatHeader: rectOf('.chat-header'),
      composerWrap: rectOf('.composer-wrap'),
      composer: rectOf('.composer'),
      composerInput: rectOf('.composer-input'),
      composerToolbar: rectOf('.composer-toolbar'),
      turns: document.querySelectorAll('[data-kind="workflow-turn"]').length,
      assistantTurns: document.querySelectorAll('[data-kind="assistant-turn"]').length,
      turnHeaders: document.querySelectorAll('[data-kind="turn-header"]').length,
      expandedTurns: Array.from(document.querySelectorAll('[data-kind="workflow-turn"]'))
        .filter(element => element.getAttribute('data-turn-expanded') === 'true')
        .length,
      activityRows: document.querySelectorAll('[data-kind="activity-row"]').length,
      visibleActivityRows: visibleCount('[data-kind="activity-row"]'),
      resultCards: document.querySelectorAll('[data-kind="result-card"]').length,
      resultCardMetrics,
      assistantAnswers: document.querySelectorAll('[data-kind="assistant-answer"]').length,
      commandCards: document.querySelectorAll('.workflow-command-card').length,
      userBubbles: document.querySelectorAll('[data-kind="user-message"]').length,
      messageModels: document.querySelectorAll('.message-model').length,
      messageFooterOpacity: getComputedStyle(document.querySelector('.message-footer') ?? document.body).opacity,
      assistantActionsOpacity: getComputedStyle(document.querySelector('.assistant-actions') ?? document.body).opacity,
      bodyTextSample: text.slice(0, 700),
      hasContextLeakText: text.includes('<codex_internal_context')
        || text.includes('<environment_context>')
        || text.includes('# AGENTS.md instructions')
        || text.includes('<INSTRUCTIONS>'),
      mojibakeSignalCount: mojibakeMatches.length,
      hasReplacementChar: text.includes('�'),
    }
  })

  if (fixtureSurface === 'turn' && fixtureState === 'completed') {
    assertBetween(metrics.viewport.width, 1260, 1290, 'visual probe should run at the Codex desktop width')
    assertBetween(metrics.fixtureShell.width, 732, 740, 'fixture shell should keep the Codex 736px transcript width')
    assertNear(metrics.fixtureShell.x, (metrics.viewport.width - metrics.fixtureShell.width) / 2, 2, 'fixture shell should stay centered')
    assertBetween(metrics.firstUserBubble?.y ?? -1, 10, 60, 'completed prompt should sit near the top like Codex')
    assertBetween(metrics.firstUserBubble?.height ?? -1, 28, 44, 'completed prompt bubble should stay Codex-compact')
    assert(metrics.expandedTurns === 0, 'completed fixture should default collapsed')
    assert(metrics.visibleActivityRows === 0, 'completed fixture should hide activity rows while collapsed')
    assert(metrics.resultCards >= 1, 'completed fixture should keep result cards visible while collapsed')
    assertBetween(metrics.firstResultCard?.height ?? -1, 58, 76, 'completed compact result card should stay near Codex height')
    assertBetween(parseCssPx(metrics.firstAssistantAnswerStyle?.lineHeight), 23.8, 24.4, 'assistant answer line-height should match Codex density')
    assertCompactResultCards(metrics)
  }

  if (fixtureSurface === 'turn' && fixtureState === 'running') {
    assert(metrics.expandedTurns === 1, 'running fixture should stay expanded')
    assert(metrics.visibleActivityRows >= 2, 'running fixture should reveal activity rows')
    assertBetween(metrics.firstActivityRow?.height ?? -1, 24, 30, 'running activity rows should stay compact')
    assertBetween(metrics.firstActivityIcon?.width ?? -1, 13, 16, 'running activity icons should stay compact')
    assertBetween(metrics.firstActivityIcon?.height ?? -1, 13, 16, 'running activity icons should stay compact')
    assertColorNear(metrics.firstActivityIconColor, [138, 143, 153], 8, 'running activity icon color should match Codex gray')
  }

  if (fixtureSurface === 'shell') {
    assertBetween(metrics.messagesInner?.width ?? -1, 732, 740, 'chat shell messages column should keep Codex width')
    assertNear(metrics.messagesInner?.x ?? -1, (metrics.viewport.width - (metrics.messagesInner?.width ?? 0)) / 2, 2, 'chat shell messages column should stay centered')
    assertBetween(metrics.firstUserBubble?.y ?? -1, 10, 60, 'chat shell prompt should not be pushed down by Marloues header')
    assertBetween(metrics.composer?.width ?? -1, 732, 740, 'chat shell composer should keep Codex width')
    assertBetween(metrics.composer?.height ?? -1, 80, 98, 'chat shell composer should stay Codex-compact')
    assertBetween(metrics.composerToolbar?.height ?? -1, 36, 40, 'chat shell composer toolbar should match Codex height')
    assert(metrics.chatHeader?.height <= 34, 'chat shell header should be a compact floating control')
    assert(metrics.turns >= 1, 'chat shell should render at least one turn')
    if (fixtureData !== 'latestCodexReadThread') {
      assert(metrics.turns === 1, 'chat shell should render exactly one fixture turn')
      assert(metrics.expandedTurns === 0, 'chat shell completed turn should default collapsed')
      assert(metrics.visibleActivityRows === 0, 'chat shell completed turn should hide activity rows')
      assert(metrics.resultCards >= 1, 'chat shell completed turn should keep result cards')
    } else {
      assertBetween(metrics.firstUserBubble?.height ?? -1, 28, 180, 'latest Codex sample should not expose giant context-only user bubbles')
      assert(!metrics.hasContextLeakText, 'latest Codex sample should not expose internal context text')
      assert(metrics.expandedTurns === 0, 'latest Codex completed sample should default collapsed')
      assert(metrics.visibleActivityRows === 0, 'latest Codex completed sample should hide activity rows')
      assert(metrics.userBubbles === metrics.turns, 'latest Codex sample should not duplicate user-only turns')
      assertResultCardDensity(metrics)
    }
    assert(metrics.mojibakeSignalCount === 0, 'chat shell should not render mojibake text')
    assert(!metrics.hasReplacementChar, 'chat shell should not render replacement characters')
    assertBetween(parseCssPx(metrics.firstAssistantAnswerStyle?.lineHeight), 23.8, 24.4, 'chat shell assistant answer line-height should match Codex density')
    assert(metrics.messageModels === 0, 'chat shell should not show Marloues model/date footers')
    assert(metrics.messageFooterOpacity === '0', 'chat shell assistant actions should stay hidden until hover')
    assertBetween(metrics.chatPage?.height ?? -1, metrics.viewport.height - 2, metrics.viewport.height + 2, 'chat shell should fill the viewport')
    assertBetween(metrics.viewport.height - (metrics.composerWrap?.bottom ?? 0), 0, 2, 'chat shell composer should sit at the bottom edge')
  }

  await browser.close()

  console.log(JSON.stringify({
    ok: true,
    url,
    fixtureState,
    fixtureSurface,
    fixtureData,
    latestCodexSession: latestCodexReadThread ? {
      source: latestCodexReadThread.source,
      sessionId: latestCodexReadThread.sessionId,
      cwd: latestCodexReadThread.cwd,
      turnCount: latestCodexReadThread.turnCount,
    } : null,
    screenshotPath,
    metrics,
    consoleMessages: consoleMessages.slice(0, 20),
  }, null, 2))
} finally {
  server.kill()
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assertBetween(value, min, max, message) {
  assert(value >= min && value <= max, `${message}: expected ${min}..${max}, got ${value}`)
}

function assertNear(value, expected, tolerance, message) {
  assert(Math.abs(value - expected) <= tolerance, `${message}: expected ${expected} +/- ${tolerance}, got ${value}`)
}

function assertColorNear(value, expected, tolerance, message) {
  const actual = parseRgb(value)
  assert(actual, `${message}: expected rgb color, got ${value}`)
  for (let index = 0; index < expected.length; index += 1) {
    assert(
      Math.abs(actual[index] - expected[index]) <= tolerance,
      `${message}: expected ${expected.join(',')} +/- ${tolerance}, got ${actual.join(',')}`,
    )
  }
}

function assertCompactResultCards(metrics) {
  for (const card of metrics.resultCardMetrics ?? []) {
    if (card.kind === 'image' || card.rowCount > 0) continue
    assertBetween(card.rect?.height ?? -1, 58, 76, 'compact result cards should stay near Codex height')
  }
}

function assertResultCardDensity(metrics) {
  for (const card of metrics.resultCardMetrics ?? []) {
    if (card.kind === 'image') continue
    if (card.rowCount > 0) {
      assertBetween(
        card.rect?.height ?? -1,
        58 + 32 * card.rowCount,
        70 + 36 * card.rowCount,
        'multi-row diff result cards should stay Codex-dense',
      )
    } else {
      assertBetween(card.rect?.height ?? -1, 58, 76, 'compact result cards should stay near Codex height')
    }
  }
}

function parseRgb(value) {
  const match = String(value).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function parseCssPx(value) {
  const parsed = Number.parseFloat(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : -1
}

function loadLatestCodexReadThread() {
  const result = spawnSync(process.execPath, [
    tsxCli,
    resolve(root, 'scripts', 'export-latest-codex-read-thread.ts'),
  ], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.status !== 0) {
    throw new Error([
      'Failed to export latest Codex readThread.',
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'))
  }
  const output = JSON.parse(result.stdout)
  if (!output.ok) {
    throw new Error(output.reason || 'Latest Codex readThread is unavailable.')
  }
  return output
}

async function waitForHttp(targetUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const response = await fetch(targetUrl, { cache: 'no-store' })
      if (response.ok) return
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await delay(200)
  }
  throw new Error(`Timed out waiting for ${targetUrl}\nServer output:\n${serverOutput}\nLast error: ${lastError?.message ?? 'unknown'}`)
}
