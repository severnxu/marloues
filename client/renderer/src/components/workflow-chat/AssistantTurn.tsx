import { useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  Check,
  Copy,
  Gauge,
  RefreshCw,
  Trash2,
  Wrench,
  Zap,
} from 'lucide-react'
import { AssistantTurnHeader } from './AssistantTurnHeader'
import { WorkflowAgentFlowSection } from './AgentFlowSection'
import { WorkflowActivityRenderer } from './ActivityRenderer'
import { WorkflowResultCards } from './ResultCards'
import type { TokenUsage } from '@shared/types'
import type { WorkflowMessageBlock } from '../../../../shared/adapters/workflow-messages-to-read-thread'
import type { WorkflowTurnLayout } from './turn-layout'
import type { WorkflowTurnPresentation } from './turn-presentation'

interface Props {
  activity: WorkflowMessageBlock['activity']
  duration: string
  expanded: boolean
  hasActivityItems: boolean
  isLastStreaming: boolean
  isRunning?: boolean
  label: string
  layout: WorkflowTurnLayout
  messageId: string
  modelName?: string
  presentation: WorkflowTurnPresentation
  createdAt?: number
  showFooterMetadata?: boolean
  tone: string
  usage?: WorkflowMessageBlock['usage']
  onToggle: () => void
  onCopy?: (text: string) => void | Promise<void>
  onRegenerate?: () => void
  onDelete?: (id: string) => void
}

