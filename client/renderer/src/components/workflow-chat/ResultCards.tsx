import { useState } from 'react'
import { ChevronDown, FileText, Globe2, Image as ImageIcon, RefreshCw } from 'lucide-react'
import type { WorkflowTurnItem as WorkflowStreamItem } from '../../../../shared/adapters/workflow-messages-to-read-thread'
import { itemInputText, itemOutputText } from './item-text'
import { WorkflowImageLightbox, type WorkflowImagePreview } from './ImageLightbox'
import { workflowStatusIsRunning } from './turn-collapse-rules'

type ProcessItem = Exclude<WorkflowStreamItem, { type: 'agentMessage' | 'userMessage' }>
type FileChangeItemModel = Extract<WorkflowStreamItem, { type: 'fileChange' }>
type ToolLikeItem = Exclude<ProcessItem, Extract<WorkflowStreamItem, { type: 'reasoning' }> | FileChangeItemModel>
type DiffLine = { kind: 'add' | 'remove' | 'meta' | 'context'; prefix: string; text: string }
type FileEditSummary = { path: string; added: number; removed: number }
type ImagePreviewData = { id: string; title: string; subtitle: string; src: string }

interface Props {
  items: ProcessItem[]
}

export function WorkflowResultCards({ items }: Props) {
  const [previewImage, setPreviewImage] = useState<WorkflowImagePreview | null>(null)
  const visibleFiles = items.filter((item): item is FileChangeItemModel => item.type === 'fileChange' && item.changes.length > 0)
  const browserItem = items.find(item => item.type === 'webSearch' || (item.type === 'dynamicToolCall' && resultToolName(item) === 'js'))
  const imagePreviews = imagePreviewData(items)

  if (!visibleFiles.length && !browserItem && !imagePreviews.length) return null

  return (
    <>
      <div className="mt-4 space-y-2">
        {browserItem ? <BrowserPreviewCard item={browserItem} /> : null}
        {imagePreviews.map(image => <ImagePreviewCard key={image.id} image={image} onOpenImage={setPreviewImage} />)}
        {visibleFiles.length ? <EditSummaryCard items={visibleFiles} /> : null}
      </div>
      <WorkflowImageLightbox image={previewImage} onClose={() => setPreviewImage(null)} />
    </>
  )
}

function ImagePreviewCard({
  image,
  onOpenImage,
}: {
  image: ImagePreviewData
  onOpenImage: (image: WorkflowImagePreview) => void
}) {
  const name = image.subtitle || image.title

  return (
    <div className="result-card workflow-result-card overflow-hidden rounded-lg border border-line bg-surface shadow-sm" data-kind="result-card" data-result-kind="image">
      <div className="flex min-h-[58px] items-center gap-3 px-3 py-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-muted-soft text-text-muted">
          <ImageIcon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium leading-5 text-text-strong">{image.title}</div>
          <div className="truncate text-[13px] leading-5 text-text-subtle">{image.subtitle}</div>
        </div>
      </div>
      <div className="border-t border-line bg-muted-soft/40 p-2.5">
        <button
          type="button"
          className="block max-w-full cursor-zoom-in rounded-md p-0 text-left"
          title="打开图片预览"
          aria-label={`打开图片预览：${name}`}
          onClick={() => onOpenImage({ src: image.src, name })}
        >
          <img
            src={image.src}
            alt={image.title}
            className="max-h-[360px] max-w-full rounded-md object-contain"
          />
        </button>
      </div>
    </div>
  )
}

function imagePreviewData(items: ProcessItem[]): ImagePreviewData[] {
  return items.flatMap(item => {
    if (item.type === 'imageView' && item.path) {
      return [{
        id: item.id,
        title: '图片预览',
        subtitle: basename(item.path),
        src: imageSource(item.path),
      }]
    }

    if (item.type === 'imageGeneration') {
      const resultPath = typeof item.result === 'string' ? item.result : ''
      const src = imageSource(item.savedPath || resultPath)
      if (!src) return []
      return [{
        id: item.id,
        title: workflowStatusIsRunning(item.status) ? '正在生成图片' : '已生成图片',
        subtitle: item.savedPath ? basename(item.savedPath) : '生成结果',
        src,
      }]
    }

    return []
  })
}

