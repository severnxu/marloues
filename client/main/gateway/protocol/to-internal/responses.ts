/**
 * OpenAI Responses API -> IR Request Decoder
 * Used by Responses-compatible binary runtimes.
 */

import type { IrRequest, IrMessage, IrTool } from "../../types";

export interface ResponsesAPIRequest {
  model: string;
  input: ResponsesInputItem[];
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
  tools?: ResponsesTool[];
  temperature?: number;
  max_output_tokens?: number;
  truncation?: "auto" | "disabled";
  top_p?: number;
  modalities?: ("text" | "audio")[];
}

export type ResponsesInputItem =
  | {
      type: "message";
      role: "user" | "assistant" | "developer" | "system";
      content: string | ResponsesContent[];
    }
  | { type: "text"; text: string }
  | { type: "image"; image: { url: string } }
  | { type: "function_call"; call_id: string; name: string; arguments: string }
  | { type: "function_call_output"; call_id: string; output: unknown }
  | { type: "custom_tool_call"; call_id: string; name: string; input: string }
  | { type: "custom_tool_call_output"; call_id: string; output: unknown }
  | { type: "reasoning"; [key: string]: unknown };

export interface ResponsesContent {
  type: "input_text" | "output_text" | "input_image";
  text?: string;
  image?: { url: string };
}

export interface ResponsesTool {
  type: string;
  name?: unknown;
  description?: string;
  parameters?: Record<string, unknown>;
  format?: unknown;
}

export function decodeOpenAIResponsesRequest(
  raw: ResponsesAPIRequest,
  requestId: string,
): IrRequest {
  const messages: IrMessage[] = [];
  let pendingToolTurn: PendingToolTurn | undefined;

  // Normalize input — may be a string or an array of items
  const inputItems: ResponsesInputItem[] =
    typeof raw.input === "string"
      ? [{ type: "text", text: raw.input }]
      : Array.isArray(raw.input)
        ? raw.input
        : [];

  for (const item of inputItems) {
    if (item.type === "message") {
      const content = extractTextContent(item.content);
      const role: IrMessage["role"] =
        item.role === "developer" ? "system" : item.role;
      if (role === "assistant" && pendingToolTurn) {
        if (content) pendingToolTurn.content.push(content);
        continue;
      }
      flushPendingToolTurn(messages, pendingToolTurn);
      pendingToolTurn = undefined;
      if (role === "assistant" && !content) continue;
      messages.push({ role, content });
    } else if (item.type === "text") {
      flushPendingToolTurn(messages, pendingToolTurn);
      pendingToolTurn = undefined;
      messages.push({ role: "user", content: item.text });
    } else if (item.type === "function_call") {
      pendingToolTurn ??= { content: [], calls: [], outputs: [] };
      pendingToolTurn.calls.push({
        id: item.call_id,
        name: item.name,
        arguments: item.arguments,
      });
    } else if (item.type === "custom_tool_call") {
      pendingToolTurn ??= { content: [], calls: [], outputs: [] };
      pendingToolTurn.calls.push({
        id: item.call_id,
        name: item.name,
        arguments: JSON.stringify({ input: item.input }),
      });
    } else if (
      item.type === "function_call_output" ||
      item.type === "custom_tool_call_output"
    ) {
      const output: IrMessage = {
        role: "tool",
        content: extractToolOutput(item.output),
        toolCallId: item.call_id,
      };
      if (pendingToolTurn?.calls.some((call) => call.id === item.call_id)) {
        pendingToolTurn.outputs.push(output);
        if (pendingToolTurn.outputs.length === pendingToolTurn.calls.length) {
          flushPendingToolTurn(messages, pendingToolTurn);
          pendingToolTurn = undefined;
        }
      } else {
        flushPendingToolTurn(messages, pendingToolTurn);
        pendingToolTurn = undefined;
        messages.push(output);
      }
    }
  }

  flushPendingToolTurn(messages, pendingToolTurn);

  const tools = decodeTools(raw.tools);

  return {
    model: raw.model,
    messages,
    tools,
    generation: {
      temperature: raw.temperature,
      maxTokens: raw.max_output_tokens,
      topP: raw.top_p,
    },
    stream: raw.stream ?? false,
    meta: {
      sourceProtocol: "openai-responses",
      requestId,
      originalModel: raw.model,
    },
  };
}

interface PendingToolTurn {
  content: string[];
  calls: NonNullable<IrMessage["toolCalls"]>;
  outputs: IrMessage[];
}

function flushPendingToolTurn(
  messages: IrMessage[],
  pending: PendingToolTurn | undefined,
): void {
  if (!pending) return;
  if (pending.calls.length > 0) {
    messages.push({
      role: "assistant",
      content: pending.content.join(""),
      toolCalls: pending.calls,
    });
  } else {
    for (const content of pending.content) {
      messages.push({ role: "assistant", content });
    }
  }
  messages.push(...pending.outputs);
}

function decodeTools(
  rawTools: ResponsesTool[] | undefined,
): IrTool[] | undefined {
  if (!rawTools) return undefined;

  const tools: IrTool[] = [];
  for (const tool of rawTools) {
    if (
      (tool.type !== "function" && tool.type !== "custom") ||
      typeof tool.name !== "string" ||
      !tool.name.trim()
    ) {
      continue;
    }

    tools.push({
      name: tool.name,
      description: tool.description,
      kind: tool.type,
      parameters:
        tool.type === "custom"
          ? customToolInputSchema()
          : normalizeParameters(tool.parameters),
    });
  }

  return tools.length > 0 ? tools : undefined;
}

function normalizeParameters(
  parameters: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return parameters &&
    typeof parameters === "object" &&
    !Array.isArray(parameters)
    ? parameters
    : { type: "object", properties: {} };
}

function customToolInputSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      input: {
        type: "string",
        description: "Raw input for this tool.",
      },
    },
    required: ["input"],
    additionalProperties: false,
  };
}

function extractTextContent(
  content: string | ResponsesContent[] | undefined,
): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .filter(
      (p): p is ResponsesContent & { text: string } =>
        (p.type === "input_text" || p.type === "output_text") &&
        typeof p.text === "string",
    )
    .map((p) => p.text)
    .join("");
}

function extractToolOutput(output: unknown): string {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) {
    return output
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const text = (item as Record<string, unknown>).text;
          if (typeof text === "string") return text;
        }
        return "";
      })
      .join("");
  }
  return output === undefined ? "" : JSON.stringify(output);
}
