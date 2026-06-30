/**
 * OpenAI Chat SSE Parser - parses SSE stream from OpenAI Chat API
 */

import type { IrStreamDelta } from './types'

export class OpenAIChatSseParser {
  private buffer: string = ''
  private inThinkBlock: boolean = false
  private thinkBuffer: string = ''

  parseLine(line: string): IrStreamDelta[] | null {
    if (!line || line.indexOf('data: ') !== 0) return null

    const dataStr = line.slice(6).trim()
    if (dataStr === '[DONE]') {
      return [{ type: 'done', stopReason: 'stop' }]
    }

    try {
      const data = JSON.parse(dataStr)
      return this.parseEvent(data)
    } catch {
      return null
    }
  }

  private parseEvent(data: Record<string, unknown>): IrStreamDelta[] | null {
    // Support both direct delta and choices[0].delta formats
    let delta = data.delta as Record<string, unknown> | undefined
    if (!delta && Array.isArray(data.choices) && data.choices.length > 0) {
      const choice = data.choices[0] as Record<string, unknown>
      delta = choice.delta as Record<string, unknown> | undefined
      // Also check finish_reason
      if (!delta && choice.finish_reason) {
        return [{ type: 'done', stopReason: choice.finish_reason as string }]
      }
    }
    if (!delta) return null

    // Text delta
    if (delta.content !== undefined && typeof delta.content === 'string') {
      return [{ type: 'text', text: delta.content }]
    }

    // Tool calls can arrive as separate start/argument chunks, or both in the
    // same delta. Preserve both so Responses clients receive final arguments.
    if (delta.tool_calls !== undefined && Array.isArray(delta.tool_calls)) {
      const deltas: IrStreamDelta[] = []
      for (const tc of delta.tool_calls) {
        const toolCall = tc as Record<string, unknown>
        const index = (toolCall.index as number) ?? 0
        if (toolCall.id && toolCall.function) {
          const func = toolCall.function as Record<string, unknown>
          if (func.name) {
            deltas.push({
              type: 'tool_call_start',
              index,
              id: toolCall.id as string,
              name: func.name as string
            })
          }
          if (typeof func.arguments === 'string' && func.arguments.length > 0) {
            deltas.push({
              type: 'tool_call_delta',
              index,
              arguments: func.arguments
            })
          }
        } else if (toolCall.function) {
          const func = toolCall.function as Record<string, unknown>
          if (typeof func.arguments === 'string' && func.arguments.length > 0) {
            deltas.push({
              type: 'tool_call_delta',
              index,
              arguments: func.arguments
            })
          }
        }
      }
      return deltas.length > 0 ? deltas : null
    }

    // Usage in streaming
    if (data.usage !== undefined) {
      const usage = data.usage as Record<string, number>
      return [{
        type: 'usage',
        usage: {
          inputTokens: usage.prompt_tokens ?? 0,
          outputTokens: usage.completion_tokens ?? 0
        }
      }]
    }

    return null
  }

  parseChunk(chunk: string): IrStreamDelta[] {
    const deltas: IrStreamDelta[] = []
    this.buffer += chunk
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() ?? ''

    for (const line of lines) {
      const parsed = this.parseLine(line)
      if (parsed) {
        deltas.push(...parsed)
      }
    }

    return deltas
  }

  drain(): IrStreamDelta[] {
    const deltas: IrStreamDelta[] = []
    if (this.buffer.trim()) {
      const parsed = this.parseLine(this.buffer)
      if (parsed) deltas.push(...parsed)
    }
    this.buffer = ''
    return deltas
  }
}

/**
 * Parse raw SSE chunk from OpenAI Chat
 */
export function parseOpenAIChatSseChunk(chunk: string): IrStreamDelta[] {
  const parser = new OpenAIChatSseParser()
  return parser.parseChunk(chunk)
}
