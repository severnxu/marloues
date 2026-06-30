import { useState } from 'react'
import { Image as ImageIcon } from 'lucide-react'
import type { WorkflowTurnItem as WorkflowStreamItem } from '../../../../shared/adapters/workflow-messages-to-read-thread'
import { itemInputText, itemOutputText } from './item-text'
import { WorkflowActivityRow, WorkflowActivityStatusBadge, WorkflowInlineDots } from './ActivityRow'
import { workflowStatusIsRunning } from './turn-collapse-rules'

type ImageGenerationItem = Extract<WorkflowStreamItem, { type: 'imageGeneration' }>
type ImageGenerationDetailData = { prompt: string; status: string; hasResult: boolean; resultBytes?: number }

export function WorkflowImageGenerationRow({ item }: { item: ImageGenerationItem }) {
  const [open, setOpen] = useState(false)
  const input = itemInputText(item)
  const output = itemOutputText(item)
  const hasDetail = Boolean(input || output)
  const status = item.status ?? 'completed'
  const running = workflowStatusIsRunning(status)
  const failed = status === 'error' || status === 'failed'

  return (
    <WorkflowActivityRow
      activityKind="imageGeneration"
      icon={<ImageIcon className="h-3.5 w-3.5 flex-shrink-0" />}
      label={(
        <>
          {imageGenerationLabel(item)}
          {running ? <WorkflowInlineDots /> : null}
          {running || failed ? <WorkflowActivityStatusBadge failed={failed} /> : null}
        </>
      )}
      hasDetail={hasDetail}
      open={open}
      onToggle={() => setOpen(value => !value)}
      detail={(
        <div className="ml-[24px] mt-1">
          <ImageGenerationDetail item={item} failed={failed} />
        </div>
      )}
    />
  )
}

function ImageGenerationDetail({ item, failed }: { item: ImageGenerationItem; failed: boolean }) {
  const input = itemInputText(item)
  const output = cleanDetailOutput(itemOutputText(item))
  const data = parseImageGenerationDetail(input, output)
  const showOutput = output && !data

  return (
    <div className="workflow-tool-card">
      <div className="workflow-tool-card-title">Image generation</div>
      <div className="workflow-tool-card-body">
        {data ? <ImageGenerationStructuredDetail data={data} /> : null}
        {!data && input ? <DetailBlock label="Prompt" value={input} /> : null}
        {showOutput ? <DetailBlock label={failed ? 'Error' : 'Output'} value={output} danger={failed} /> : null}
        {!data && !input && !showOutput ? <div className="workflow-tool-empty">无输出</div> : null}
      </div>
      <div className={`workflow-tool-status ${failed ? 'danger' : ''}`}>{failed ? '失败' : workflowStatusIsRunning(item.status) ? '运行中' : '成功'}</div>
    </div>
  )
}

function ImageGenerationStructuredDetail({ data }: { data: ImageGenerationDetailData }) {
  return (
    <div className="workflow-tool-section">
      <div className="workflow-tool-primary">{data.hasResult ? 'Image generated' : 'Generating image'}</div>
      <div className="workflow-tool-muted">
        {[data.status, data.resultBytes ? formatBytes(data.resultBytes) : ''].filter(Boolean).join(' / ')}
      </div>
      {data.prompt ? <pre className="workflow-tool-pre">{data.prompt}</pre> : null}
    </div>
  )
}

function imageGenerationLabel(item: ImageGenerationItem): string {
  if (workflowStatusIsRunning(item.status)) return '正在生成图片'
  if (item.status === 'error' || item.status === 'failed') return '失败：生成图片'
  return '已生成图片'
}

function parseImageGenerationDetail(input: string, output: string): ImageGenerationDetailData | null {
  const data: ImageGenerationDetailData = { prompt: '', status: '', hasResult: false }

  for (const value of [input, output]) {
    if (!value.trim()) continue
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>
      if (!data.prompt && typeof parsed.prompt === 'string') data.prompt = parsed.prompt
      if (!data.status && typeof parsed.status === 'string') data.status = parsed.status
      if (typeof parsed.has_result === 'boolean') data.hasResult = parsed.has_result
      if (typeof parsed.result_bytes === 'number') data.resultBytes = parsed.result_bytes
    } catch {
      if (!data.prompt) data.prompt = value.trim()
    }
  }

  if (!data.prompt && !data.status && !data.hasResult) return null
  return data
}

function DetailBlock({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="workflow-tool-section">
      <div className="workflow-tool-label">{label}</div>
      <pre className={`workflow-tool-pre ${danger ? 'danger' : ''}`}>{value}</pre>
    </div>
  )
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

function formatBytes(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) return ''
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}