function BrowserPreviewCard({ item }: { item: ProcessItem }) {
  const { title, subtitle } = browserPreviewInfo(item)

  return (
    <div className="result-card workflow-result-card flex min-h-[58px] items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2.5 shadow-sm" data-kind="result-card" data-result-kind="preview">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-muted-soft text-accent">
        <Globe2 className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-medium leading-5 text-text-strong">{title}</div>
        <div className="truncate text-[13px] leading-5 text-text-subtle">{subtitle}</div>
      </div>
      <button type="button" className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-line bg-surface px-2.5 text-[12px] text-text-normal shadow-sm">
        打开方式
        <ChevronDown className="h-3.5 w-3.5 text-text-subtle" />
      </button>
    </div>
  )
}

function browserPreviewInfo(item: ProcessItem): { title: string; subtitle: string } {
  const input = itemInputText(item)
  const output = itemOutputText(item)

  for (const text of [output, input]) {
    const parsed = parseJsonRecord(text)
    const title = stringFromRecord(parsed, ['title', 'pageTitle', 'name'])
    const url = stringFromRecord(parsed, ['url', 'href'])
    if (title) return { title, subtitle: hostLabel(url) || '网站' }
    if (url) return { title: hostLabel(url) || '网页预览', subtitle: '网站' }
  }

  return { title: '网页预览', subtitle: '网站' }
}

