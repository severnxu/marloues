/**
 * OpenAI Responses API -> IR Request Decoder
 * Used by Responses-compatible binary runtimes.
 */

import type {
  IrContentBlock,
  IrMessage,
  IrRequest,
  IrTool,
  IrToolChoice,
} from "../../types";

export interface ResponsesAPIRequest {
  model: string;
  input: string | ResponsesInputItem[];
  instructions?: string;
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
  tools?: ResponsesTool[];
  tool_choice?: ResponsesToolChoice;
  temperature?: number;
  max_output_tokens?: number;
  truncation?: "auto" | "disabled";
  top_p?: number;
  modalities?: ("text" | "audio")[];
}

export type ResponsesInputItem =
  | {
      type?: "message";
      role: "user" | "assistant" | "developer" | "system";
      content: string | ResponsesContent[];
    }
  | { type: "text"; text: string }
  | { type: "image"; image: { url: string } }
  | {
      type: "function_call";
      id?: string;
      call_id: string;
      name: string;
      arguments?: string;
    }
  | {
      type: "function_call_output";
      call_id: string;
      output: unknown;
    }
  | { type: "custom_tool_call"; call_id: string; name: string; input: string }
  | { type: "custom_tool_call_output"; call_id: string; output: unknown }
  | { type: "reasoning"; [key: string]: unknown };

export interface ResponsesContent {
  type: "input_text" | "input_image" | "output_text";
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

export type ResponsesToolChoice =
  "auto" | "none" | "required" | { type: "function"; name: string };

export function decodeOpenAIResponsesRequest(
  raw: ResponsesAPIRequest,
  requestId: string,
): IrRequest {
  const messages: IrMessage[] = [];
  let system = raw.instructions;
  let pendingToolTurn: PendingToolTurn | undefined;
  const inputItems: ResponsesInputItem[] =
    typeof raw.input === "string"
      ? [{ type: "text", text: raw.input }]
      : Array.isArray(raw.input)
        ? raw.input
        : [];

  for (const item of inputItems) {
    if (item.type === "function_call") {
      pendingToolTurn ??= { content: [], calls: [], outputs: [] };
      pendingToolTurn.calls.push({
        id: item.call_id,
        name: item.name,
        arguments: item.arguments ?? "{}",
      });
      continue;
    }
    if (item.type === "custom_tool_call") {
      pendingToolTurn ??= { content: [], calls: [], outputs: [] };
      pendingToolTurn.calls.push({
        id: item.call_id,
        name: item.name,
        arguments: JSON.stringify({ input: item.input }),
      });
      continue;
    }
    if (
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
      continue;
    }
    if (item.type === "reasoning") continue;

    if (item.type === "text") {
      flushPendingToolTurn(messages, pendingToolTurn);
      pendingToolTurn = undefined;
      messages.push({ role: "user", content: item.text });
      continue;
    }
    if (item.type === "image") {
      flushPendingToolTurn(messages, pendingToolTurn);
      pendingToolTurn = undefined;
      messages.push({
        role: "user",
        content: [
          {
            type: "image",
            mediaType: imageMediaType(item.image.url),
            data: item.image.url,
          },
        ],
      });
      continue;
    }
    if (!("role" in item) || !item.role) continue;

    const text = extractTextContent(item.content);
    if (item.role === "developer" || item.role === "system") {
      flushPendingToolTurn(messages, pendingToolTurn);
      pendingToolTurn = undefined;
      system = system ? `${system}\n${text}` : text;
      continue;
    }
    if (item.role === "assistant" && pendingToolTurn) {
      if (text) pendingToolTurn.content.push(text);
      continue;
    }
    flushPendingToolTurn(messages, pendingToolTurn);
    pendingToolTurn = undefined;
    if (item.role === "assistant" && !text) continue;
    messages.push({
      role: item.role,
      content: convertMessageContent(item.content),
    });
  }

  flushPendingToolTurn(messages, pendingToolTurn);

  return {
    model: raw.model,
    messages,
    system,
    tools: decodeTools(raw.tools),
    toolChoice: convertToolChoice(raw.tool_choice),
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
      input: { type: "string", description: "Raw input for this tool." },
    },
    required: ["input"],
    additionalProperties: false,
  };
}

function convertMessageContent(
  content: string | ResponsesContent[] | undefined,
): string | IrContentBlock[] {
  if (!content) return "";
  if (typeof content === "string") return content;
  const blocks: IrContentBlock[] = [];
  for (const part of content) {
    if (part.type === "input_text" || part.type === "output_text") {
      blocks.push({ type: "text", text: part.text ?? "" });
    } else if (part.type === "input_image" && part.image?.url) {
      blocks.push({
        type: "image",
        mediaType: imageMediaType(part.image.url),
        data: part.image.url,
      });
    }
  }
  return blocks.length === 1 && blocks[0].type === "text"
    ? (blocks[0].text ?? "")
    : blocks;
}

function extractTextContent(
  content: string | ResponsesContent[] | undefined,
): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .filter(
      (part): part is ResponsesContent & { text: string } =>
        (part.type === "input_text" || part.type === "output_text") &&
        typeof part.text === "string",
    )
    .map((part) => part.text)
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

function imageMediaType(url: string): string {
  const match = url.match(/^data:([^;,]+)/);
  return match?.[1] ?? "image/png";
}

function convertToolChoice(
  choice: ResponsesToolChoice | undefined,
): IrToolChoice | undefined {
  if (!choice) return undefined;
  if (choice === "auto" || choice === "none" || choice === "required") {
    return choice;
  }
  if (typeof choice === "object" && choice.type === "function") {
    return { type: "function", name: choice.name };
  }
  return undefined;
}
