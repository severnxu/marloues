/**
 * Protocol Conversion - IR (Internal Representation) Types
 */

export type ProtocolId = 
  | 'anthropic'        // Anthropic Messages API
  | 'openai-chat'      // OpenAI Chat Completions
  | 'openai-responses' // OpenAI Responses API

export function detectProtocol(url: string): ProtocolId | null {
  if (url.indexOf('/v1/responses') >= 0 || url.match(/\/responses(?:\?|$)/)) return 'openai-responses'
  if (url.indexOf('/v1/chat/completions') >= 0 || url.match(/\/chat\/completions(?:\?|$)/)) return 'openai-chat'
  if (url.indexOf('/v1/messages') >= 0 || url.match(/\/messages(?:\?|$)/)) return 'anthropic'
  return null
}

export type IrRole = 'system' | 'user' | 'assistant' | 'tool'

export interface IrContentBlock {
  type: 'text' | 'image' | 'tool_use' | 'tool_result'
  text?: string
  mediaType?: string
  data?: string
  id?: string
  name?: string
  input?: string
  toolUseId?: string
  content?: string
}

export interface IrMessage {
  role: IrRole
  content: string | IrContentBlock[]
  toolCalls?: IrToolCall[]
  toolCallId?: string
  name?: string
}

export interface IrToolCall {
  id: string
  name: string
  arguments: string
}

export interface IrTool {
  name: string
  description?: string
  parameters: Record<string, unknown>
}

export type IrToolChoice = 'auto' | 'none' | 'required' | { type: 'function'; name: string }

export interface IrGenerationConfig {
  temperature?: number
  maxTokens?: number
  topP?: number
  topK?: number
  stop?: string[]
  seed?: number
  frequencyPenalty?: number
  presencePenalty?: number
}

export interface IrRequest {
  model: string
  messages: IrMessage[]
  system?: string
  tools?: IrTool[]
  toolChoice?: IrToolChoice
  generation: IrGenerationConfig
  stream: boolean
  meta: {
    sourceProtocol: ProtocolId
    requestId: string
    originalModel: string
  }
}

export interface IrUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

export interface IrChoice {
  index: number
  message: IrMessage
  finishReason: string | null
}

export interface IrResponse {
  id: string
  model: string
  choices: IrChoice[]
  usage: IrUsage
  stopReason?: string
}

export interface EncodedRequest {
  path: string
  headers: Record<string, string>
  body: unknown
}

export type IrStreamDelta =
  | { type: 'text'; text: string }
  | { type: 'tool_call_start'; index: number; id: string; name: string }
  | { type: 'tool_call_delta'; index: number; arguments: string }
  | { type: 'tool_call_end'; index: number }
  | { type: 'usage'; usage: IrUsage }
  | { type: 'done'; stopReason: string }
