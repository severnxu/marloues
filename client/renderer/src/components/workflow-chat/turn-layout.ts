import {
  type WorkflowMessageBlock,
  type WorkflowTurnItem as WorkflowStreamItem,
} from '../../../../shared/adapters/workflow-messages-to-read-thread'
import {
  workflowActivityGroupViewState,
  workflowIsCollapsibleActivityItem,
  workflowIsResultCardSourceItem,
  workflowItemIsRunning,
  workflowLayoutToolName,
  workflowShouldKeepSingleActivityItem,
  workflowShouldShowActivityItem,
  workflowShouldShowProcessItem,
  workflowStatusIsRunning,
  type WorkflowActivityGroupViewState,
} from './turn-collapse-rules'
import { itemInputText } from './item-text'

type AgentMessageItem = Extract<WorkflowStreamItem, { type: 'agentMessage' }>
type ProcessItem = Exclude<WorkflowStreamItem, { type: 'agentMessage' | 'userMessage' }>

export type WorkflowActivityItem = AgentMessageItem | ProcessItem
export type WorkflowActivitySummary = {
  commandCount: number
  exploredFileCount: number
  fileCreateCount: number
  fileEditCount: number
  fileDeleteCount: number
  listCount: number
  searchCount: number
  toolCount: number
  webSearchCount: number
  waitingPermissionRequestCount: number
  approvedPermissionRequestCount: number
  deniedPermissionRequestCount: number
  runningCount: number
  runningCommandCount: number
  runningExploredFileCount: number
  runningFileCreateCount: number
  runningFileEditCount: number
  runningFileDeleteCount: number
  runningFolderCreateCount: number
  runningListCount: number
  runningSearchCount: number
  runningToolCount: number
  runningWebSearchCount: number
  runningWrittenLineCount: number
  addedLineCount: number
  removedLineCount: number
  runningAddedLineCount: number
  runningRemovedLineCount: number
}

export type WorkflowActivityGroup = {
  id: string
  items: ProcessItem[]
  summary: WorkflowActivitySummary
}

export type WorkflowFlowEntry =
  | { kind: 'assistantMessage'; item: AgentMessageItem; isFinal: boolean }
  | { kind: 'activityItem'; item: ProcessItem }
  | { kind: 'dynamicToolGroup'; group: WorkflowActivityGroup }
  | { kind: 'activityGroup'; group: WorkflowActivityGroup }

export type WorkflowTurnLayout = {
  leadingFlow: WorkflowFlowEntry[]
  trailingFlow: WorkflowFlowEntry[]
  leadingActivityItems: ProcessItem[]
  trailingActivityItems: ProcessItem[]
  resultItems: ProcessItem[]
  finalText: string
}

export { workflowActivityGroupViewState }
export type { WorkflowActivityGroupViewState }

type WorkflowTurnLayoutOptions = {
  hideReasoning?: boolean
}

export function workflowTurnLayout(message: WorkflowMessageBlock, options: WorkflowTurnLayoutOptions = {}): WorkflowTurnLayout {
  const processItems = message.items
    .filter((item): item is ProcessItem => item.type !== 'agentMessage' && item.type !== 'userMessage')
    .filter(workflowShouldShowProcessItem)
    .filter(item => !shouldHideReasoningItem(item, options))
  const finalAgentIndexes = findFinalAgentMessageIndexes(message.items)
  const flow = workflowFlowEntries(message.items, finalAgentIndexes, options)
  const flowEntries = flow.map(entry => entry.entry)

  return {
    leadingFlow: flowEntries,
    trailingFlow: [],
    leadingActivityItems: flowActivityItems(flowEntries),
    trailingActivityItems: [],
    resultItems: processItems.filter(workflowIsResultCardSourceItem),
    finalText: finalAssistantTextFromIndexes(message.items, finalAgentIndexes),
  }
}

export function workflowActivitySummaryLabel(summary: WorkflowActivitySummary): string {
  const runningParts = workflowActivitySummaryRunningParts(summary)
  if (runningParts.length > 0) {
    return [...runningParts, ...workflowActivitySummaryCompletedParts(summary, true)].join(' · ')
  }
  return workflowActivitySummaryCompletedParts(summary, false).join(' · ')
}

