/**
 * OpenAI Responses API SSE Formatter
 */

import type { IrStreamDelta } from "./types";

interface ToolCallState {
  id: string;
  name: string;
  arguments: string;
  outputIndex: number;
  kind: "function" | "custom";
}

export class OpenAIResponsesSseFormatter {
  private requestId: string;
  private model: string;
  private responseId: string;
  private msgId: string;

  private preambleSent = false;
  private textItemSent = false;
  private accumulatedText = "";
  private toolCalls: ToolCallState[] = [];
  private usage?: { inputTokens: number; outputTokens: number };
  private customToolNames: ReadonlySet<string>;

  constructor(
    requestId: string,
    model: string,
    customToolNames: ReadonlySet<string> = new Set(),
  ) {
    this.requestId = requestId;
    this.model = model;
    this.customToolNames = customToolNames;
    this.responseId = `resp_${requestId.replace(/-/g, "").slice(0, 24)}`;
    this.msgId = `msg_${requestId.replace(/-/g, "").slice(0, 24)}`;
  }

  start(): string {
    return "";
  }

  formatDeltas(deltas: IrStreamDelta[]): string {
    let out = "";
    for (const delta of deltas) {
      out += this.formatDelta(delta);
    }
    return out;
  }

  private formatDelta(delta: IrStreamDelta): string {
    switch (delta.type) {
      case "text": {
        let out = "";
        if (!this.preambleSent) {
          out += this.emitResponsePreamble();
        }
        if (!this.textItemSent) {
          out += this.emitTextItemPreamble();
        }
        this.accumulatedText += delta.text;
        out += this.sse("response.output_text.delta", {
          type: "response.output_text.delta",
          item_id: this.msgId,
          output_index: 0,
          content_index: 0,
          delta: delta.text,
        });
        return out;
      }

      case "tool_call_start": {
        let out = "";
        if (!this.preambleSent) {
          out += this.emitResponsePreamble();
        }
        const outputIndex =
          (this.textItemSent ? 1 : 0) + this.toolCalls.filter(Boolean).length;
        const kind = this.customToolNames.has(delta.name)
          ? "custom"
          : "function";
        this.toolCalls[delta.index] = {
          id: delta.id,
          name: delta.name,
          arguments: "",
          outputIndex,
          kind,
        };
        out += this.sse("response.output_item.added", {
          type: "response.output_item.added",
          output_index: outputIndex,
          item:
            kind === "custom"
              ? {
                  type: "custom_tool_call",
                  call_id: delta.id,
                  name: delta.name,
                  input: "",
                }
              : {
                  type: "function_call",
                  id: delta.id,
                  call_id: delta.id,
                  name: delta.name,
                  arguments: "",
                  status: "in_progress",
                },
        });
        return out;
      }

      case "tool_call_delta": {
        const tc = this.toolCalls[delta.index];
        if (tc) tc.arguments += delta.arguments;
        if (tc?.kind === "custom") return "";
        return this.sse("response.function_call_arguments.delta", {
          type: "response.function_call_arguments.delta",
          item_id: tc?.id ?? "",
          output_index: tc?.outputIndex ?? (this.textItemSent ? 1 : 0),
          delta: delta.arguments,
        });
      }

      case "usage":
        this.usage = delta.usage;
        return "";

      default:
        return "";
    }
  }

  done(
    _stopReason = "stop",
    usage?: { inputTokens: number; outputTokens: number },
  ): string {
    if (usage) this.usage = usage;
    let out = "";

    if (!this.preambleSent) {
      out += this.emitResponsePreamble();
    }
    if (!this.textItemSent && this.toolCalls.filter(Boolean).length === 0) {
      out += this.emitTextItemPreamble();
    }

    for (const tc of this.toolCalls) {
      if (!tc) continue;
      out += this.sse("response.output_item.done", {
        type: "response.output_item.done",
        output_index: tc.outputIndex,
        item: this.completedToolItem(tc),
      });
    }

    if (this.textItemSent) {
      out += this.sse("response.output_text.done", {
        type: "response.output_text.done",
        item_id: this.msgId,
        output_index: 0,
        content_index: 0,
        text: this.accumulatedText,
      });

      out += this.sse("response.content_part.done", {
        type: "response.content_part.done",
        item_id: this.msgId,
        output_index: 0,
        content_index: 0,
        part: {
          type: "output_text",
          text: this.accumulatedText,
          annotations: [],
        },
      });

      out += this.sse("response.output_item.done", {
        type: "response.output_item.done",
        output_index: 0,
        item: this.completedMessageItem(),
      });
    }

    const output: unknown[] = [];
    if (this.textItemSent) {
      output.push(this.completedMessageItem());
    }

    for (const tc of this.toolCalls) {
      if (!tc) continue;
      output.push(this.completedToolItem(tc));
    }

    out += this.sse("response.completed", {
      type: "response.completed",
      response: {
        id: this.responseId,
        object: "response",
        status: "completed",
        model: this.model,
        output,
        output_text: this.accumulatedText,
        usage: this.usage
          ? {
              input_tokens: this.usage.inputTokens,
              output_tokens: this.usage.outputTokens,
              total_tokens: this.usage.inputTokens + this.usage.outputTokens,
            }
          : null,
      },
    });

    out += "data: [DONE]\n\n";
    return out;
  }

  private emitResponsePreamble(): string {
    this.preambleSent = true;
    const base = {
      id: this.responseId,
      object: "response",
      status: "in_progress",
      model: this.model,
      output: [],
    };

    return (
      this.sse("response.created", {
        type: "response.created",
        response: { ...base },
      }) +
      this.sse("response.in_progress", {
        type: "response.in_progress",
        response: { ...base },
      })
    );
  }

  private emitTextItemPreamble(): string {
    this.textItemSent = true;
    return (
      this.sse("response.output_item.added", {
        type: "response.output_item.added",
        output_index: 0,
        item: {
          type: "message",
          id: this.msgId,
          status: "in_progress",
          role: "assistant",
          content: [],
        },
      }) +
      this.sse("response.content_part.added", {
        type: "response.content_part.added",
        item_id: this.msgId,
        output_index: 0,
        content_index: 0,
        part: { type: "output_text", text: "", annotations: [] },
      })
    );
  }

  private completedMessageItem(): Record<string, unknown> {
    return {
      type: "message",
      id: this.msgId,
      status: "completed",
      role: "assistant",
      content: [
        {
          type: "output_text",
          text: this.accumulatedText,
          annotations: [],
        },
      ],
    };
  }

  private completedToolItem(tc: ToolCallState): Record<string, unknown> {
    if (tc.kind === "custom") {
      return {
        type: "custom_tool_call",
        call_id: tc.id,
        name: tc.name,
        input: extractCustomInput(tc.arguments),
      };
    }

    return {
      type: "function_call",
      id: tc.id,
      call_id: tc.id,
      name: tc.name,
      arguments: tc.arguments,
      status: "completed",
    };
  }

  private sse(event: string, data: unknown): string {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  }
}

function extractCustomInput(argumentsText: string): string {
  try {
    const parsed = JSON.parse(argumentsText) as unknown;
    if (typeof parsed === "string") return parsed;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const input = (parsed as Record<string, unknown>).input;
      if (typeof input === "string") return input;
    }
  } catch {
    // A provider may return raw text for a custom tool despite the proxy schema.
  }
  return argumentsText;
}

export function formatOpenAIResponsesSse(
  deltas: IrStreamDelta[],
  requestId: string,
  model: string,
): string {
  const formatter = new OpenAIResponsesSseFormatter(requestId, model);
  return formatter.formatDeltas(deltas);
}
