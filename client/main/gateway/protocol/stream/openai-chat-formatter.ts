/**
 * OpenAI SSE Formatter - converts IR stream deltas to OpenAI Chat Completions SSE
 */

import type { IrStreamDelta, SseEvent } from './types'

export class OpenAIChatSseFormatter {
  private requestId: string
  private originalModel: string
  private chunkId: string
  private created: number
  private toolCallIndex: number = 0
  private hasStarted: boolean = false

  constructor(requestId: string, originalModel: string) {
    this.requestId = requestId
    this.originalModel = originalModel
    this.chunkId = `chatcmpl_${requestId.slice(0, 8)}`
    this.created = Math.floor(Date.now() / 1000)
  }

  formatDeltas(deltas: IrStreamDelta[]): SseEvent[] {
    const events: SseEvent[] = []
    for (const delta of deltas) {
      const formatted = this.formatDelta(delta)
      if (formatted) events.push(formatted)
    }
    return events
  }

  private formatDelta(delta: IrStreamDelta): SseEvent | null {
    switch (delta.type) {
      case 'text':
        return this.formatText(delta.text)
      case 'tool_call_start':
        return this.formatToolCallStart(delta.index, delta.id, delta.name)
      case 'tool_call_delta':
        return this.formatToolCallDelta(delta.index, delta.arguments)
      case 'tool_call_end':
        return null
      case 'usage':
        return this.formatUsage(delta.usage)
      case 'done':
        return null
      default:
        return null
    }
  }

  private formatText(text: string): SseEvent {
    if (!this.hasStarted) {
      this.hasStarted = true
    }

    const chunk = {
      id: this.chunkId,
      object: 'chat.completion.chunk',
      created: this.created,
      model: this.originalModel,
      choices: [{
        index: 0,
        delta: {
          role: 'assistant',
          content: text
        },
        finish_reason: null
      }]
    }

    return { data: JSON.stringify(chunk) }
  }

  private formatToolCallStart(index: number, id: string, name: string): SseEvent {
    if (!this.hasStarted) {
      this.hasStarted = true
    }

    this.toolCallIndex = index

    const chunk = {
      id: this.chunkId,
      object: 'chat.completion.chunk',
      created: this.created,
      model: this.originalModel,
      choices: [{
        index: 0,
        delta: {
          role: 'assistant',
          content: null,
          tool_calls: [{
            index: index,
            id: id,
            type: 'function',
            function: {
              name: name,
              arguments: ''
            }
          }]
        },
        finish_reason: null
      }]
    }

    return { data: JSON.stringify(chunk) }
  }

  private formatToolCallDelta(index: number, args: string): SseEvent {
    const chunk = {
      id: this.chunkId,
      object: 'chat.completion.chunk',
      created: this.created,
      model: this.originalModel,
      choices: [{
        index: 0,
        delta: {
          content: null,
          tool_calls: [{
            index: index,
            function: {
              arguments: args
            }
          }]
        },
        finish_reason: null
      }]
    }

    return { data: JSON.stringify(chunk) }
  }

  private formatUsage(usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number }): SseEvent {
    const chunk = {
      id: this.chunkId,
      object: 'chat.completion.chunk',
      created: this.created,
      model: this.originalModel,
      choices: [{
        index: 0,
        delta: {},
        finish_reason: null
      }],
      usage: {
        prompt_tokens: usage.inputTokens,
        completion_tokens: usage.outputTokens,
        total_tokens: usage.inputTokens + usage.outputTokens
      }
    }

    return { data: JSON.stringify(chunk) }
  }

  done(): SseEvent {
    return { data: '[DONE]' }
  }
}

export function formatOpenAIChatSse(deltas: IrStreamDelta[], requestId: string, model: string): string {
  const formatter = new OpenAIChatSseFormatter(requestId, model)
  const events = formatter.formatDeltas(deltas)
  let result = ''
  for (const event of events) {
    result += `data: ${event.data}\n\n`
  }
  return result
}
