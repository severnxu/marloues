import { useState } from 'react'
import { Brain, CircleHelp, Image as ImageIcon, ShieldQuestion, Wrench } from 'lucide-react'
import type { WorkflowTurnItem as WorkflowStreamItem } from '../../../../shared/adapters/workflow-messages-to-read-thread'
import { WorkflowActivityRow } from './ActivityRow'

export function WorkflowImageViewRow({ item }: { item: Extract<WorkflowStreamItem, { type: 'imageView' }> }) {
  return <MarkerRow icon="image" label="已查看图片" detail={basename(item.path)} activityKind="imageView" />
}

export function WorkflowReviewModeMarker({ item }: { item: Extract<WorkflowStreamItem, { type: 'enteredReviewMode' | 'exitedReviewMode' }> }) {
  return (
    <ExpandableMarkerRow
      icon="approval"
      label={item.type === 'enteredReviewMode' ? '已进入审查模式' : '已退出审查模式'}
      activityKind={item.type}
      detailLabel="Review"
      payload={item.review}
    />
  )
}

export function WorkflowHookPromptBlock({ item }: { item: Extract<WorkflowStreamItem, { type: 'hookPrompt' }> }) {
  return (
    <ExpandableMarkerRow
      icon="question"
      label="正在提问"
      activityKind="hookPrompt"
      summary={item.fragmentCount ? `${item.fragmentCount} 个片段` : undefined}
      detailLabel="Fragments"
      payload={item.fragments}
    />
  )
}

export function WorkflowContextCompactionMarker() {
  return <MarkerRow icon="reasoning" label="上下文已压缩" activityKind="contextCompaction" />
}

export function WorkflowUnknownRawJson({ item }: { item: Extract<WorkflowStreamItem, { type: 'unknown' }> }) {
  const [open, setOpen] = useState(false)

  return (
    <WorkflowActivityRow
      activityKind="unknown"
      icon={<Wrench className="h-3.5 w-3.5" />}
      label={<>未知项目 <span className="text-text-subtle">{item.rawType}</span></>}
      detail={<div className="ml-[24px] mt-1"><DetailBlock label="Raw" value={formatUnknownValue(item.raw)} muted /></div>}
      open={open}
      onToggle={() => setOpen(value => !value)}
    />
  )
}

function MarkerRow({ icon, label, detail, activityKind }: { icon: MarkerIcon; label: string; detail?: string; activityKind: string }) {
  return (
    <WorkflowActivityRow
      activityKind={activityKind}
      icon={markerIcon(icon)}
      label={<>{label}{detail ? <span className="ml-1.5 text-text-subtle">{detail}</span> : null}</>}
    />
  )
}

function ExpandableMarkerRow({
  icon,
  label,
  summary,
  detailLabel,
  payload,
  activityKind,
}: {
  icon: MarkerIcon
  label: string
  summary?: string
  detailLabel: string
  payload?: unknown
  activityKind: string
}) {
  const [open, setOpen] = useState(false)
  const value = formatOptionalDetail(payload)
  const hasDetail = Boolean(value)

  return (
    <WorkflowActivityRow
      activityKind={activityKind}
      icon={markerIcon(icon)}
      label={<>{label}{summary ? <span className="ml-1.5 text-text-subtle">{summary}</span> : null}</>}
      detail={<div className="ml-[24px] mt-1"><DetailBlock label={detailLabel} value={value} muted /></div>}
      hasDetail={hasDetail}
      open={open}
      onToggle={() => setOpen(value => !value)}
    />
  )
}

type MarkerIcon = 'approval' | 'tool' | 'reasoning' | 'image' | 'question'

function markerIcon(icon: MarkerIcon) {
  if (icon === 'approval') return <ShieldQuestion className="h-3.5 w-3.5" />
  if (icon === 'question') return <CircleHelp className="h-3.5 w-3.5" />
  if (icon === 'reasoning') return <Brain className="h-3.5 w-3.5" />
  if (icon === 'image') return <ImageIcon className="h-3.5 w-3.5" />
  return <Wrench className="h-3.5 w-3.5" />
}

function DetailBlock({ label, value, muted, danger }: { label: string; value: string; muted?: boolean; danger?: boolean }) {
  return (
    <div className="border-b border-line last:border-b-0">
      <div className="px-0 pt-1 text-[10px] font-medium uppercase tracking-wide text-text-subtle">{label}</div>
      <pre className={`m-0 max-h-52 overflow-auto whitespace-pre-wrap pb-2 pt-1 font-mono text-[11px] leading-5 ${
        danger ? 'text-danger' : muted ? 'text-text-muted' : 'text-text-normal'
      }`}>
        {value}
      </pre>
    </div>
  )
}

function formatUnknownValue(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function formatOptionalDetail(value: unknown): string {
  if (value === undefined || value === null || value === '') return ''
  return formatUnknownValue(value)
}

function basename(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath
}
