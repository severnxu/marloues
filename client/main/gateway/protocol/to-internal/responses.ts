/**
 * OpenAI Responses API -> IR Request Decoder
 * Used by Responses-compatible binary runtimes.
 */

import type { IrRequest, IrMessage, IrTool } from '../../types'

export interface ResponsesAPIRequest {
  model: string
  input: ResponsesInputItem[]
  stream?: boolean
  stream_options?: { include_usage?: boolean }
  tools?: ResponsesTool[]
  temperature?: number
  max_output_tokens?: number
  truncation?: 'auto' | 'disabled'
  top_p?: number
  modalities?: ('text' | 'audio')[]
}

export type ResponsesInputItem =
  | { type: 'message'; role: 'user' | 'assistant' | 'developer'; content: string | ResponsesContent[] }
  | { type: 'text'; text: string }
  | { type: 'image'; image: { url: string } }

export interface ResponsesContent {
  type: 'input_text' | 'input_image'
  text?: string
  image?: { url: string }
}

export interface ResponsesTool {
  type: 'function'
  name: string
  description?: string
  parameters?: Record<string, unknown>
}

export function decodeOpenAIResponsesRequest(
  raw: ResponsesAPIRequest,
  requestId: string
): IrRequest {
  const messages: IrMessage[] = []

  // Normalize input — may be a string or an array of items
  const inputItems: ResponsesInputItem[] = typeof raw.input === 'string'
    ? [{ type: 'text', text: raw.input }]
    : Array.isArray(raw.input) ? raw.input : []

  for (const item of inputItems) {
    if (item.type === 'message') {
      const content = extractTextContent(item.content)
      const role: IrMessage['role'] = item.role === 'developer' ? 'system' : item.role
      messages.push({ role, content })
    } else if (item.type === 'text') {
      messages.push({ role: 'user', content: item.text })
    }
  }

  const tools: IrTool[] | undefined = raw.tools?.map(t => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters ?? {}
  }))

  return {
    model: raw.model,
    messages,
    tools,
    generation: {
      temperature: raw.temperature,
      maxTokens: raw.max_output_tokens,
      topP: raw.top_p
    },
    stream: raw.stream ?? false,
    meta: {
      sourceProtocol: 'openai-responses',
      requestId,
      originalModel: raw.model
    }
  }
}

function extractTextContent(content: string | ResponsesContent[] | undefined): string {
  if (!content) return ''
  if (typeof content === 'string') return content
  return content
    .filter((p): p is { type: 'input_text'; text: string } => p.type === 'input_text')
    .map(p => p.text)
    .join('')
}
