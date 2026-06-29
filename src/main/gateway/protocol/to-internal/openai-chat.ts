/**
 * OpenAI Chat Completions -> IR Request Decoder
 */

import type { IrRequest, IrMessage, IrContentBlock, IrTool, IrToolChoice } from '../../types'

export interface OpenAIChatRequest {
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
  index?: number
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export function decodeOpenAIChatRequest(
  raw: OpenAIChatRequest,
  requestId: string
): IrRequest {
  let system: string | undefined
  const messages: IrMessage[] = []

  for (const msg of raw.messages) {
    if (msg.role === 'system') {
      system = system 
        ? `${system}\n${extractTextContent(msg.content)}`
        : extractTextContent(msg.content)
      continue
    }
    messages.push(convertOpenAIMessage(msg))
  }

  const tools: IrTool[] | undefined = raw.tools?.map(t => ({
    name: t.function.name,
    description: t.function.description,
    parameters: t.function.parameters
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
      stop: raw.stop ? (Array.isArray(raw.stop) ? raw.stop : [raw.stop]) : undefined,
      seed: raw.seed,
      frequencyPenalty: raw.frequency_penalty,
      presencePenalty: raw.presence_penalty
    },
    stream: raw.stream ?? false,
    meta: {
      sourceProtocol: 'openai-chat',
      requestId,
      originalModel: raw.model
    }
  }
}

function extractTextContent(content: string | OpenAIContentPart[] | null): string {
  if (!content) return ''
  if (typeof content === 'string') return content
  return content
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map(p => p.text)
    .join('')
}

function convertOpenAIMessage(msg: OpenAIMessage): IrMessage {
  const content = convertContent(msg.content)

  const irMsg: IrMessage = {
    role: msg.role === 'tool' ? 'tool' : msg.role,
    content
  }

  if (msg.role === 'assistant' && msg.tool_calls) {
    irMsg.toolCalls = msg.tool_calls.map(tc => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments
    }))
  }

  if (msg.role === 'tool' && msg.tool_call_id) {
    irMsg.toolCallId = msg.tool_call_id
  }

  if (msg.name) {
    irMsg.name = msg.name
  }

  return irMsg
}

function convertContent(content: string | OpenAIContentPart[] | null): string | IrContentBlock[] {
  if (!content) return ''
  if (typeof content === 'string') return content

  return content.map(part => {
    if (part.type === 'text') {
      return { type: 'text' as const, text: part.text }
    }
    if (part.type === 'image_url') {
      return { 
        type: 'image' as const, 
        mediaType: 'image/png',
        data: part.image_url.url 
      }
    }
    return { type: 'text' as const, text: '' }
  })
}

function convertToolChoice(tc: OpenAIToolChoice | undefined): IrToolChoice | undefined {
  if (!tc) return undefined
  if (tc === 'none') return 'none'
  if (tc === 'auto') return 'auto'
  if (tc === 'required') return 'required'
  if (typeof tc === 'object' && tc.type === 'function') {
    return { type: 'function', name: tc.function.name }
  }
  return undefined
}
