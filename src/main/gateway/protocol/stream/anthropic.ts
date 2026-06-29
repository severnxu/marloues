/**
 * Anthropic SSE Parser - parses SSE stream from Anthropic API
 */

import type { IrStreamDelta } from './types'

export class AnthropicSseParser {
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
    const type = data.type as string

    if (type === 'content_block_start') {
      const contentBlock = data.content_block as Record<string, unknown>
      if (contentBlock.type === 'tool_use') {
        return [{
          type: 'tool_call_start',
          index: data.index as number,
          id: contentBlock.id as string,
          name: contentBlock.name as string
        }]
      }
    }

    if (type === 'content_block_delta') {
      const delta = data.delta as Record<string, unknown>
      if (delta.type === 'text_delta') {
        return [{ type: 'text', text: delta.text as string }]
      }
      if (delta.type === 'input_json_delta') {
        return [{
          type: 'tool_call_delta',
          index: data.index as number,
          arguments: delta.partial_json as string
        }]
      }
    }

    if (type === 'content_block_stop') {
      return [{ type: 'tool_call_end', index: data.index as number }]
    }

    if (type === 'message_delta') {
      const delta = data.delta as Record<string, unknown>
      if (delta.stop_reason) {
        return [{ type: 'done', stopReason: delta.stop_reason as string }]
      }
    }

    if (type === 'message_stop') {
      return [{ type: 'done', stopReason: 'stop' }]
    }

    if (type === 'message') {
      // Handle usage
      const usage = data.usage as Record<string, unknown>
      if (usage) {
        return [{
          type: 'usage',
          usage: {
            inputTokens: usage.input_tokens as number,
            outputTokens: usage.output_tokens as number,
            cacheReadTokens: usage.cache_read_input_tokens as number | undefined,
            cacheWriteTokens: usage.cache_creation_input_tokens as number | undefined
          }
        }]
      }
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
 * Parse raw SSE chunk from Anthropic
 */
export function parseAnthropicSseChunk(chunk: string): IrStreamDelta[] {
  const parser = new AnthropicSseParser()
  return parser.parseChunk(chunk)
}
