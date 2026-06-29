import type { WorkflowTurnItem as WorkflowStreamItem } from '../../../../shared/adapters/workflow-messages-to-read-thread'

export function itemOutputText(item: WorkflowStreamItem): string {
  if ('output' in item && item.output) return item.output.text
  return ''
}

export function itemInputText(item: WorkflowStreamItem): string {
  if (item.type === 'commandExecution') return item.command
  if (item.type === 'mcpToolCall' || item.type === 'dynamicToolCall') return formatValue(item.arguments ?? '')
  if (item.type === 'webSearch') return formatValue(item.action ?? item.query ?? '')
  if (item.type === 'imageGeneration') return item.revisedPrompt ?? ''
  if (item.type === 'collabAgentToolCall') return item.prompt ?? ''
  if (item.type === 'plan') return item.text
  if (item.type === 'reasoning') return item.summary
  return ''
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value === 'string') return value
  const text = extractTextContent(value)
  if (text) return text
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function extractTextContent(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(extractTextContent).filter(Boolean).join('\n\n')

  const record = asRecord(value)
  if (!record) return ''

  const direct = stringValue(record.text)
    || stringValue(record.content)
    || stringValue(record.output_text)
    || stringValue(record.input_text)
    || stringValue(record.message)
  if (direct) return direct

  for (const key of ['content', 'output', 'message', 'result', 'parts']) {
    const nested = extractTextContent(record[key])
    if (nested) return nested
  }

  return ''
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
