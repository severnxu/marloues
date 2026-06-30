/**
 * IR Response -> OpenAI Chat Completions Response Formatter
 */

import type { IrResponse } from '../../../types'

export interface OpenAIChatResponseBody {
  id: string
  object: 'chat.completion'
  created: number
  model: string
  choices: OpenAIChoice[]
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

export interface OpenAIChoice {
  index: number
  message: {
    role: 'assistant'
    content: string | null
    tool_calls?: OpenAIToolCall[]
  }
  finish_reason: string | null
}

export interface OpenAIToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export function formatOpenAIChatResponse(ir: IrResponse): OpenAIChatResponseBody {
  const choices: OpenAIChoice[] = ir.choices.map((c, index) => {
    let content: string | null = null
    let toolCalls: OpenAIToolCall[] | undefined

    const text = extractText(c.message.content)
    if (text) {
      content = text
    }

    if (c.message.toolCalls && c.message.toolCalls.length > 0) {
      toolCalls = c.message.toolCalls.map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.name,
          arguments: tc.arguments
        }
      }))
    }

    return {
      index: c.index ?? index,
      message: {
        role: 'assistant' as const,
        content,
        ...(toolCalls ? { tool_calls: toolCalls } : {})
      },
      finish_reason: c.finishReason
    }
  })

  return {
    id: ir.id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: ir.model,
    choices,
    usage: {
      prompt_tokens: ir.usage.inputTokens,
      completion_tokens: ir.usage.outputTokens,
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