function workflowActivitySummaryRunningParts(summary: WorkflowActivitySummary): string[] {
  const parts: string[] = []
  if (summary.runningExploredFileCount > 0) parts.push(`正在读取 ${summary.runningExploredFileCount} 个文件`)
  if (summary.runningSearchCount > 0) parts.push('正在搜索工作区')
  if (summary.runningListCount > 0) parts.push('正在列出文件')
  if (summary.runningFileCreateCount > 0) parts.push(`正在创建 ${summary.runningFileCreateCount} 个文件`)
  if (summary.runningWrittenLineCount > 0) parts.push(`正在编写 ${summary.runningWrittenLineCount} 行`)
  if (summary.runningFileEditCount > 0) parts.push(`正在编辑 ${summary.runningFileEditCount} 个文件`)
  if (summary.runningFileDeleteCount > 0) parts.push(`正在删除 ${summary.runningFileDeleteCount} 个文件`)
  if (summary.runningFolderCreateCount > 0) parts.push(summary.runningFolderCreateCount === 1 ? '正在创建文件夹' : `正在创建 ${summary.runningFolderCreateCount} 个文件夹`)
  if (summary.waitingPermissionRequestCount > 0) parts.push(`等待批准 ${summary.waitingPermissionRequestCount} 个请求`)
  if (summary.runningCommandCount > 0) parts.push(`正在运行 ${summary.runningCommandCount} 条命令`)
  if (summary.runningWebSearchCount > 0) parts.push(`正在搜索 ${summary.runningWebSearchCount} 次`)
  if (summary.runningToolCount > 0) parts.push(`正在使用 ${summary.runningToolCount} 个工具`)
  return parts
}

function workflowActivitySummaryCompletedParts(summary: WorkflowActivitySummary, onlyCompletedCounts: boolean): string[] {
  const commandCount = completedCount(summary.commandCount, summary.runningCommandCount + summary.runningFolderCreateCount, onlyCompletedCounts)
  const exploredFileCount = completedCount(summary.exploredFileCount, summary.runningExploredFileCount, onlyCompletedCounts)
  const fileCreateCount = completedCount(summary.fileCreateCount, summary.runningFileCreateCount, onlyCompletedCounts)
  const fileEditCount = completedCount(summary.fileEditCount, summary.runningFileEditCount, onlyCompletedCounts)
  const fileDeleteCount = completedCount(summary.fileDeleteCount, summary.runningFileDeleteCount, onlyCompletedCounts)
  const listCount = completedCount(summary.listCount, summary.runningListCount, onlyCompletedCounts)
  const searchCount = completedCount(summary.searchCount, summary.runningSearchCount, onlyCompletedCounts)
  const webSearchCount = completedCount(summary.webSearchCount, summary.runningWebSearchCount, onlyCompletedCounts)
  const toolCount = completedCount(summary.toolCount, summary.runningToolCount, onlyCompletedCounts)
  const parts: string[] = []

  if (exploredFileCount > 0) parts.push(`已读取 ${exploredFileCount} 个文件`)
  if (searchCount > 0) parts.push('已搜索工作区')
  if (listCount > 0) parts.push(`已列出 ${listCount} 次`)
  if (fileCreateCount > 0) parts.push(`已创建 ${fileCreateCount} 个文件`)
  if (fileEditCount > 0) parts.push(`已编辑 ${fileEditCount} 个文件`)
  if (fileDeleteCount > 0) parts.push(`已删除 ${fileDeleteCount} 个文件`)
  if (summary.approvedPermissionRequestCount > 0) parts.push(`已批准 ${summary.approvedPermissionRequestCount} 个请求`)
  if (summary.deniedPermissionRequestCount > 0) parts.push(`已拒绝 ${summary.deniedPermissionRequestCount} 个请求`)
  if (commandCount > 0) parts.push(`已运行 ${commandCount} 条命令`)
  if (webSearchCount > 0) parts.push(`已搜索 ${webSearchCount} 次`)
  if (toolCount > 0) parts.push(`已使用 ${toolCount} 个工具`)
  return parts
}

