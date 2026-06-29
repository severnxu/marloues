import { ChevronDown } from 'lucide-react'
import type { TokenUsage } from '@shared/types'

interface Props {
  activity: 'thinking' | 'running' | 'responding' | 'done' | 'failed'
  duration: string
  expanded: boolean
  hasActivityItems: boolean
  canToggle?: boolean
  label: string
  tone: string
  usage?: TokenUsage
  onToggle: () => void
}

export function AssistantTurnHeader({
  activity,
  duration,
  expanded,
  hasActivityItems,
  canToggle = true,
  label,
  tone,
  usage,
  onToggle,
}: Props) {
  const interactive = canToggle && hasActivityItems

  return (
    <div className="workflow-turn-header mb-3 border-b border-line pb-2">
      <button
        type="button"
        onClick={() => interactive && onToggle()}
        aria-expanded={interactive ? expanded : undefined}
        data-kind="turn-header"
        className={`workflow-turn-header-button flex h-6 max-w-full items-center gap-1.5 rounded px-0 text-left transition ${
          interactive ? 'cursor-pointer hover:text-text-muted' : 'cursor-default'
        } ${tone}`}
      >
        <span className="shrink-0">{label}</span>
        <span className="text-text-subtle">{duration}</span>
        {usage ? <TokenUsageBadge usage={usage} /> : null}
        {interactive ? (
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? '' : '-rotate-90'}`} />
        ) : null}
      </button>
    </div>
  )
}

function TokenUsageBadge({ usage }: { usage: TokenUsage }) {
  const total = usage.totalTokens ?? ((usage.inputTokens ?? 0) + (usage.outputTokens ?? 0))
  if (!total) return null
  const limit = usage.limitTokens ?? usage.modelContextWindowTokens
  const percent = limit ? Math.min(100, Math.round((total / limit) * 100)) : 0
  return (
    <span className="message-token-usage workflow-token-usage" tabIndex={0} aria-label={`Token 用量 ${total}`}>
      {formatTokenCompact(total)}
      <span className="message-token-tooltip">
        <span className="token-tooltip-title">Token 用量</span>
        {limit ? <span className="token-tooltip-bar"><span style={{ width: `${percent}%` }} /></span> : null}
        <span className="token-tooltip-rows">
          <span className="token-tooltip-row"><span>输入</span><strong>{usage.inputTokens ?? 0}</strong></span>
          <span className="token-tooltip-row"><span>输出</span><strong>{usage.outputTokens ?? 0}</strong></span>
          {usage.cacheReadInputTokens ? <span className="token-tooltip-row"><span>缓存读取</span><strong>{usage.cacheReadInputTokens}</strong></span> : null}
          <span className="token-tooltip-row"><span>总计</span><strong>{total}</strong></span>
          {limit ? <span className="token-tooltip-row"><span>上下文</span><strong>{percent}%</strong></span> : null}
        </span>
      </span>
    </span>
  )
}

function formatTokenCompact(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`
  return String(tokens)
}
