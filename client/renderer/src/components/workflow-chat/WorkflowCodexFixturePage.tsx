import { useEffect } from 'react'
import { Columns2 } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { WorkflowComposerShell } from './ComposerShell'
import { WorkflowReadThreadTurnList } from './ReadThreadTurnList'
import { WorkflowScrollToBottomButton } from './ScrollToBottomButton'
import { WorkflowTurnList } from './WorkflowTurnList'
import {
  workflowMessagesToWorkflowReadThreadResponse,
  type WorkflowMessageBlock,
} from '../../../../shared/adapters/workflow-messages-to-read-thread'
import type { WorkflowReadThreadResponse } from '../../../../shared/workflow-read-thread-contract'

declare global {
  interface Window {
    __MARLOUES_WORKFLOW_FIXTURE_READ_THREAD__?: WorkflowReadThreadResponse
  }
}

const baseTime = Date.now() - 42_000

export function WorkflowCodexFixturePage() {
  const fixtureState = new URLSearchParams(window.location.search).get('workflowFixtureState') ?? 'all'
  const showThinking = fixtureState === 'all' || fixtureState === 'thinking'
  const showRunning = fixtureState === 'all' || fixtureState === 'running'
  const showCompleted = fixtureState === 'all' || fixtureState === 'completed'

  useEffect(() => {
    const root = document.documentElement
    const previousTheme = root.dataset.theme
    const previousPreference = root.dataset.themePreference
    const previousColorScheme = root.style.colorScheme
    root.dataset.theme = 'dark'
    root.dataset.themePreference = 'dark'
    root.style.colorScheme = 'dark'
    root.classList.add('dark')
    root.classList.remove('light', 'warm')
    return () => {
      if (previousTheme) root.dataset.theme = previousTheme
      else delete root.dataset.theme
      if (previousPreference) root.dataset.themePreference = previousPreference
      else delete root.dataset.themePreference
      root.style.colorScheme = previousColorScheme
    }
  }, [])

  return (
    <main className="workflow-fixture-page">
      <div className="workflow-fixture-shell">
        {showThinking ? (
          <WorkflowTurnList
            workflowMessages={thinkingMessages}
            isStreaming
            stateScopeKey="codex-fixture-thinking"
            modelName="GPT-5"
          />
        ) : null}
        {showRunning ? (
          <WorkflowTurnList
            workflowMessages={runningMessages}
            isStreaming
            stateScopeKey="codex-fixture-running"
            modelName="GPT-5"
          />
        ) : null}
        {showCompleted ? (
          <WorkflowTurnList
            workflowMessages={completedMessages}
            isStreaming={false}
            stateScopeKey="codex-fixture-complete"
            modelName="GPT-5"
            onCopyMessage={() => undefined}
            onRegenerate={() => undefined}
            onDeleteMessage={() => undefined}
          />
        ) : null}
      </div>
    </main>
  )
}

export function WorkflowChatShellFixturePage() {
  useCodexFixtureTheme()
  const fixtureData = new URLSearchParams(window.location.search).get('workflowFixtureData') ?? 'workflow'
  const injectedReadThread = window.__MARLOUES_WORKFLOW_FIXTURE_READ_THREAD__
  const useReadThread = fixtureData === 'readThread' || fixtureData === 'latestCodexReadThread'
  const readThread = injectedReadThread ?? completedReadThread
  const stateScopeKey = injectedReadThread
    ? `codex-shell-read-thread-real-${injectedReadThread.thread.id}`
    : 'codex-shell-read-thread-fixture-complete'

  return (
    <section className="chat-page" data-kind="chat-shell-fixture">
      <div className="chat-header">
        <span>Codex shell fixture</span>
        <button
          className="icon-button"
          type="button"
          title="Show right sidebar"
          aria-label="Show right sidebar"
        >
          <Columns2 size={16} />
        </button>
      </div>
      <div className="messages-scroll scrollbar-thin">
        <div className="messages-inner">
          {useReadThread ? (
            <WorkflowReadThreadTurnList
              readThread={readThread}
              isStreaming={false}
              stateScopeKey={stateScopeKey}
              modelName="GPT-5"
              showFooterMetadata={false}
              onCopyMessage={() => undefined}
              onRegenerate={() => undefined}
              onDeleteMessage={() => undefined}
            />
          ) : (
            <WorkflowTurnList
              workflowMessages={completedMessages}
              isStreaming={false}
              stateScopeKey="codex-shell-fixture-complete"
              modelName="GPT-5"
              showFooterMetadata={false}
              onCopyMessage={() => undefined}
              onRegenerate={() => undefined}
              onDeleteMessage={() => undefined}
            />
          )}
        </div>
      </div>
      <WorkflowScrollToBottomButton visible={false} onClick={() => undefined} />
      <WorkflowComposerShell
        input=""
        isGenerating={false}
        selectedProvider={null}
        onInputChange={() => undefined}
        onKeyDown={noopKeyDown}
        onSend={() => undefined}
        onStop={() => undefined}
        modelControl={null}
        placeholder="交给 Codex 一个本地代码任务..."
      />
    </section>
  )
}