function completedCount(total: number, running: number, onlyCompletedCounts: boolean): number {
  return Math.max(0, onlyCompletedCounts ? total - running : total)
}

function workflowFlowEntries(
  items: WorkflowStreamItem[],
  finalAgentIndexes: Set<number>,
  options: WorkflowTurnLayoutOptions,
): Array<{ index: number; entry: WorkflowFlowEntry }> {
  const flow: Array<{ index: number; entry: WorkflowFlowEntry }> = []
  let groupItems: ProcessItem[] = []
  let groupStartIndex = -1

  const flushGroup = () => {
    if (!groupItems.length) return
    if (workflowShouldKeepSingleActivityItem(groupItems)) {
      flow.push({
        index: groupStartIndex,
        entry: { kind: 'activityItem', item: groupItems[0] },
      })
      groupItems = []
      groupStartIndex = -1
      return
    }
    flow.push({
      index: groupStartIndex,
      entry: {
        kind: 'activityGroup',
        group: {
          id: groupItems.map(item => item.id).join('-'),
          items: groupItems,
          summary: summarizeActivityItems(groupItems),
        },
      },
    })
    groupItems = []
    groupStartIndex = -1
  }

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    if (!item) continue
    if (item.type === 'userMessage') continue
    if (item.type === 'agentMessage') {
      flushGroup()
      if (item.text.trim()) flow.push({ index, entry: { kind: 'assistantMessage', item, isFinal: finalAgentIndexes.has(index) } })
      continue
    }
    if (isSilentProcessBoundary(item) && isBetweenFinalAgentRun(index, finalAgentIndexes)) {
      continue
    }
    if (!workflowShouldShowActivityItem(item)) {
      continue
    }
    if (shouldHideReasoningItem(item, options)) {
      continue
    }
    if (item.type === 'dynamicToolCall') {
      flushGroup()
      const dynamicItems = collectDynamicToolCalls(items, index)
      if (dynamicItems.length === 1) {
        flow.push({ index, entry: { kind: 'activityItem', item } })
      } else {
        flow.push({
          index,
          entry: {
            kind: 'dynamicToolGroup',
            group: {
              id: dynamicItems.map(item => item.id).join('-'),
              items: dynamicItems,
              summary: summarizeActivityItems(dynamicItems),
            },
          },
        })
        index += dynamicItems.length - 1
      }
      continue
    }
    if (!workflowIsCollapsibleActivityItem(item)) {
      flushGroup()
      flow.push({ index, entry: { kind: 'activityItem', item } })
      continue
    }

    if (workflowShouldSplitRunningToolItem(item)) {
      flushGroup()
      flow.push({ index, entry: { kind: 'activityItem', item } })
      continue
    }

    if (!groupItems.length) groupStartIndex = index
    groupItems.push(item)
  }

  flushGroup()
  return flow
}

function shouldHideReasoningItem(item: ProcessItem, options: WorkflowTurnLayoutOptions): boolean {
  return Boolean(options.hideReasoning && item.type === 'reasoning')
}

function workflowShouldSplitRunningToolItem(item: ProcessItem): boolean {
  if (!workflowItemIsRunning(item)) return false
  return item.type === 'mcpToolCall'
    || item.type === 'dynamicToolCall'
    || item.type === 'collabAgentToolCall'
}

function collectDynamicToolCalls(items: WorkflowStreamItem[], startIndex: number): Extract<ProcessItem, { type: 'dynamicToolCall' }>[] {
  const dynamicItems: Extract<ProcessItem, { type: 'dynamicToolCall' }>[] = []
  for (let index = startIndex; index < items.length; index += 1) {
    const item = items[index]
    if (item?.type !== 'dynamicToolCall' || !workflowShouldShowActivityItem(item)) break
    dynamicItems.push(item)
  }
  return dynamicItems
}

