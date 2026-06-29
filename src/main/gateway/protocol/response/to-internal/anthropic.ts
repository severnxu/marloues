/**
 * Anthropic Messages Response -> IR Response Parser
 */

import type { IrResponse, IrMessage, IrUsage } from '../../../types'

export interface AnthropicResponse {
  id: string
  type: 'message'
  role: 'assistant'
  model: string
  content: AnthropicContentBlock[]
  stop_reason: string | null
  stop_sequence: string | null
  usage: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }
}

export type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'thinking'; thinking: string; signature?: string }
  | { type: 'redacted_thinking'; thinking: string }
  | { type: 'server_tool_use'; id: string; name: string; input: Record<string, unknown> }

export function parseAnthropicResponse(
  raw: AnthropicResponse,
  requestId: string,
  originalModel: string
): IrResponse {
  const message = convertAnthropicMessage(raw.content)

  const usage: IrUsage = {
    inputTokens: raw.usage.input_tokens,
    outputTokens: raw.usage.output_tokens,
    cacheReadTokens: raw.usage.cache_read_input_tokens,
    cacheWriteTokens: raw.usage.cache_creation_input_tokens
  }

  let stopReason = raw.stop_reason
  if (stopReason === 'end_turn') stopReason = 'stop'
  else if (stopReason === 'tool_use') stopReason = 'tool_calls'
  else if (stopReason === 'max_tokens') stopReason = 'length'

  return {
    id: raw.id || `msg_${requestId}`,
    model: originalModel,
    choices: [{
      index: 0,
      message,
      finishReason: stopReason
    }],
    usage,
    stopReason: stopReason ?? undefined
  }
}

function convertAnthropicMessage(content: AnthropicContentBlock[]): IrMessage {
  let textContent = ''
  const toolCalls: IrMessage['toolCalls'] = []

  for (const block of content) {
    if (block.type === 'text') {
      textContent += block.text
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        name: block.name,
        arguments: JSON.stringify(block.input)
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

  return message
}
