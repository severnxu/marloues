/**
 * IR Request -> OpenAI Chat Completions Encoder
 */

import type { IrRequest, IrToolChoice } from '../../types'

export interface OpenAIChatRequestBody {
  model: string
  messages: OpenAIMessage[]
  tools?: OpenAITool[]
  tool_choice?: OpenAIToolChoice
  temperature?: number
  top_p?: number
  max_tokens?: number
  stream?: boolean
  stop?: string | string[]
  seed?: number
  frequency_penalty?: number
  presence_penalty?: number
}

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | OpenAIContentPart[] | null
  name?: string
  tool_calls?: OpenAIToolCall[]
  tool_call_id?: string
}

export type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } }

export interface OpenAITool {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters: Record<string, unknown>
  }
}

export type OpenAIToolChoice =
  | 'none'
  | 'auto'
  | 'required'
  | { type: 'function'; function: { name: string } }

export interface OpenAIToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export function encodeOpenAIChatRequest(ir: IrRequest): OpenAIChatRequestBody {
  const messages: OpenAIMessage[] = []

  if (ir.system) {
    messages.push({ role: 'system', content: ir.system })
  }

  for (const msg of ir.messages) {
    messages.push(convertToOpenAIMessage(msg))
  }

  mergeConsecutiveSystemMessages(messages)

  const body: OpenAIChatRequestBody = {
    model: ir.model,
    messages,
    stream: ir.stream
  }

  if (ir.generation.temperature !== undefined) body.temperature = ir.generation.temperature
  if (ir.generation.topP !== undefined) body.top_p = ir.generation.topP
  if (ir.generation.maxTokens !== undefined) body.max_tokens = ir.generation.maxTokens
  if (ir.generation.stop) body.stop = ir.generation.stop.length === 1 ? ir.generation.stop[0] : ir.generation.stop
  if (ir.generation.seed !== undefined) body.seed = ir.generation.seed
  if (ir.generation.frequencyPenalty !== undefined) body.frequency_penalty = ir.generation.frequencyPenalty
  if (ir.generation.presencePenalty !== undefined) body.presence_penalty = ir.generation.presencePenalty

  if (ir.tools && ir.tools.length > 0) {
    const validTools = ir.tools.filter(t => t.name && t.name.trim() !== '')
    if (validTools.length > 0) {
      body.tools = validTools.map(t => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters && Object.keys(t.parameters).length > 0
            ? t.parameters
            : { type: 'object', properties: {} }
        }
      }))
    }
  }

  if (ir.toolChoice) {
    body.tool_choice = convertToolChoice(ir.toolChoice)
  }

  return body
}

function convertToOpenAIMessage(msg: IrMessage): OpenAIMessage {
  const role = (msg.role === 'tool' ? 'tool' : msg.role) as 'system' | 'user' | 'assistant' | 'tool'
  const content = convertContent(msg.content)

  const openaiMsg: OpenAIMessage = { role, content }

  if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
    openaiMsg.tool_calls = msg.toolCalls.map(tc => ({
      id: tc.id,
      type: 'function' as const,
      function: {
        name: tc.name,
        arguments: tc.arguments
      }
    }))
  }

  if (msg.role === 'tool' && msg.toolCallId) {
    openaiMsg.tool_call_id = msg.toolCallId
  }

  if (msg.name) {
    openaiMsg.name = msg.name
  }

  return openaiMsg
}

function convertContent(content: string | { type: string; text?: string; mediaType?: string; data?: string }[]): string | OpenAIContentPart[] | null {
  if (!content) return null
  if (typeof content === 'string') return content

  return content.map(part => {
    if (part.type === 'text') {
      return { type: 'text' as const, text: part.text ?? '' }
    }
    if (part.type === 'image') {
      return { 
        type: 'image_url' as const, 
        image_url: { url: part.data ?? '', detail: 'auto' as const }
      }
    }
    return { type: 'text' as const, text: '' }
  })
}

function convertToolChoice(tc: IrToolChoice): OpenAIToolChoice | undefined {
  if (tc === 'none') return 'none'
  if (tc === 'auto') return 'auto'
  if (tc === 'required') return 'required'
  if (typeof tc === 'object' && tc.type === 'function') {
    return { type: 'function', function: { name: tc.name } }
  }
  return undefined
}

function mergeConsecutiveSystemMessages(messages: OpenAIMessage[]): void {
  let i = 0
  while (i < messages.length - 1) {
    if (
      messages[i].role === 'system' &&
      messages[i + 1].role === 'system'
    ) {
      const a = typeof messages[i].content === 'string' ? messages[i].content as string : ''
      const b = typeof messages[i + 1].content === 'string' ? messages[i + 1].content as string : ''
      messages[i] = { role: 'system', content: `${a}\n\n${b}` }
      messages.splice(i + 1, 1)
    } else {
      i++
    }
  }
}

interface IrMessage {
  role: string
  content: string | { type: string; text?: string; mediaType?: string; data?: string }[]
  toolCallId?: string
  toolCalls?: { id: string; name: string; arguments: string }[]
  name?: string
}