function findFinalAgentMessageIndexes(items: WorkflowStreamItem[]): Set<number> {
  const indexes = new Set<number>()
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item?.type === 'agentMessage' && item.text.trim()) {
      indexes.add(index)
      for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
        const previous = items[cursor]
        if (!previous || previous.type === 'userMessage') continue
        if (previous.type === 'agentMessage') {
          if (previous.text.trim()) indexes.add(cursor)
          continue
        }
        if (isSilentProcessBoundary(previous)) continue
        break
      }
      return indexes
    }
  }
  return indexes
}

function finalAssistantTextFromIndexes(items: WorkflowStreamItem[], indexes: Set<number>): string {
  return [...indexes]
    .sort((a, b) => a - b)
    .map(index => items[index])
    .filter((item): item is AgentMessageItem => item?.type === 'agentMessage')
    .map(item => item.text.trim())
    .filter(Boolean)
    .join('\n\n')
}

function isSilentProcessBoundary(item: Exclude<WorkflowStreamItem, AgentMessageItem | { type: 'userMessage' }>): boolean {
  if (item.type === 'contextCompaction') return true
  if (item.type === 'dynamicToolCall' || item.type === 'mcpToolCall') {
    return workflowLayoutToolName(item) === 'token_count'
      || workflowLayoutToolName(item).endsWith('.token_count')
  }
  return false
}

function isBetweenFinalAgentRun(index: number, finalAgentIndexes: Set<number>): boolean {
  if (finalAgentIndexes.size < 2) return false
  const sorted = [...finalAgentIndexes].sort((a, b) => a - b)
  return index > sorted[0] && index < sorted[sorted.length - 1]
}

function summarizeActivityItems(items: ProcessItem[]): WorkflowActivitySummary {
  const settlePendingPermissions = shouldSettlePendingPermissions(items)
  const settleStaleRunningItems = settlePendingPermissions || shouldSettleStaleRunningItems(items)
  return items.reduce<WorkflowActivitySummary>((summary, item) => {
    const running = workflowItemIsRunning(item) && !settleStaleRunningItems
    if (item.type === 'commandExecution') {
      summarizeCommandExecutionItem(summary, item, running)
    } else if (item.type === 'fileChange') {
      summarizeFileChangeItem(summary, item, running)
    } else if (item.type === 'permissionRequest') {
      summarizePermissionRequestItem(summary, item, settlePendingPermissions)
    } else if (item.type === 'webSearch') {
      summary.webSearchCount += 1
      if (running) summary.runningWebSearchCount += 1
    } else {
      summarizeToolLikeItem(summary, item, running)
    }

    if (running) summary.runningCount += 1
    return summary
  }, emptyActivitySummary())
}

function shouldSettleStaleRunningItems(items: ProcessItem[]): boolean {
  const hasDeniedPermission = items.some(item => {
    if (item.type !== 'permissionRequest') return false
    const status = item.status.toLowerCase()
    return status === 'failed' || status === 'error' || status === 'denied' || status === 'cancelled' || status === 'canceled'
  })
  if (!hasDeniedPermission) return false
  return items.some(item => {
    if (item.type === 'permissionRequest' || !('status' in item)) return false
    const status = String(item.status).toLowerCase()
    return status === 'failed' || status === 'error' || status === 'cancelled' || status === 'canceled'
  })
}

function shouldSettlePendingPermissions(items: ProcessItem[]): boolean {
  const hasPendingPermission = items.some(item => item.type === 'permissionRequest' && workflowItemIsRunning(item))
  if (!hasPendingPermission) return false
  const hasActiveNonPermissionItem = items.some(item => item.type !== 'permissionRequest' && workflowItemIsRunning(item))
  if (hasActiveNonPermissionItem) return false
  return items.some(item => {
    if (item.type === 'permissionRequest') return false
    if (!('status' in item)) return false
    const status = String(item.status).toLowerCase()
    return status === 'failed' || status === 'error' || status === 'cancelled' || status === 'canceled'
  })
}

