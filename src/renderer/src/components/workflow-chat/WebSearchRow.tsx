import { useState } from 'react'
import { ExternalLink, Search } from 'lucide-react'
import type { WorkflowTurnItem as WorkflowStreamItem } from '../../../../shared/adapters/workflow-messages-to-read-thread'
import { itemInputText, itemOutputText } from './item-text'
import { WorkflowActivityRow, WorkflowActivityStatusBadge, WorkflowInlineDots } from './ActivityRow'
import { workflowStatusIsRunning } from './turn-collapse-rules'

type WebSearchItem = Extract<WorkflowStreamItem, { type: 'webSearch' }>
type WebSearchDetailData = { type: string; query: string; url: string; queries: string[] }

export function WorkflowWebSearchRow({ item }: { item: WebSearchItem }) {
  const [open, setOpen] = useState(false)
  const input = itemInputText(item)
  const output = itemOutputText(item)
  const hasDetail = Boolean(input || output)
  const status = item.status ?? 'completed'
  const running = workflowStatusIsRunning(status)
  const failed = status === 'error' || status === 'failed'

  return (
    <WorkflowActivityRow
      activityKind="webSearch"
      icon={<Search className="h-3.5 w-3.5 flex-shrink-0" />}
      label={(
        <>
          {webSearchLabel(item)}
          {running ? <WorkflowInlineDots /> : null}
          {running || failed ? <WorkflowActivityStatusBadge failed={failed} /> : null}
        </>
      )}
      hasDetail={hasDetail}
      open={open}
      onToggle={() => setOpen(value => !value)}
      detail={<WebSearchDetail item={item} failed={failed} status={status} />}
    />
  )
}

function WebSearchDetail({ item, failed, status }: { item: WebSearchItem; failed: boolean; status: string }) {
  const input = itemInputText(item)
  const output = cleanDetailOutput(itemOutputText(item))
  const data = parseWebSearchDetail(input, output)
  const primary = data?.url || data?.query || data?.queries[0] || input || output

  return (
    <div className="workflow-web-card ml-[24px] mt-1.5">
      <div className="workflow-web-card-title">
        <span>{data?.type === 'open_page' ? 'Open page' : 'Web search'}</span>
        {data?.url ? <ExternalLink className="h-3 w-3" /> : null}
      </div>
      <div className="workflow-web-card-body">
        {primary ? <div className="workflow-web-primary">{primary}</div> : <div className="workflow-web-empty">无详情</div>}
        {data && data.queries.length > 1 ? (
          <div className="workflow-web-query-list">
            {data.queries.map(query => <div key={query} className="truncate">{query}</div>)}
          </div>
        ) : null}
        {!data && output && output !== primary ? <pre className={`workflow-web-output ${failed ? 'danger' : ''}`}>{output}</pre> : null}
      </div>
      <div className={`workflow-web-status ${failed ? 'danger' : ''}`}>
        {workflowStatusIsRunning(status) ? '搜索中' : failed ? '失败' : '完成'}
      </div>
    </div>
  )
}

function webSearchLabel(item: WebSearchItem): string {
  const input = itemInputText(item)
  const openedPage = input.includes('"type": "open_page"')
  const label = openedPage ? '已打开页面' : '已搜索网页'
  if (workflowStatusIsRunning(item.status)) return label.replace(/^已/, '正在')
  if (item.status === 'error' || item.status === 'failed') return `失败：${label}`
  return label
}

function parseWebSearchDetail(input: string, output: string): WebSearchDetailData | null {
  const merged: WebSearchDetailData = { type: '', query: '', url: '', queries: [] }

  for (const value of [input, output]) {
    if (!value.trim()) continue
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>
      if (!merged.type && typeof parsed.type === 'string') merged.type = parsed.type
      if (!merged.query && typeof parsed.query === 'string') merged.query = parsed.query
      if (!merged.url && typeof parsed.url === 'string') merged.url = parsed.url
      if (Array.isArray(parsed.queries)) {
        merged.queries = parsed.queries.filter((query): query is string => typeof query === 'string')
      }
    } catch {
      if (!merged.query) merged.query = value.trim()
    }
  }

  if (!merged.type && !merged.query && !merged.url && !merged.queries.length) return null
  return merged
}

function cleanDetailOutput(output: string): string {
  if (!output) return ''
  const normalized = output.replace(/\r/g, '').trim()
  const outputIndex = normalized.indexOf('\nOutput:\n')
  if (outputIndex >= 0) return normalized.slice(outputIndex + '\nOutput:\n'.length).trim()
  return normalized
    .replace(/^Exit code:\s*-?\d+\n/i, '')
    .replace(/^Wall time:\s*.+\n/i, '')
    .replace(/^Output:\n/i, '')
    .trim()
}
