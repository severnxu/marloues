/**
 * OpenAI Responses API -> IR Response Parser
 */

import type { IrResponse, IrMessage, IrUsage } from '../../../types'

export interface ResponsesResponseBody {
  id: string
  object: 'response'
  status: 'completed' | 'in_progress' | 'failed'
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
  call_id?: string
  arguments?: string
  status?: 'completed' | 'in_progress'
}

export function parseOpenAIResponsesResponse(
  raw: ResponsesResponseBody,
  requestId: string,
  originalModel: string
): IrResponse {
  let textContent = ''
  const toolCalls: { id: string; name: string; arguments: string }[] = []

  for (const item of raw.output) {
    if (item.type === 'message' && item.content) {
      for (const block of item.content) {
        if (block.type === 'output_text') {
          textContent += block.text
        }
      }
    } else if (item.type === 'function_call') {
      toolCalls.push({
        id: item.id,
        name: item.name || '',
        arguments: item.arguments || ''
      })
    }
  }

  const message: IrMessage = {
    role: 'assistant',
    content: textContent
  }

  if (toolCalls.length > 0) {
    message.toolCalls = toolCalls
  }

  const usage: IrUsage = {
    inputTokens: raw.usage?.input_tokens ?? 0,
    outputTokens: raw.usage?.output_tokens ?? 0
  }

  return {
    id: raw.id.startsWith('resp_') ? raw.id : `resp_${raw.id}`,
    model: originalModel,
    choices: [{
      index: 0,
      message,
      finishReason: 'stop'
    }],
    usage,
    stopReason: 'stop'
  }
}
