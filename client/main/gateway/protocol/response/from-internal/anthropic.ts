/**
 * IR Response -> Anthropic Response Formatter
 */

import type { IrResponse } from '../../../types'

export interface AnthropicResponseBody {
  id: string
  type: 'message'
  role: 'assistant'
  model: string
  content: AnthropicContentBlock[]
  stop_reason: string | null
  stop_sequence: null
  usage: {
    input_tokens: number
    output_tokens: number
  }
}

export interface AnthropicContentBlock {
  type: 'text' | 'tool_use'
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
}

export function formatAnthropicResponse(ir: IrResponse): AnthropicResponseBody {
  const choice = ir.choices[0]
  const content: AnthropicContentBlock[] = []

  if (choice) {
    const text = extractText(choice.message.content)
    if (text) {
      content.push({ type: 'text', text })
    }

    if (choice.message.toolCalls) {
      for (const tc of choice.message.toolCalls) {
        let input: Record<string, unknown> = {}
        try {
          input = JSON.parse(tc.arguments)
        } catch {
          // ignore
        }
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input
        })
      }
    }
  }

  let stopReason = choice?.finishReason ?? null
  if (stopReason === 'stop') stopReason = 'end_turn'
  else if (stopReason === 'tool_calls') stopReason = 'tool_use'
  else if (stopReason === 'length') stopReason = 'max_tokens'

  return {
    id: ir.id,
    type: 'message',
    role: 'assistant',
    model: ir.model,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: ir.usage.inputTokens,
      output_tokens: ir.usage.outputTokens
    }
  }
}

function extractText(content: string | { type: string; text?: string }[]): string {
  if (!content) return ''
  if (typeof content === 'string') return content
  return content
    .filter(b => b.type === 'text' && b.text)
    .map(b => b.text!)
    .join('')
}
