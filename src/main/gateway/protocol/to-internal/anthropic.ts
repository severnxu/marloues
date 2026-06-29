/**
 * Anthropic Messages API -> IR Request Decoder
 */

import type { IrRequest, IrMessage, IrContentBlock, IrTool, IrToolChoice } from '../../types'

export interface AnthropicMessagesRequest {
  model: string
  messages: AnthropicMessage[]
  system?: string | AnthropicContentBlock[]
  tools?: AnthropicTool[]
  tool_choice?: AnthropicToolChoice
  temperature?: number
  top_p?: number
  top_k?: number
  max_tokens: number
  stream?: boolean
  stop_sequences?: string[]
}

export interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

export type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string | AnthropicContentBlock[] }
  | { type: 'thinking'; thinking: string; signature?: string }
  | { type: 'document'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'audio'; source: { type: 'base64'; media_type: string; data: string } }

export interface AnthropicTool {
  name: string
  description?: string
  input_schema: Record<string, unknown>
}

export type AnthropicToolChoice =
  | { type: 'auto' }
  | { type: 'any' }
  | { type: 'tool'; name: string }

export function decodeAnthropicRequest(
  raw: AnthropicMessagesRequest,
  requestId: string
): IrRequest {
  let system: string | undefined
  if (raw.system) {
    system = typeof raw.system === 'string'
      ? raw.system
      : raw.system
          .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
          .map(b => b.text)
          .join('\n')
  }

  const messages: IrMessage[] = []
  for (const msg of raw.messages) {
    messages.push(...convertAnthropicMessage(msg))
  }

  const tools: IrTool[] | undefined = raw.tools?.map(t => ({
    name: t.name,
    description: t.description,
    parameters: t.input_schema
  }))

  const toolChoice: IrToolChoice | undefined = convertToolChoice(raw.tool_choice)

  return {
    model: raw.model,
    messages,
    system,
    tools,
    toolChoice,
    generation: {
      temperature: raw.temperature,
      maxTokens: raw.max_tokens,
      topP: raw.top_p,
      topK: raw.top_k,
      stop: raw.stop_sequences
    },
    stream: raw.stream ?? false,
    meta: {
      sourceProtocol: 'anthropic',
      requestId,
      originalModel: raw.model
    }
  }
}

function convertAnthropicMessage(msg: AnthropicMessage): IrMessage[] {
  const results: IrMessage[] = []

  if (typeof msg.content === 'string') {
    results.push({
      role: msg.role,
      content: msg.content
    })
    return results
  }

  const textParts: string[] = []
  const toolCalls: { id: string; name: string; arguments: string }[] = []
  const toolResults: IrMessage[] = []

  for (const block of msg.content) {
    switch (block.type) {
      case 'text':
        textParts.push(block.text)
        break
      case 'image':
        results.push({
          role: msg.role,
          content: [{
            type: 'image',
            mediaType: block.source.media_type,
            data: block.source.data
          }]
        })
        break
      case 'tool_use':
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: JSON.stringify(block.input)
        })
        break
      case 'tool_result': {
        const resultText = typeof block.content === 'string'
          ? block.content
          : block.content
              .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
              .map(b => b.text)
              .join('')
        toolResults.push({
          role: 'tool',
          content: resultText,
          toolCallId: block.tool_use_id
        })
        break
      }
      case 'thinking':
        break
      case 'document':
      case 'audio':
        break
    }
  }

  if (toolCalls.length > 0) {
    const content: IrContentBlock[] = []
    if (textParts.length > 0) {
      content.push({ type: 'text', text: textParts.join('') })
    }
    results.push({
      role: 'assistant',
      content: content.length > 0 ? content : '',
      toolCalls: toolCalls.map(tc => ({
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments
      }))
    })
  } else if (textParts.length > 0) {
    results.push({
      role: msg.role,
      content: textParts.join('')
    })
  }

  results.push(...toolResults)

  return results
}

function convertToolChoice(tc: AnthropicToolChoice | undefined): IrToolChoice | undefined {
  if (!tc) return undefined
  if (tc.type === 'auto') return 'auto'
  if (tc.type === 'any') return 'required'
  if (tc.type === 'tool') return { type: 'function', name: tc.name }
  return undefined
}
