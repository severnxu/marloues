/**
 * Stream Types - SSE parsing and formatting types
 */

export interface SseEvent {
  event?: string
  data: string
}

export type IrStreamDelta =
  | { type: 'text'; text: string }
  | { type: 'tool_call_start'; index: number; id: string; name: string }
  | { type: 'tool_call_delta'; index: number; arguments: string }
  | { type: 'tool_call_end'; index: number }
  | { type: 'usage'; usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number } }
  | { type: 'done'; stopReason: string }