function EditSummaryCard({ items }: { items: FileChangeItemModel[] }) {
  const summaries = fileEditSummaries(items)
  const stats = summaries.reduce(
    (total, file) => ({ added: total.added + file.added, removed: total.removed + file.removed }),
    { added: 0, removed: 0 }
  )
  const singleFile = summaries.length === 1
  const title = singleFile ? `已编辑 ${basename(summaries[0].path)}` : `已编辑 ${Math.max(summaries.length, items.length)} 个文件`

  return (
    <div className="result-card workflow-result-card overflow-hidden rounded-lg border border-line bg-surface shadow-sm" data-kind="result-card" data-result-kind="diff">
      <div className="flex min-h-[58px] items-center gap-3 px-3 py-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-muted-soft text-text-muted">
          <FileText className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium leading-5 text-text-strong">{title}</div>
          <div className="flex gap-1.5 font-mono text-[12px] leading-5">
            <span className="text-accent">+{stats.added}</span>
            <span className="text-danger">-{stats.removed}</span>
          </div>
        </div>
        <button type="button" className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[12px] text-text-normal">
          撤销
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
        <button type="button" className="inline-flex h-7 shrink-0 items-center rounded-md border border-line bg-surface px-2.5 text-[12px] text-text-normal shadow-sm">
          审核
        </button>
      </div>
      {!singleFile && summaries.length ? (
        <div className="border-t border-line bg-surface">
          {summaries.slice(0, 4).map(file => (
            <div key={file.path} className="workflow-result-file-row grid min-h-8 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 text-[12px]">
              <span className="truncate text-text-normal">{file.path}</span>
              <span className="font-mono text-[12px]">
                <span className="text-accent">+{file.added}</span>
                <span className="ml-1.5 text-danger">-{file.removed}</span>
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function fileEditSummaries(items: FileChangeItemModel[]): FileEditSummary[] {
  const files = new Map<string, DiffLine[]>()

  for (const item of items) {
    for (const change of item.changes) {
      if (!change.path) continue
      const patch = patchForFile(change.diff?.text ?? '', change.path)
      const lines = patchPreviewLines(patch)
      files.set(change.path, [...(files.get(change.path) ?? []), ...lines])
    }
  }

  return Array.from(files.entries()).map(([path, lines]) => {
    const stats = patchStats(lines)
    return { path, added: stats.added, removed: stats.removed }
  })
}

function patchPreviewLines(patch: string): DiffLine[] {
  if (!patch.trim()) return []

  const rawLines = patch
    .replace(/\r/g, '')
    .split('\n')
    .filter(line => {
      if (!line.trim()) return false
      if (line === '*** Begin Patch' || line === '*** End Patch') return false
      return true
    })
  return rawLines.map(diffLineFromPatchLine)
}

function diffLineFromPatchLine(line: string): DiffLine {
  if (line.startsWith('+') && !line.startsWith('+++')) return { kind: 'add', prefix: '+', text: line.slice(1) }
  if (line.startsWith('-') && !line.startsWith('---')) return { kind: 'remove', prefix: '-', text: line.slice(1) }
  if (line.startsWith('*** ') || line.startsWith('@@')) return { kind: 'meta', prefix: '', text: line }
  return { kind: 'context', prefix: '', text: line.startsWith(' ') ? line.slice(1) : line }
}

function patchStats(lines: DiffLine[]): { added: number; removed: number } {
  return {
    added: lines.filter(line => line.kind === 'add').length,
    removed: lines.filter(line => line.kind === 'remove').length,
  }
}

function patchForFile(patch: string, filePath: string): string {
  if (!patch.trim()) return ''
  return applyPatchSectionForFile(patch, filePath)
    || gitDiffSectionForFile(patch, filePath)
    || patch
}

function applyPatchSectionForFile(patch: string, filePath: string): string {
  const lines = patch.replace(/\r/g, '').split('\n')
  const target = normalizePathForCompare(filePath)
  const collected: string[] = []
  let capturing = false

  for (const line of lines) {
    const match = line.match(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/)
    if (match) {
      if (capturing) break
      capturing = normalizePathForCompare(match[1]) === target
    }
    if (capturing) collected.push(line)
  }

  return collected.join('\n')
}

function gitDiffSectionForFile(patch: string, filePath: string): string {
  const lines = patch.replace(/\r/g, '').split('\n')
  const target = normalizePathForCompare(filePath)
  const collected: string[] = []
  let capturing = false

  for (const line of lines) {
    const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/)
    if (match) {
      if (capturing) break
      capturing = normalizePathForCompare(match[2]) === target || normalizePathForCompare(match[1]) === target
    }
    if (capturing) collected.push(line)
  }

  return collected.join('\n')
}

function normalizePathForCompare(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^["']|["']$/g, '').trim()
}

function imageSource(value: string): string {
  const source = value.trim()
  if (!source) return ''
  if (/^(file|https?|data:image\/):/i.test(source)) return source
  if (/^[A-Za-z0-9+/=\s]+$/.test(source) && source.length > 120) {
    return `data:image/png;base64,${source.replace(/\s/g, '')}`
  }
  return localImageSrc(source)
}

function localImageSrc(path: string): string {
  if (/^(file|https?):\/\//i.test(path)) return path
  return `file:///${path.replace(/\\/g, '/')}`
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  if (!value.trim()) return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function stringFromRecord(record: Record<string, unknown> | null, keys: string[]): string {
  if (!record) return ''
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function hostLabel(value: string): string {
  if (!value.trim()) return ''
  try {
    return new URL(value).host
  } catch {
    return value.replace(/^https?:\/\//i, '').split('/')[0] ?? ''
  }
}

function resultToolName(item: ToolLikeItem): string {
  if (item.type === 'dynamicToolCall') return item.tool.toLowerCase()
  if (item.type === 'webSearch') return 'web_search'
  if (item.type === 'mcpToolCall') return [item.server, item.tool].filter(Boolean).join('.') || item.tool
  if (item.type === 'collabAgentToolCall') return item.tool.toLowerCase()
  if (item.type === 'commandExecution') return 'shell_command'
  if (item.type === 'imageGeneration') return 'image_generation'
  if (item.type === 'plan') return 'plan_snapshot'
  if (item.type === 'contextCompaction') return 'context_compacted'
  if (item.type === 'enteredReviewMode') return 'entered_review_mode'
  if (item.type === 'exitedReviewMode') return 'exited_review_mode'
  if (item.type === 'hookPrompt') return 'hook_prompt'
  if (item.type === 'imageView') return 'image_view'
  if (item.type === 'unknown') return item.rawType ?? 'unknown'
  return 'unknown'
}

function basename(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath
}