export function WorkflowAssistantTurn({
  activity,
  duration,
  expanded,
  hasActivityItems,
  isLastStreaming,
  isRunning = isLastStreaming,
  label,
  layout,
  messageId,
  modelName,
  presentation,
  createdAt,
  showFooterMetadata = true,
  tone,
  usage,
  onToggle,
  onCopy,
  onRegenerate,
  onDelete,
}: Props) {
  const [copied, setCopied] = useState(false)
  const footerModelName = showFooterMetadata && modelName && modelName !== 'Marloues' ? modelName : undefined

  const handleCopy = async () => {
    if (!onCopy || !layout.finalText) return
    try {
      await onCopy(layout.finalText)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }
  const renderAssistantFlowMessage = (item: Extract<WorkflowMessageBlock['items'][number], { type: 'agentMessage' }>) => {
    if (activity === 'failed' && !isLastStreaming && item.text.trim() === layout.finalText.trim()) {
      return <MessageErrorCard key={item.id} message={item.text} />
    }
    return <WorkflowActivityRenderer key={item.id} kind="assistantMessage" item={item} />
  }

  return (
    <div className="group relative" data-kind="assistant-turn">
      {presentation.showHeader ? (
        <AssistantTurnHeader
          activity={activity}
          duration={duration}
          expanded={expanded}
          hasActivityItems={hasActivityItems}
          canToggle={!isLastStreaming}
          label={label}
          tone={tone}
          onToggle={onToggle}
        />
      ) : null}

      {layout.leadingFlow.length ? (
        <WorkflowAgentFlowSection
          entries={layout.leadingFlow}
          expanded={expanded}
          renderActivityGroup={(group, defaultDetailExpanded) => (
            <WorkflowActivityRenderer
              key={group.id}
              kind="activityGroup"
              group={group}
              defaultDetailExpanded={defaultDetailExpanded}
              expanded={expanded}
            />
          )}
          renderActivityItem={item => <WorkflowActivityRenderer key={item.id} kind="activityItem" item={item} />}
          renderAssistantMessage={renderAssistantFlowMessage}
          renderDynamicToolGroup={group => <WorkflowActivityRenderer key={group.id} kind="dynamicToolGroup" group={group} />}
        />
      ) : null}

      {layout.trailingFlow.length ? (
        <WorkflowAgentFlowSection
          entries={layout.trailingFlow}
          expanded={expanded}
          renderActivityGroup={(group, defaultDetailExpanded) => (
            <WorkflowActivityRenderer
              key={group.id}
              kind="activityGroup"
              group={group}
              defaultDetailExpanded={defaultDetailExpanded}
              expanded={expanded}
            />
          )}
          renderActivityItem={item => <WorkflowActivityRenderer key={item.id} kind="activityItem" item={item} />}
          renderAssistantMessage={renderAssistantFlowMessage}
          renderDynamicToolGroup={group => <WorkflowActivityRenderer key={group.id} kind="dynamicToolGroup" group={group} />}
        />
      ) : null}

      <WorkflowResultCards items={layout.resultItems} />

      {!isRunning && (layout.finalText || footerModelName) ? (
        <div className="message-footer">
          <div className="assistant-actions">
            {layout.finalText && onCopy ? (
              <IconAction
                title={copied ? '已复制' : '复制回复'}
                label={copied ? '已复制' : '复制'}
                onClick={() => void handleCopy()}
                icon={copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              />
            ) : null}
            {layout.finalText && onRegenerate ? (
              <IconAction
                title="重试上一条用户消息"
                label="重试"
                onClick={() => onRegenerate()}
                icon={<RefreshCw className="h-3.5 w-3.5" />}
              />
            ) : null}
            {layout.finalText && onDelete ? (
              <IconAction
                title="删除"
                label="删除"
                onClick={() => onDelete(messageId)}
                danger
                icon={<Trash2 className="h-3.5 w-3.5" />}
              />
            ) : null}
          </div>
          {footerModelName ? (
            <div className="message-model">
              <Zap size={10} />
              <span>通过 {footerModelName}</span>
              {usage ? <TokenUsageIndicator usage={usage} /> : null}
              {createdAt ? <time>{formatMessageTime(createdAt)}</time> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {presentation.showThinkingPlaceholder ? (
        <ThinkingStatusRow label={presentation.statusLabel} visible={presentation.thinkingVisible ?? true} />
      ) : null}
    </div>
  )
}

function MessageErrorCard({ message }: { message: string }) {
  const guidance = classifyError(message)
  const primary = splitErrorPrimary(message)
  const [copied, setCopied] = useState(false)

  const copyDetails = async () => {
    try {
      await copyToClipboard(message)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="message-error-card" role="alert">
      <button
        type="button"
        className="message-error-copy"
        onClick={() => void copyDetails()}
        title={copied ? '已复制' : '复制错误详情'}
        aria-label={copied ? '已复制错误详情' : '复制错误详情'}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
      <div className="message-error-head">
        <AlertTriangle size={16} />
        <div>
          <strong>{guidance.title}</strong>
          <span>{guidance.summary}</span>
        </div>
      </div>
      {primary ? <p className="message-error-primary">{primary}</p> : null}
      <div className="message-error-actions">
        <ul>
          {guidance.actions.map(action => <li key={action}>{action}</li>)}
        </ul>
      </div>
      {guidance.toolHint ? (
        <p className="message-error-toolhint">
          <Wrench size={13} />
          {guidance.toolHint}
        </p>
      ) : null}
    </div>
  )
}

function classifyError(message: string): { title: string; summary: string; actions: string[]; toolHint?: string } {
  const text = message.toLowerCase()

  if (/2056|usage limit exceeded|token plan|insufficient balance|1008|quota|billing|balance/.test(text)) {
    return {
      title: 'Token Plan 不可用',
      summary: '模型端点已响应，但当前账号没有可用的生成资源。',
      actions: ['续费或等待资源窗口恢复。', '临时切换到仍有额度的模型或 provider。', '在设置里测试当前 Endpoint，确认恢复后再重试。'],
    }
  }

  if (/invalid setting source|process exited with code 1|setting source/.test(text)) {
    return {
      title: 'Agent 启动失败',
      summary: '子进程在进入对话前退出，通常是启动参数或本地配置不被运行时接受。',
      actions: ['查看诊断包里的 runtime stderr。', '临时关闭最近新增的 MCP 服务后重试。', '确认运行配置只使用当前 runtime 支持的设置来源。'],
      toolHint: '如果刚改过策略或配置合并逻辑，先跑一次 runtime smoke test。',
    }
  }

  if (/401|403|unauthorized|forbidden|auth|api key|permission|credential/.test(text)) {
    return {
      title: '网关鉴权失败',
      summary: '模型端点可达，但当前凭据或权限没有通过。',
      actions: ['检查当前 Endpoint Profile 的 Base URL 和 Token。', '确认网关侧已给当前模型和账号授权。', '切换到测试 provider，验证是否为单端点问题。'],
    }
  }

  if (/model|not found|does not exist|unknown model/.test(text)) {
    return {
      title: '模型不可用',
      summary: '请求已到达 provider，但模型 ID 或路由目标不匹配。',
      actions: ['核对默认模型 ID 是否与网关声明一致。', '在模型选择器里切换到可用模型后重试。', '让网关侧确认该模型已发布到当前环境。'],
    }
  }

  if (/mcp|tools\/list|initialize|json-rpc|enoent|timed out|timeout|spawn/.test(text)) {
    return {
      title: 'MCP 工具启动异常',
      summary: '工具服务没有按预期完成初始化或返回结果。',
      actions: ['检查 MCP 命令、参数和工作目录。', '确认工具只在 stdout 输出 MCP 协议内容。', '先禁用异常 MCP，再逐个恢复验证。'],
      toolHint: '右侧任务面板会显示最近工具调用和错误输出。',
    }
  }

  if (/workspace|cwd|directory|path/.test(text)) {
    return {
      title: '工作区不可用',
      summary: '当前任务需要一个可访问的本地目录。',
      actions: ['先选择一个项目工作区。', '确认目录仍存在，并且当前用户有读写权限。', '如果路径里有特殊字符，换一个简单路径复测。'],
    }
  }

  return {
    title: '本轮执行失败',
    summary: 'Agent 返回了错误信息，需要结合上下文继续排查。',
    actions: ['查看右侧时间线定位失败阶段。', '导出诊断包保留日志。', '简化问题或临时关闭工具后重试。'],
  }
}

function splitErrorPrimary(message: string): string {
  const normalized = message.trim()
  const [primary] = normalized.split(/\n\s*\n/)
  return primary?.trim() ?? normalized
}

async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'
  document.body.appendChild(textarea)
  textarea.select()
  try {
    document.execCommand('copy')
  } finally {
    document.body.removeChild(textarea)
  }
}

function ThinkingStatusRow({ label = '正在思考', visible }: { label?: string; visible: boolean }) {
  return (
    <div
      className={`workflow-thinking-status flex items-center gap-2 text-text-muted ${visible ? '' : 'invisible'}`}
      data-kind="activity-row"
      data-activity-kind="thinking-status"
    >
      <ThinkingDots />
      <span className="workflow-thinking-shimmer">{label}</span>
    </div>
  )
}

function ThinkingDots() {
  return (
    <span className="workflow-thinking-dots" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  )
}

function TokenUsageIndicator({ usage }: { usage: TokenUsage }) {
  return (
    <span className="message-token-usage" tabIndex={0} aria-label={`Token 用量：${formatTokenUsage(usage)}`}>
      <Gauge size={12} />
      <TokenUsageTooltip usage={usage} />
    </span>
  )
}

function TokenUsageTooltip({ usage }: { usage: TokenUsage }) {
  const contextWindow = readModelContextWindow(usage) ?? readUsageLimit(usage) ?? 200_000
  const maxOutputTokens = readMaxOutputTokens(usage)
  const total = usage.totalTokens
  const percent = total !== undefined ? Math.min(100, Math.round((total / contextWindow) * 100)) : undefined
  const rows = [
    total !== undefined
      ? { label: '已使用 / 上下文', value: `${formatTokenCount(total)} / ${formatTokenCount(contextWindow)}` }
      : contextWindow
        ? { label: '上下文', value: formatTokenCount(contextWindow) }
        : null,
    maxOutputTokens !== undefined ? { label: '最大输出', value: formatTokenCount(maxOutputTokens) } : null,
    usage.inputTokens !== undefined ? { label: '输入', value: formatTokenCount(usage.inputTokens) } : null,
    usage.outputTokens !== undefined ? { label: '输出', value: formatTokenCount(usage.outputTokens) } : null,
    usage.cacheReadInputTokens !== undefined ? { label: '缓存读取', value: formatTokenCount(usage.cacheReadInputTokens) } : null,
    usage.cacheCreationInputTokens !== undefined ? { label: '缓存写入', value: formatTokenCount(usage.cacheCreationInputTokens) } : null,
  ].filter((row): row is { label: string; value: string } => Boolean(row))

  return (
    <span className="message-token-tooltip" role="tooltip">
      <span className="token-tooltip-title">Token 用量</span>
      <span className="token-tooltip-bar" aria-hidden="true">
        <span style={{ width: `${percent ?? 46}%` }} />
      </span>
      <span className="token-tooltip-rows">
        {rows.map(row => (
          <span className="token-tooltip-row" key={row.label}>
            <span>{row.label}</span>
            <strong>{row.value}</strong>
          </span>
        ))}
      </span>
    </span>
  )
}

function formatTokenUsage(usage: TokenUsage): string {
  const parts = [
    usage.inputTokens !== undefined ? `入 ${formatTokenCount(usage.inputTokens)}` : null,
    usage.outputTokens !== undefined ? `出 ${formatTokenCount(usage.outputTokens)}` : null,
    usage.cacheCreationInputTokens !== undefined ? `缓存写 ${formatTokenCount(usage.cacheCreationInputTokens)}` : null,
    usage.cacheReadInputTokens !== undefined ? `缓存读 ${formatTokenCount(usage.cacheReadInputTokens)}` : null,
  ].filter(Boolean)
  const total = usage.totalTokens !== undefined ? `总 ${formatTokenCount(usage.totalTokens)}` : null
  return [total, ...parts].filter(Boolean).join(' · ')
}

function formatTokenCount(value: number): string {
  if (value >= 1000) {
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: value >= 10_000 ? 0 : 1 }).format(value / 1000)}K`
  }
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)
}

function readModelContextWindow(usage: TokenUsage): number | undefined {
  if (usage.modelContextWindowTokens !== undefined && Number.isFinite(usage.modelContextWindowTokens) && usage.modelContextWindowTokens > 0) {
    return usage.modelContextWindowTokens
  }
  return readRawUsageNumber(usage, ['model_context_window_tokens', 'modelContextWindowTokens', 'context_window_tokens', 'contextWindowTokens'])
}

function readMaxOutputTokens(usage: TokenUsage): number | undefined {
  if (usage.maxOutputTokens !== undefined && Number.isFinite(usage.maxOutputTokens) && usage.maxOutputTokens > 0) {
    return usage.maxOutputTokens
  }
  return readRawUsageNumber(usage, ['max_output_tokens', 'maxOutputTokens'])
}

function readUsageLimit(usage: TokenUsage): number | undefined {
  if (usage.limitTokens !== undefined && Number.isFinite(usage.limitTokens) && usage.limitTokens > 0) {
    return usage.limitTokens
  }
  return readRawUsageNumber(usage, ['max_tokens', 'maxTokens'])
}

function readRawUsageNumber(usage: TokenUsage, keys: string[]): number | undefined {
  const raw = usage.raw
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const record = raw as Record<string, unknown>
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  }
  return undefined
}

function formatMessageTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

function IconAction({ title, label, icon, danger, onClick }: { title: string; label: string; icon: ReactNode; danger?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      className={`${danger ? 'hover:text-danger' : 'hover:text-text-normal'}`}
      onClick={onClick}
      title={title}
      aria-label={title}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}