function useCodexFixtureTheme() {
  useEffect(() => {
    const root = document.documentElement
    const previousTheme = root.dataset.theme
    const previousPreference = root.dataset.themePreference
    const previousColorScheme = root.style.colorScheme
    root.dataset.theme = 'dark'
    root.dataset.themePreference = 'dark'
    root.style.colorScheme = 'dark'
    root.classList.add('dark')
    root.classList.remove('light', 'warm')
    return () => {
      if (previousTheme) root.dataset.theme = previousTheme
      else delete root.dataset.theme
      if (previousPreference) root.dataset.themePreference = previousPreference
      else delete root.dataset.themePreference
      root.style.colorScheme = previousColorScheme
    }
  }, [])
}

function noopKeyDown(_event: KeyboardEvent<HTMLTextAreaElement>) {}

const thinkingMessages: WorkflowMessageBlock[] = [
  {
    id: 'fixture-thinking',
    user: '第二条开始了',
    userContent: [{ type: 'text', text: '第二条开始了' }],
    status: 'running',
    activity: 'thinking',
    startedAt: Date.now() - 4_000,
    durationMs: null,
    items: [],
  },
]

const runningMessages: WorkflowMessageBlock[] = [
  {
    id: 'fixture-running',
    user: '继续扣，我要让我的 agent 在显示层和 Codex 一模一样',
    userContent: [{ type: 'text', text: '继续扣，我要让我的 agent 在显示层和 Codex 一模一样' }],
    status: 'running',
    activity: 'running',
    startedAt: baseTime,
    durationMs: null,
    items: [
      {
        type: 'commandExecution',
        id: 'cmd-read',
        command: 'Get-Content -Path src/renderer/src/components/workflow-chat/turn-layout.ts -TotalCount 260',
        status: 'completed',
        output: { text: 'Output:\nexport function workflowActivitySummaryLabel(...)', truncated: false },
      },
      {
        type: 'commandExecution',
        id: 'cmd-folder',
        command: 'New-Item -ItemType Directory -Path src/renderer/src/components/workflow-chat/fixtures',
        status: 'inProgress',
      },
      {
        type: 'fileChange',
        id: 'patch-running',
        status: 'running',
        changes: [
          {
            path: 'src/renderer/src/components/workflow-chat/turn-layout.ts',
            kind: 'edit',
            diff: {
              text: [
                '@@',
                ' const summary = emptyActivitySummary()',
                '+summary.runningFolderCreateCount += 1',
                '+summary.runningCommandCount += 1',
                '-summary.commandCount += 1',
              ].join('\n'),
              truncated: false,
            },
          },
        ],
      },
      {
        type: 'permissionRequest',
        id: 'permission-running',
        toolName: 'apply_patch',
        reason: JSON.stringify({ file: 'src/renderer/src/components/workflow-chat/turn-layout.ts', action: 'edit' }),
        status: 'pending',
        timeoutMs: 60_000,
      },
      {
        type: 'commandExecution',
        id: 'cmd-stopped',
        command: 'npm run dev',
        status: 'interrupted',
        output: { text: 'Output:\nStopped by user.', truncated: false },
      },
    ],
  },
]

const completedMessages: WorkflowMessageBlock[] = [
  {
    id: 'fixture-complete',
    user: '还有一些中间态，我们有吗？',
    userContent: [{ type: 'text', text: '还有一些中间态，我们有吗？' }],
    status: 'completed',
    activity: 'done',
    startedAt: baseTime - 60_000,
    completedAt: baseTime,
    durationMs: 42_000,
    usage: {
      inputTokens: 1800,
      outputTokens: 640,
      totalTokens: 2440,
      limitTokens: 128000,
    },
    items: [
      {
        type: 'commandExecution',
        id: 'cmd-1',
        command: 'rg -n "workflow-activity-row" src/renderer/src/components/workflow-chat',
        status: 'completed',
        output: { text: 'Output:\nActivityRow.tsx:28: workflow-activity-row', truncated: false },
      },
      {
        type: 'commandExecution',
        id: 'cmd-2',
        command: 'npm run typecheck:web',
        status: 'completed',
        output: { text: 'Output:\n> tsc --noEmit -p tsconfig.web.json', truncated: false },
      },
      {
        type: 'fileChange',
        id: 'patch-complete',
        status: 'completed',
        changes: [
          {
            path: 'src/renderer/src/components/workflow-chat/ActivityGroup.tsx',
            kind: 'edit',
            diff: { text: '+<InlineDiffStats added={added} removed={removed} />\n-<span />', truncated: false },
          },
        ],
      },
      {
        type: 'agentMessage',
        id: 'answer',
        text: '还有。现在补了 Codex 中间态里更细的运行状态：创建文件夹、等待批准、停止命令，以及动态 patch 增删统计。',
      },
    ],
  },
]

const completedReadThread = workflowMessagesToWorkflowReadThreadResponse(completedMessages, {
  threadId: 'codex-shell-read-thread-fixture',
  title: 'Codex shell read-thread fixture',
  preview: completedMessages[0]?.user ?? '',
  cwd: null,
  createdAt: completedMessages[0]?.startedAt ?? null,
  updatedAt: completedMessages[0]?.completedAt ?? null,
})