function emptyActivitySummary(): WorkflowActivitySummary {
  return {
    commandCount: 0,
    exploredFileCount: 0,
    fileCreateCount: 0,
    fileEditCount: 0,
    fileDeleteCount: 0,
    listCount: 0,
    searchCount: 0,
    toolCount: 0,
    webSearchCount: 0,
    waitingPermissionRequestCount: 0,
    approvedPermissionRequestCount: 0,
    deniedPermissionRequestCount: 0,
    runningCount: 0,
    runningCommandCount: 0,
    runningExploredFileCount: 0,
    runningFileCreateCount: 0,
    runningFileEditCount: 0,
    runningFileDeleteCount: 0,
    runningFolderCreateCount: 0,
    runningListCount: 0,
    runningSearchCount: 0,
    runningToolCount: 0,
    runningWebSearchCount: 0,
    runningWrittenLineCount: 0,
    addedLineCount: 0,
    removedLineCount: 0,
    runningAddedLineCount: 0,
    runningRemovedLineCount: 0,
  }
}

function summarizePermissionRequestItem(
  summary: WorkflowActivitySummary,
  item: Extract<ProcessItem, { type: 'permissionRequest' }>,
  settlePending: boolean,
): void {
  const status = item.status.toLowerCase()
  if (workflowStatusIsRunning(status)) {
    if (settlePending) {
      summary.deniedPermissionRequestCount += 1
      return
    }
    summary.waitingPermissionRequestCount += 1
    return
  }
  if (status === 'failed' || status === 'error' || status === 'denied' || status === 'cancelled' || status === 'canceled') {
    summary.deniedPermissionRequestCount += 1
    return
  }
  summary.approvedPermissionRequestCount += 1
}

function summarizeToolLikeItem(summary: WorkflowActivitySummary, item: ProcessItem, running: boolean): void {
  const name = workflowLayoutToolName(item).toLowerCase()
  const input = itemInputText(item)

  if (isReadToolName(name)) {
    const count = Math.max(1, toolTargetCount(input))
    summary.exploredFileCount += count
    if (running) summary.runningExploredFileCount += count
    return
  }

  if (isListToolName(name)) {
    summary.listCount += 1
    if (running) summary.runningListCount += 1
    return
  }

  if (isSearchToolName(name)) {
    summary.searchCount += 1
    if (running) summary.runningSearchCount += 1
    return
  }

  if (isEditToolName(name)) {
    summary.fileEditCount += 1
    if (running) summary.runningFileEditCount += 1
    return
  }

  summary.toolCount += 1
  if (running) summary.runningToolCount += 1
}

function summarizeCommandExecutionItem(
  summary: WorkflowActivitySummary,
  item: Extract<ProcessItem, { type: 'commandExecution' }>,
  running: boolean,
): void {
  const commands = commandLines(item)
  for (const command of commands) {
    const kind = commandSummaryKind(command)
    if (kind === 'read') {
      summary.exploredFileCount += 1
      if (running) summary.runningExploredFileCount += 1
    } else if (kind === 'search') {
      summary.searchCount += 1
      if (running) summary.runningSearchCount += 1
    } else if (kind === 'list') {
      summary.listCount += 1
      if (running) summary.runningListCount += 1
    } else if (kind === 'folder') {
      summary.commandCount += 1
      if (running) summary.runningFolderCreateCount += 1
    } else if (kind === 'web') {
      summary.webSearchCount += 1
      if (running) summary.runningWebSearchCount += 1
    } else {
      summary.commandCount += 1
      if (running) summary.runningCommandCount += 1
    }
  }
}

function summarizeFileChangeItem(
  summary: WorkflowActivitySummary,
  item: Extract<ProcessItem, { type: 'fileChange' }>,
  running: boolean,
): void {
  if (!item.changes.length) {
    summary.fileEditCount += 1
    if (running) summary.runningFileEditCount += 1
    return
  }

  for (const change of item.changes) {
    const kind = fileChangeKind(change.kind)
    if (kind === 'create') {
      summary.fileCreateCount += 1
      if (running) summary.runningFileCreateCount += 1
    } else if (kind === 'delete') {
      summary.fileDeleteCount += 1
      if (running) summary.runningFileDeleteCount += 1
    } else {
      summary.fileEditCount += 1
      if (running) summary.runningFileEditCount += 1
    }
    const stats = patchLineStats(change.diff?.text ?? '')
    summary.addedLineCount += stats.added
    summary.removedLineCount += stats.removed
    if (running) {
      summary.runningAddedLineCount += stats.added
      summary.runningRemovedLineCount += stats.removed
      if (kind === 'create') summary.runningWrittenLineCount += stats.added
    }
  }
}

