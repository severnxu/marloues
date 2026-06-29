import { spawnSync } from 'node:child_process'

const basePort = Number(process.env.MARLOUES_VISUAL_SUITE_PORT || 5210)
const cases = [
  { name: 'turn completed workflow', surface: 'turn', data: 'workflow', state: 'completed' },
  { name: 'turn running workflow', surface: 'turn', data: 'workflow', state: 'running' },
  { name: 'shell completed workflow', surface: 'shell', data: 'workflow', state: 'completed' },
  { name: 'shell completed readThread', surface: 'shell', data: 'readThread', state: 'completed' },
  { name: 'shell latest Codex readThread', surface: 'shell', data: 'latestCodexReadThread', state: 'completed' },
]

const results = []

for (let index = 0; index < cases.length; index += 1) {
  const testCase = cases[index]
  const env = {
    ...process.env,
    MARLOUES_FIXTURE_WIDTH: process.env.MARLOUES_FIXTURE_WIDTH || '1264',
    MARLOUES_FIXTURE_HEIGHT: process.env.MARLOUES_FIXTURE_HEIGHT || '735',
    MARLOUES_FIXTURE_PORT: String(basePort + index),
    MARLOUES_FIXTURE_SURFACE: testCase.surface,
    MARLOUES_FIXTURE_DATA: testCase.data,
    MARLOUES_FIXTURE_STATE: testCase.state,
  }
  const result = spawnSync(process.execPath, ['scripts/verify-workflow-fixture-visual.mjs'], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.status !== 0) {
    throw new Error([
      `Workflow visual case failed: ${testCase.name}`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'))
  }
  const output = JSON.parse(result.stdout)
  results.push({
    name: testCase.name,
    screenshotPath: output.screenshotPath,
    latestCodexSession: output.latestCodexSession,
    metrics: {
      turns: output.metrics.turns,
      expandedTurns: output.metrics.expandedTurns,
      visibleActivityRows: output.metrics.visibleActivityRows,
      resultCards: output.metrics.resultCards,
      resultCardMetrics: output.metrics.resultCardMetrics,
      firstUserBubble: output.metrics.firstUserBubble,
      firstAssistantAnswerStyle: output.metrics.firstAssistantAnswerStyle,
      firstResultCard: output.metrics.firstResultCard,
      messageModels: output.metrics.messageModels,
      messageFooterOpacity: output.metrics.messageFooterOpacity,
      assistantActionsOpacity: output.metrics.assistantActionsOpacity,
      composer: output.metrics.composer,
      composerToolbar: output.metrics.composerToolbar,
    },
  })
}

console.log(JSON.stringify({
  ok: true,
  checked: results.length,
  results,
}, null, 2))
