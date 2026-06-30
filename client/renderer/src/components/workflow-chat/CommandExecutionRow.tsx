import { useState } from 'react'
import { Check, Copy, FileText, FolderTree, Search, SquareTerminal } from 'lucide-react'
import type { WorkflowTurnItem as WorkflowStreamItem } from '../../../../shared/adapters/workflow-messages-to-read-thread'
import { WorkflowActivityRow, WorkflowActivityStatusBadge, WorkflowInlineDots } from './ActivityRow'
import { workflowStatusIsRunning } from './turn-collapse-rules'

type CommandItemModel = Extract<WorkflowStreamItem, { type: 'commandExecution' }>

interface Props {
  item: CommandItemModel
}

export function WorkflowCommandExecutionRow({ item }: Props) {
  const [open, setOpen] = useState(false)
  const input = commandInputText(item)
  const output = commandOutputText(item)
  const hasDetail = Boolean(input || output)
  const status = commandStatus(item)
  const running = workflowStatusIsRunning(status)
  const failed = status === 'error' || status === 'failed'
  const stopped = commandStopped(status)
  const commandKind = commandDisplayKind(item.command)

  return (
    <WorkflowActivityRow
      activityKind="commandExecution"
      icon={<CommandIcon kind={commandKind} />}
      label={(
        <>
          {commandLabel(item)}
          {running ? <WorkflowInlineDots /> : null}
          {running || failed ? <WorkflowActivityStatusBadge failed={failed} /> : null}
        </>
      )}
      hasDetail={hasDetail}
      open={open}
      onToggle={() => setOpen(value => !value)}
      detail={(
        <CommandDetailCard shell={commandShellLabel(item)} input={input} output={cleanCommandOutput(output)} status={status} failed={failed} stopped={stopped} />
      )}
    />
  )
}

function commandLabel(item: CommandItemModel): string {
  const commandCount = item.command.split(/\n\n+/).filter(Boolean).length
  if (commandCount > 1) return `已运行 ${commandCount} 条命令`

  const status = commandStatus(item)
  const label = readableCommandLabel(item.command)
  if (commandStopped(status)) return label.startsWith('已') ? label.replace(/^已/, '已停止') : `已停止: ${label}`
  if (workflowStatusIsRunning(status)) return label.startsWith('已') ? label.replace(/^已/, '正在') : label
  if (status === 'error' || status === 'failed') return label.startsWith('已') ? label.replace(/^已/, '失败: ') : `失败: ${label}`
  return label
}

function readableCommandLabel(command: string): string {
  const firstLine = command.trim().split(/\r?\n/)[0] ?? ''
  if (!firstLine) return '已运行命令'
  if (firstLine.startsWith('git status')) return '已检查 Git 状态'
  if (/^(npm|pnpm|yarn|npm\.cmd|pnpm\.cmd|yarn\.cmd)\b/i.test(firstLine)) return `已运行 ${firstLine}`
  if (firstLine.startsWith('rg --files')) return '已列出文件'
  if (firstLine.startsWith('rg ')) return '已搜索工作区'
  if (/^(Get-Content|gc|cat)\b/i.test(firstLine)) return `已读取 ${compactReadCommandTarget(firstLine)}`
  if (/^(Get-ChildItem|ls|dir)\b/i.test(firstLine)) return '已列出文件'
  if (isFolderCreationCommand(firstLine)) return '已创建文件夹'
  if (/^Select-String\b/i.test(firstLine)) return '已搜索工作区'
  if (/^Get-NetTCPConnection\b/i.test(firstLine)) return '已检查开发服务'
  if (/^\$snapshot\s*=/i.test(firstLine)) return '已读取会话日志'
  if (/^\$listener\s*=/i.test(firstLine)) return '已重启开发服务'
  if (/^Start-Process\b/i.test(firstLine)) return '已启动开发服务'
  if (/^Stop-Process\b/i.test(firstLine)) return '已重启开发服务'
  if (/^Invoke-RestMethod\b/i.test(firstLine)) return '已调用本地 API'
  return `已运行 ${compactCommand(firstLine)}`
}

function commandInputText(item: CommandItemModel): string {
  return item.command || ''
}

function commandOutputText(item: CommandItemModel): string {
  return item.output?.text || ''
}

function commandStatus(item: CommandItemModel): string {
  return item.status || 'completed'
}

function commandStopped(status: string): boolean {
  const normalized = status.toLowerCase()
  return normalized === 'cancelled' || normalized === 'canceled' || normalized === 'interrupted' || normalized === 'aborted'
}

