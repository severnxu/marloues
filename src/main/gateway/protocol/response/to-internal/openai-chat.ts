/**
 * OpenAI Chat Completions Response -> IR Response Parser
 */

import type { IrResponse, IrChoice, IrMessage, IrUsage } from '../../../types'

export interface OpenAIChatResponse {
  id: string
  object: 'chat.completion'
  created: number
  model: string
  choices: OpenAIChoice[]
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    prompt_tokens_details?: {
      cached_tokens: number
    }
    completion_tokens_details?: {
      reasoning_tokens: number
    }
  }
}

export interface OpenAIChoice {
  index: number
  message: OpenAIMessage
  finish_reason: string | null
}

export interface OpenAIMessage {
  role: 'assistant'
  content: string | null
  tool_calls?: OpenAIToolCall[]
}

export interface OpenAIToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export function parseOpenAIChatResponse(
  raw: OpenAIChatResponse,
  requestId: string,
  originalModel: string
): IrResponse {
  const choices: IrChoice[] = raw.choices.map((c, index) => ({
    index: c.index ?? index,
    message: convertOpenAIMessage(c.message),
    finishReason: c.finish_reason
  }))

  const usage: IrUsage = {
    inputTokens: raw.usage.prompt_tokens,
    outputTokens: raw.usage.completion_tokens,
    cacheReadTokens: raw.usage.prompt_tokens_details?.cached_tokens
  }

  return {
    id: raw.id || `chatcmpl_${requestId}`,
    model: originalModel,
    choices,
    usage,
    stopReason: raw.choices[0]?.finish_reason ?? undefined
  }
}

function convertOpenAIMessage(msg: OpenAIMessage): IrMessage {
  let content: string | IrMessage['content'] = msg.content ?? ''

  if (msg.tool_calls && msg.tool_calls.length > 0) {
    const textContent = typeof content === 'string' ? content : ''
    const blocks: IrMessage['content'] = []
    
    if (textContent) {
      blocks.push({ type: 'text', text: textContent })
    }
    
    for (const tc of msg.tool_calls) {
      blocks.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input: tc.function.arguments
      })
    }
    
    content = blocks
  }

  return {
    role: 'assistant',
    content
  }
}
