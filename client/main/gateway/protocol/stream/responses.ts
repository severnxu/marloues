/**
 * OpenAI Responses SSE Parser
 */

import type { IrStreamDelta } from "./types";
import type { IrUsage } from "../../types";

export class OpenAIResponsesSseParser {
  private buffer = "";
  private outputIndexes = new Map<string, number>();
  private nextIndex = 0;

  parseLine(line: string): IrStreamDelta[] | null {
    if (!line || !line.startsWith("data: ")) return null;
    const data = line.slice(6).trim();
    if (!data || data === "[DONE]") return null;

    try {
      return this.parseEvent(JSON.parse(data) as Record<string, unknown>);
    } catch {
      return null;
    }
  }

  private parseEvent(event: Record<string, unknown>): IrStreamDelta[] | null {
    const type = event.type;

    if (type === "response.output_text.delta") {
      const text = event.delta;
      return typeof text === "string" && text ? [{ type: "text", text }] : null;
    }

    if (type === "response.output_item.added") {
      const item = event.item;
      if (!isRecord(item) || item.type !== "function_call") return null;
      const callId = readString(item.call_id) ?? readString(item.id);
      const name = readString(item.name);
      if (!callId || !name) return null;
      const index = this.registerCall(callId);
      const itemId = readString(item.id);
      if (itemId && itemId !== callId) this.outputIndexes.set(itemId, index);
      return [{ type: "tool_call_start", index, id: callId, name }];
    }

    if (type === "response.function_call_arguments.delta") {
      const itemId = readString(event.item_id);
      if (!itemId) return null;
      const index = this.outputIndexes.get(itemId);
      const args = readString(event.delta);
      if (index === undefined || !args) return null;
      return [{ type: "tool_call_delta", index, arguments: args }];
    }

    if (type === "response.completed") {
      const response = event.response;
      const usage = isRecord(response)
        ? this.parseUsage(response.usage)
        : undefined;
      return [
        ...(usage ? [{ type: "usage" as const, usage }] : []),
        { type: "done", stopReason: "stop" },
      ];
    }

    if (type === "response.failed" || type === "response.incomplete") {
      return [
        {
          type: "done",
          stopReason: type === "response.failed" ? "error" : "length",
        },
      ];
    }

    return null;
  }

  private registerCall(callId: string): number {
    const existing = this.outputIndexes.get(callId);
    if (existing !== undefined) return existing;
    const index = this.nextIndex++;
    this.outputIndexes.set(callId, index);
    return index;
  }

  private parseUsage(value: unknown): IrUsage | undefined {
    if (!isRecord(value)) return undefined;
    return {
      inputTokens: readNumber(value.input_tokens),
      outputTokens: readNumber(value.output_tokens),
    };
  }

  parseChunk(chunk: string): IrStreamDelta[] {
    const deltas: IrStreamDelta[] = [];
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      const parsed = this.parseLine(line);
      if (parsed) deltas.push(...parsed);
    }
    return deltas;
  }

  drain(): IrStreamDelta[] {
    const parsed = this.parseLine(this.buffer);
    this.buffer = "";
    return parsed ?? [];
  }
}

export function parseOpenAIResponsesSseChunk(chunk: string): IrStreamDelta[] {
  return new OpenAIResponsesSseParser().parseChunk(chunk);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