function fileChangeKind(kind: string): 'create' | 'edit' | 'delete' {
  const normalized = kind.toLowerCase()
  if (normalized.includes('create') || normalized.includes('add') || normalized.includes('new')) return 'create'
  if (normalized.includes('delete') || normalized.includes('remove') || normalized.includes('unlink')) return 'delete'
  return 'edit'
}

function patchLineStats(diff: string): { added: number; removed: number } {
  if (!diff.trim()) return { added: 0, removed: 0 }
  return diff
    .replace(/\r/g, '')
    .split('\n')
    .reduce(
      (stats, line) => {
        if (line.startsWith('+') && !line.startsWith('+++') && line !== '*** Begin Patch' && line !== '*** End Patch') stats.added += 1
        else if (line.startsWith('-') && !line.startsWith('---')) stats.removed += 1
        return stats
      },
      { added: 0, removed: 0 },
    )
}

function commandLines(item: Extract<ProcessItem, { type: 'commandExecution' }>): string[] {
  const commands = item.command.split(/\n\n+/).map(command => command.trim()).filter(Boolean)
  return commands.length ? commands : ['']
}

function commandSummaryKind(command: string): 'command' | 'folder' | 'list' | 'read' | 'search' | 'web' {
  const firstLine = command.trim().split(/\r?\n/)[0] ?? ''
  if (/^(Get-Content|gc|cat)\b/i.test(firstLine)) return 'read'
  if (/^(New-Item|mkdir|md)\b/i.test(firstLine) && /(\s-ItemType\s+Directory\b|\smkdir\b|\smd\b|^mkdir\b|^md\b)/i.test(firstLine)) return 'folder'
  if (/^(Get-ChildItem|ls|dir)\b/i.test(firstLine) || firstLine.startsWith('rg --files')) return 'list'
  if (/^(Select-String)\b/i.test(firstLine) || /^rg\s+/i.test(firstLine)) return 'search'
  if (/^(Invoke-WebRequest|Invoke-RestMethod|curl|wget)\b/i.test(firstLine)) return 'web'
  return 'command'
}

function isReadToolName(name: string): boolean {
  return name === 'read'
    || name.endsWith('.read')
    || name === 'read_file'
    || name === 'read_files'
    || name.endsWith('.read_file')
    || name.endsWith('.read_files')
}

function isListToolName(name: string): boolean {
  return name === 'list'
    || name === 'ls'
    || name.endsWith('.ls')
    || name === 'list_files'
    || name === 'get_directory_tree'
    || name.endsWith('.list_files')
}

function isSearchToolName(name: string): boolean {
  return name.includes('search') || name === 'grep' || name.endsWith('.grep')
}

function isEditToolName(name: string): boolean {
  return name.includes('apply_patch') || name.includes('patch') || name.includes('edit')
}

function toolTargetCount(input: string): number {
  if (!input.trim()) return 0
  try {
    const value = JSON.parse(input) as unknown
    if (Array.isArray(value)) return value.length
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>
      for (const key of ['paths', 'files', 'filePaths', 'file_paths']) {
        const entry = record[key]
        if (Array.isArray(entry)) return entry.length
      }
    }
  } catch {
    // Plain text inputs are common for tool arguments.
  }
  return input.split(/\r?\n/).map(line => line.trim()).filter(Boolean).length || 1
}

function flowActivityItems(entries: WorkflowFlowEntry[]): ProcessItem[] {
  return entries.flatMap(entry => {
    if (entry.kind === 'activityGroup') return entry.group.items
    if (entry.kind === 'dynamicToolGroup') return entry.group.items
    if (entry.kind === 'activityItem') return [entry.item]
    return []
  })
}
