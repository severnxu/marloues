/**
 * Anthropic SSE Parser - parses SSE stream from Anthropic API
 */

import type { IrUsage } from "../../types";
import type { IrStreamDelta } from "./types";

export class AnthropicSseParser {
  private buffer: string = "";
  private inThinkBlock: boolean = false;
  private thinkBuffer: string = "";
  private usage?: IrUsage;

  parseLine(line: string): IrStreamDelta[] | null {
    if (!line || line.indexOf("data: ") !== 0) return null;

    const dataStr = line.slice(6).trim();
    if (dataStr === "[DONE]") {
      return [{ type: "done", stopReason: "stop" }];
    }

    try {
      const data = JSON.parse(dataStr);
      return this.parseEvent(data);
    } catch {
      return null;
    }
  }

  private parseEvent(data: Record<string, unknown>): IrStreamDelta[] | null {
    const type = data.type as string;

    if (type === "content_block_start") {
      const contentBlock = data.content_block as Record<string, unknown>;
      if (contentBlock.type === "tool_use") {
        return [
          {
            type: "tool_call_start",
            index: data.index as number,
            id: contentBlock.id as string,
            name: contentBlock.name as string,
          },
        ];
      }
    }

    if (type === "content_block_delta") {
      const delta = data.delta as Record<string, unknown>;
      if (delta.type === "text_delta") {
        return [{ type: "text", text: delta.text as string }];
      }
      if (delta.type === "input_json_delta") {
        return [
          {
            type: "tool_call_delta",
            index: data.index as number,
            arguments: delta.partial_json as string,
          },
        ];
      }
    }

    if (type === "content_block_stop") {
      return [{ type: "tool_call_end", index: data.index as number }];
    }

    if (type === "message_delta") {
      const delta = data.delta as Record<string, unknown>;
      const deltas: IrStreamDelta[] = [];
      if (delta.stop_reason) {
        deltas.push({ type: "done", stopReason: delta.stop_reason as string });
      }
      const usage = this.parseUsage(data.usage);
      if (usage) {
        deltas.push({ type: "usage", usage });
      }
      if (deltas.length > 0) {
        return deltas;
      }
    }

    if (type === "message_stop") {
      return [{ type: "done", stopReason: "stop" }];
    }

    if (type === "message_start" || type === "message") {
      const message =
        type === "message_start"
          ? (data.message as Record<string, unknown> | undefined)
          : undefined;
      const usage = this.parseUsage(message?.usage ?? data.usage);
      if (usage) {
        return [{ type: "usage", usage }];
      }
    }

    return null;
  }

  private parseUsage(value: unknown): IrUsage | undefined {
    if (!value || typeof value !== "object") return undefined;
    const usage = value as Record<string, unknown>;
    if (usage.input_tokens === undefined && usage.output_tokens === undefined)
      return undefined;
    const next: IrUsage = {
      inputTokens: this.usage?.inputTokens ?? 0,
      outputTokens: this.usage?.outputTokens ?? 0,
      cacheReadTokens: this.usage?.cacheReadTokens,
      cacheWriteTokens: this.usage?.cacheWriteTokens,
    };
    if (usage.input_tokens !== undefined)
      next.inputTokens = usage.input_tokens as number;
    if (usage.output_tokens !== undefined)
      next.outputTokens = usage.output_tokens as number;
    if (usage.cache_read_input_tokens !== undefined) {
      next.cacheReadTokens = usage.cache_read_input_tokens as number;
    }
    if (usage.cache_creation_input_tokens !== undefined) {
      next.cacheWriteTokens = usage.cache_creation_input_tokens as number;
    }
    this.usage = next;
    return { ...this.usage };
  }

  parseChunk(chunk: string): IrStreamDelta[] {
    const deltas: IrStreamDelta[] = [];
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      const parsed = this.parseLine(line);
      if (parsed) {
        deltas.push(...parsed);
      }
    }

    return deltas;
  }

  drain(): IrStreamDelta[] {
    const deltas: IrStreamDelta[] = [];
    if (this.buffer.trim()) {
      const parsed = this.parseLine(this.buffer);
      if (parsed) deltas.push(...parsed);
    }
    this.buffer = "";
    return deltas;
  }
}

/**
 * Parse raw SSE chunk from Anthropic
 */
export function parseAnthropicSseChunk(chunk: string): IrStreamDelta[] {
  const parser = new AnthropicSseParser();
  return parser.parseChunk(chunk);
}
