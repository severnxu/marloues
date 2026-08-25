/**
 * Anthropic SSE Formatter - converts IR stream deltas to Anthropic SSE events
 */

import type { IrUsage } from "../../types";
import type { IrStreamDelta, SseEvent } from "./types";

export class AnthropicSseFormatter {
  private requestId: string;
  private originalModel: string;
  private messageId: string;
  private blockIndex: number = 0;
  private started: boolean = false;
  private messageStarted: boolean = false;
  private hasOpenBlock: boolean = false;
  private finished: boolean = false;
  private usage?: IrUsage;

  constructor(requestId: string, originalModel: string) {
    this.requestId = requestId;
    this.originalModel = originalModel;
    this.messageId = `msg_${requestId.slice(0, 8)}`;
  }

  formatDeltas(deltas: IrStreamDelta[]): SseEvent[] {
    const events: SseEvent[] = [];
    for (const delta of deltas) {
      events.push(...this.formatDelta(delta));
    }
    return events;
  }

  finish(stopReason: string): SseEvent[] {
    return this.formatDone(stopReason);
  }

  private formatDelta(delta: IrStreamDelta): SseEvent[] {
    switch (delta.type) {
      case "text":
        return this.formatText(delta.text);
      case "tool_call_start":
        return this.formatToolCallStart(delta.index, delta.id, delta.name);
      case "tool_call_delta":
        return this.formatToolCallDelta(delta.index, delta.arguments);
      case "tool_call_end":
        return this.formatToolCallEnd(delta.index);
      case "usage":
        this.usage = delta.usage;
        return [];
      case "done":
        return this.formatDone(delta.stopReason);
      default:
        return [];
    }
  }

  private formatText(text: string): SseEvent[] {
    const events: SseEvent[] = [];
    if (!this.messageStarted) {
      events.push(this.messageStart());
    }
    if (!this.started) {
      this.started = true;
      this.blockIndex = 0;
      this.hasOpenBlock = true;
      events.push(this.contentBlockStart(0, "text"));
    }
    events.push(this.contentBlockDelta(0, text));
    return events;
  }

  private formatToolCallStart(
    index: number,
    id: string,
    name: string,
  ): SseEvent[] {
    const events: SseEvent[] = [];
    if (!this.messageStarted) {
      events.push(this.messageStart());
    }
    if (this.hasOpenBlock) {
      events.push(this.contentBlockStop(this.blockIndex));
      this.hasOpenBlock = false;
    }
    this.blockIndex++;
    this.started = true;
    this.hasOpenBlock = true;
    events.push(this.contentBlockStart(this.blockIndex, "tool_use", id, name));
    return events;
  }

  private formatToolCallDelta(index: number, args: string): SseEvent[] {
    return [
      this.delta("content_block_delta", {
        type: "content_block_delta",
        index: this.blockIndex,
        delta: {
          type: "input_json_delta",
          partial_json: args,
        },
      }),
    ];
  }

  private formatToolCallEnd(_index: number): SseEvent[] {
    if (!this.hasOpenBlock) return [];
    this.hasOpenBlock = false;
    return [this.contentBlockStop(this.blockIndex)];
  }

  private formatDone(stopReason: string): SseEvent[] {
    if (this.finished) return [];
    this.finished = true;

    let anthropicReason = stopReason;
    if (stopReason === "stop") anthropicReason = "end_turn";
    else if (stopReason === "tool_calls") anthropicReason = "tool_use";
    else if (stopReason === "length") anthropicReason = "max_tokens";

    const events: SseEvent[] = [];
    if (this.hasOpenBlock) {
      events.push(this.contentBlockStop(this.blockIndex));
      this.hasOpenBlock = false;
    }
    const messageDelta: Record<string, unknown> = {
      type: "message_delta",
      delta: {
        stop_reason: anthropicReason,
        stop_sequence: null,
      },
    };
    if (this.usage) {
      messageDelta.usage = {
        input_tokens: this.usage.inputTokens,
        output_tokens: this.usage.outputTokens,
      };
    }
    events.push(this.delta("message_delta", messageDelta));
    events.push(this.event("message_stop", { type: "message_stop" }));
    return events;
  }

  private messageStart(): SseEvent {
    this.messageStarted = true;
    return this.event("message_start", {
      type: "message_start",
      message: {
        id: this.messageId,
        type: "message",
        role: "assistant",
        model: this.originalModel,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 0,
          output_tokens: 0,
        },
      },
    });
  }

  private contentBlockStart(
    index: number,
    blockType: string,
    toolId?: string,
    toolName?: string,
  ): SseEvent {
    const contentBlock: Record<string, unknown> = { type: blockType };
    if (blockType === "tool_use" && toolId && toolName) {
      contentBlock.id = toolId;
      contentBlock.name = toolName;
      contentBlock.input = {};
    } else if (blockType === "text") {
      contentBlock.text = "";
    }
    return this.event("content_block_start", {
      type: "content_block_start",
      index,
      content_block: contentBlock,
    });
  }

  private contentBlockDelta(index: number, text: string): SseEvent {
    return this.delta("content_block_delta", {
      type: "content_block_delta",
      index,
      delta: {
        type: "text_delta",
        text,
      },
    });
  }

  private contentBlockStop(index: number): SseEvent {
    return this.event("content_block_stop", {
      type: "content_block_stop",
      index,
    });
  }

  private delta(eventType: string, data: unknown): SseEvent {
    return this.event(eventType, data);
  }

  private event(eventType: string, data: unknown): SseEvent {
    return {
      event: eventType,
      data: JSON.stringify(data),
    };
  }
}

export function formatAnthropicSse(
  deltas: IrStreamDelta[],
  requestId: string,
  model: string,
): string {
  const formatter = new AnthropicSseFormatter(requestId, model);
  const events = formatter.formatDeltas(deltas);
  return events
    .map((e) => {
      let result = "";
      if (e.event) {
        result += `event: ${e.event}\n`;
      }
      result += `data: ${e.data}\n\n`;
      return result;
    })
    .join("");
}
