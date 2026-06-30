/**
 * IR Response -> OpenAI Responses API Response Formatter
 */

import type { IrResponse } from '../../../types'

export interface ResponsesResponseBody {
  id: string
  object: 'response'
  status: 'completed'
  model: string
  output: ResponsesOutputItem[]
  usage?: {
    input_tokens: number
    output_tokens: number
    total_tokens: number
  }
}

export interface ResponsesOutputItem {
  id: string
  type: 'message' | 'function_call'
  role?: 'assistant'
  content?: { type: 'output_text'; text: string }[]
  name?: string
  arguments?: string
}

export function formatOpenAIResponsesResponse(ir: IrResponse): ResponsesResponseBody {
  const choice = ir.choices[0]
  const output: ResponsesOutputItem[] = []

  if (choice) {
    const text = extractText(choice.message.content)
    
    if (choice.message.toolCalls && choice.message.toolCalls.length > 0) {
      for (const tc of choice.message.toolCalls) {
        output.push({
          id: `fc_${tc.id}`,
          type: 'function_call',
          name: tc.name,
          arguments: tc.arguments
        })
      }
    }
    
    if (text) {
      output.push({
        id: `msg_${ir.id}`,
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text }]
      })
    }
  }

  return {
    id: ir.id.startsWith('resp_') ? ir.id : `resp_${ir.id}`,
    object: 'response',
    status: 'completed',
    model: ir.model,
    output,
    usage: {
      input_tokens: ir.usage.inputTokens,
      output_tokens: ir.usage.outputTokens,
      total_tokens: ir.usage.inputTokens + ir.usage.outputTokens
    }
  }
}

function extractText(content: string | { type: string; text?: string }[]): string | null {
  if (!content) return null
  if (typeof content === 'string') return content
  const text = content
    .filter(b => b.type === 'text' && b.text)
    .map(b => b.text!)
    .join('')
  return text || null
}
