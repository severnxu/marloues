/**
 * IR Request -> Anthropic Messages API Encoder
 */

import type { IrRequest, IrToolChoice } from '../../types'

export interface AnthropicRequestBody {
  model: string
  messages: AnthropicMessage[]
  system?: string
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

export interface AnthropicContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'image'
  text?: string
  source?: { type: 'base64'; media_type: string; data: string }
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: string
}

export interface AnthropicTool {
  name: string
  description?: string
  input_schema: Record<string, unknown>
}

export type AnthropicToolChoice =
  | { type: 'auto' }
  | { type: 'any' }
  | { type: 'tool'; name: string }

export function encodeAnthropicRequest(ir: IrRequest): AnthropicRequestBody {
  const messages: AnthropicMessage[] = []
  let systemText = ir.system

  for (const msg of ir.messages) {
    if (msg.role === 'system') {
      systemText = systemText 
        ? `${systemText}\n${extractText(msg.content)}`
        : extractText(msg.content)
      continue
    }
    messages.push(convertToAnthropicMessage(msg))
  }

  const merged = mergeAdjacentMessages(messages)

  const body: AnthropicRequestBody = {
    model: ir.model,
    messages: merged,
    max_tokens: ir.generation.maxTokens ?? 4096,
    stream: ir.stream
  }

  if (systemText) body.system = systemText
  if (ir.generation.temperature !== undefined) body.temperature = ir.generation.temperature
  if (ir.generation.topP !== undefined) body.top_p = ir.generation.topP
  if (ir.generation.topK !== undefined) body.top_k = ir.generation.topK
  if (ir.generation.stop) body.stop_sequences = ir.generation.stop

  if (ir.tools && ir.tools.length > 0) {
    body.tools = ir.tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters
    }))
  }

  if (ir.toolChoice) {
    body.tool_choice = convertToolChoice(ir.toolChoice)
  }

  return body
}

function extractText(content: string | { type: string; text?: string }[]): string {
  if (typeof content === 'string') return content
  return content
    .filter(b => b.type === 'text' && b.text)
    .map(b => b.text!)
    .join('')
}

function convertToAnthropicMessage(msg: IrMessage): AnthropicMessage {
  const role: 'user' | 'assistant' = msg.role === 'tool' ? 'user' : msg.role === 'user' ? 'user' : 'assistant'
  const content: AnthropicContentBlock[] = []

  if (msg.role === 'tool' && msg.toolCallId) {
    content.push({
      type: 'tool_result',
      tool_use_id: msg.toolCallId,
      content: extractText(msg.content)
    })
    return { role: 'user', content }
  }

  const text = extractText(msg.content)
  if (text) {
    content.push({ type: 'text', text })
  }

  if (msg.toolCalls) {
    for (const tc of msg.toolCalls) {
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

  if (content.length === 0) {
    content.push({ type: 'text', text: '' })
  }

  return { role, content }
}

function mergeAdjacentMessages(messages: AnthropicMessage[]): AnthropicMessage[] {
  const result: AnthropicMessage[] = []
  
  for (const msg of messages) {
    const last = result[result.length - 1]
    if (last && last.role === msg.role) {
      const lastContent = Array.isArray(last.content) ? last.content : [{ type: 'text' as const, text: last.content }]
      const newContent = Array.isArray(msg.content) ? msg.content : [{ type: 'text' as const, text: msg.content }]
      last.content = [...lastContent, ...newContent]
    } else {
      result.push({ ...msg })
    }
  }
  
  return result
}

function convertToolChoice(tc: IrToolChoice): AnthropicToolChoice | undefined {
  if (tc === 'none') return undefined
  if (tc === 'auto') return { type: 'auto' }
  if (tc === 'required') return { type: 'any' }
  if (typeof tc === 'object' && tc.type === 'function') {
    return { type: 'tool', name: tc.name }
  }
  return undefined
}

interface IrMessage {
  role: string
  content: string | { type: string; text?: string }[]
  toolCallId?: string
  toolCalls?: { id: string; name: string; arguments: string }[]
}