function cleanCommandOutput(output: string): string {
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

function compactCommandTarget(command: string, verb: string): string {
  const target = command
    .replace(new RegExp(`^${verb}\\s+(-Path\\s+)?`, 'i'), '')
    .replace(/\s+-TotalCount\s+\d+.*/i, '')
    .trim()
    .replace(/^["']|["']$/g, '')
  return basename(target || 'file')
}

function compactReadCommandTarget(command: string): string {
  const verb = command.match(/^(Get-Content|gc|cat)\b/i)?.[1] ?? 'Get-Content'
  return compactCommandTarget(command, verb)
}

function compactCommand(command: string): string {
  return command
}

function commandDisplayKind(command: string): 'command' | 'list' | 'read' | 'search' {
  const firstLine = command.trim().split(/\r?\n/)[0] ?? ''
  if (/^(Get-Content|gc|cat)\b/i.test(firstLine)) return 'read'
  if (isFolderCreationCommand(firstLine)) return 'list'
  if (/^(Get-ChildItem|ls|dir)\b/i.test(firstLine) || firstLine.startsWith('rg --files')) return 'list'
  if (/^(Select-String)\b/i.test(firstLine) || /^rg\s+/i.test(firstLine)) return 'search'
  return 'command'
}

function isFolderCreationCommand(command: string): boolean {
  return /^(mkdir|md)\b/i.test(command) || /^New-Item\b/i.test(command) && /\s-ItemType\s+Directory\b/i.test(command)
}

function CommandIcon({ kind }: { kind: 'command' | 'list' | 'read' | 'search' }) {
  if (kind === 'read') return <FileText className="h-3.5 w-3.5 flex-shrink-0" />
  if (kind === 'list') return <FolderTree className="h-3.5 w-3.5 flex-shrink-0" />
  if (kind === 'search') return <Search className="h-3.5 w-3.5 flex-shrink-0" />
  return <SquareTerminal className="h-3.5 w-3.5 flex-shrink-0" />
}

function basename(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath
}

function commandShellLabel(item: CommandItemModel): string {
  return formatShellLabel(item.shell) || inferShellLabel(item.command) || 'Shell'
}

function formatShellLabel(shell: string | undefined): string | undefined {
  const trimmed = shell?.trim()
  const normalized = trimmed?.toLowerCase()
  if (!normalized) return undefined
  if (normalized.includes('powershell') || normalized === 'pwsh') return 'PowerShell'
  if (normalized === 'cmd' || normalized.endsWith('cmd.exe')) return 'CMD'
  if (normalized.includes('bash')) return 'Bash'
  if (normalized.includes('zsh')) return 'Zsh'
  if (normalized.includes('fish')) return 'Fish'
  if (normalized === 'sh' || normalized.endsWith('/sh')) return 'sh'
  if (normalized.includes('node')) return 'Node'
  return trimmed
}

function inferShellLabel(command: string): string | undefined {
  const firstLine = command.trim().split(/\r?\n/)[0] ?? ''
  if (!firstLine) return undefined
  if (/^(powershell|powershell\.exe|pwsh|pwsh\.exe)\b/i.test(firstLine)) return 'PowerShell'
  if (/^(cmd|cmd\.exe)\b/i.test(firstLine)) return 'CMD'
  if (/^(bash|bash\.exe)\b/i.test(firstLine)) return 'Bash'
  if (/^(zsh|fish|sh)\b/i.test(firstLine)) return firstLine.split(/\s+/)[0]
  if (/^(Get-|Set-|New-|Remove-|Select-|Where-|ForEach-|Write-|Start-|Stop-|Invoke-|\$)/i.test(firstLine)) return 'PowerShell'
  if (/^(dir|copy|move|type|where)\b/i.test(firstLine) || /^[A-Za-z]:\\/.test(firstLine)) return 'CMD'
  return undefined
}

function CommandDetailCard({ shell, input, output, status, failed, stopped }: { shell: string; input: string; output: string; status: string; failed: boolean; stopped: boolean }) {
  const [copied, setCopied] = useState(false)
  const copyText = input

  const copyValue = async () => {
    if (!copyText) return
    try {
      await copyToClipboard(copyText)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="workflow-command-card ml-[24px] mt-1.5">
      <div className="workflow-command-card-title">{shell}</div>
      {copyText ? (
        <button
          type="button"
          className="workflow-command-copy workflow-tool-copy"
          onClick={(event) => {
            event.stopPropagation()
            void copyValue()
          }}
          title={copied ? '已复制' : '复制命令'}
          aria-label={copied ? '已复制命令' : '复制命令'}
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        </button>
      ) : null}
      <div className="workflow-command-card-body">
        {input ? <pre className="workflow-command-card-command">$ {input}</pre> : null}
        {output ? (
          <div className="workflow-command-card-section">
            <pre className={`workflow-command-card-output ${failed ? 'danger' : ''}`}>{output}</pre>
            <CommandSectionCopyButton value={output} label="复制输出" />
          </div>
        ) : (
          <div className="workflow-command-card-empty">无输出</div>
        )}
      </div>
      <div className={`workflow-command-card-status ${failed ? 'danger' : stopped ? 'stopped' : ''}`}>
        {workflowStatusIsRunning(status) ? '运行中' : failed ? '失败' : stopped ? '已停止' : '成功'}
      </div>
    </div>
  )
}

function CommandSectionCopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)

  const copyValue = async () => {
    if (!value) return
    try {
      await copyToClipboard(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }

  return (
    <button
      type="button"
      className="workflow-command-section-copy workflow-tool-copy"
      onClick={(event) => {
        event.stopPropagation()
        void copyValue()
      }}
      title={copied ? '已复制' : label}
      aria-label={copied ? '已复制' : label}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  )
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
