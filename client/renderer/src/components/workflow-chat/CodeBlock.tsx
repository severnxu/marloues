import { Check, Copy } from 'lucide-react'
import { useState, type ReactElement, type ReactNode } from 'react'

export function WorkflowCodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false)
  const codeElement = Array.isArray(children) ? children.find(isCodeElement) : isCodeElement(children) ? children : null
  const language = languageFromClass(codeElement?.props?.className)
  const text = textFromNode(codeElement?.props?.children ?? children)

  const handleCopy = async () => {
    if (!text) return
    try {
      await copyToClipboard(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1100)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="my-3 overflow-hidden rounded-lg bg-muted text-text-normal" data-kind="workflow-code-block">
      <div className="flex h-8 items-center gap-2 px-3 text-[12px] leading-4 text-text-muted">
        <span className="min-w-0 flex-1 truncate font-mono">{language || 'text'}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="grid h-6 w-6 place-items-center rounded-md text-text-subtle transition hover:bg-surface hover:text-text-normal"
          title={copied ? '已复制' : '复制代码'}
          aria-label={copied ? '已复制代码' : '复制代码'}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
      <pre className="m-0 max-h-[520px] overflow-auto px-3 pb-3 pt-1 font-mono text-[12px] leading-5 scrollbar-thin">
        {children}
      </pre>
    </div>
  )
}

function isCodeElement(value: ReactNode): value is ReactElement<{ className?: string; children?: ReactNode }> {
  return Boolean(value && typeof value === 'object' && 'props' in value && (value as { type?: unknown }).type === 'code')
}

function languageFromClass(className?: string): string {
  const match = className?.match(/language-([\w-]+)/)
  return match?.[1] ?? ''
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
function textFromNode(value: ReactNode): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(textFromNode).join('')
  if (value && typeof value === 'object' && 'props' in value) {
    return textFromNode((value as { props?: { children?: ReactNode } }).props?.children)
  }
  return ''
}
