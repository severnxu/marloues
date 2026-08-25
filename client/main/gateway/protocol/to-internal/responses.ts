/**
 * OpenAI Responses API -> IR Request Decoder
 * Used by Responses-compatible binary runtimes.
 */

import type {
  IrContentBlock,
  IrRequest,
  IrMessage,
  IrTool,
  IrToolChoice,
} from "../../types";

export interface ResponsesAPIRequest {
  model: string;
  input: string | ResponsesInputItem[];
  instructions?: string;
  stream?: boolean;
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
      output: string | ResponsesContent[] | Record<string, unknown>;
    };

export interface ResponsesContent {
  type: "input_text" | "input_image" | "output_text";
  text?: string;
  image?: { url: string };
}

export interface ResponsesTool {
  type: "function";
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export type ResponsesToolChoice =
  "auto" | "none" | "required" | { type: "function"; name: string };

export function decodeOpenAIResponsesRequest(
  raw: ResponsesAPIRequest,
  requestId: string,
): IrRequest {
  const messages: IrMessage[] = [];
  let system = raw.instructions;

  // Normalize input — may be a string or an array of items
  const inputItems: ResponsesInputItem[] =
    typeof raw.input === "string"
      ? [{ type: "text", text: raw.input }]
      : Array.isArray(raw.input)
        ? raw.input
        : [];

  for (const item of inputItems) {
    if (item.type === "function_call") {
      messages.push({
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: item.call_id,
            name: item.name,
            arguments: item.arguments ?? "{}",
          },
        ],
      });
    } else if (item.type === "function_call_output") {
      messages.push({
        role: "tool",
        content: extractOutput(item.output),
        toolCallId: item.call_id,
      });
    } else if (item.type === "text") {
      messages.push({ role: "user", content: item.text });
    } else if (item.type === "image") {
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
    } else if ("role" in item && item.role) {
      const content = convertMessageContent(item.content);
      if (item.role === "developer" || item.role === "system") {
        const text = extractTextContent(item.content);
        system = system ? `${system}\n${text}` : text;
      } else {
        messages.push({ role: item.role, content });
      }
    }
  }

  const tools: IrTool[] | undefined = raw.tools?.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters ?? {},
  }));

  return {
    model: raw.model,
    messages,
    system,
    tools,
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
    .filter((p) => p.type === "input_text" || p.type === "output_text")
    .map((p) => p.text)
    .join("");
}

function extractOutput(
  output: string | ResponsesContent[] | Record<string, unknown>,
): string {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) {
    return output
      .filter((p) => p.type === "output_text" || p.type === "input_text")
      .map((p) => p.text ?? "")
      .join("");
  }
  return JSON.stringify(output);
}

function imageMediaType(url: string): string {
  const match = url.match(/^data:([^;,]+)/);
  return match?.[1] ?? "image/png";
}

function convertToolChoice(
  choice: ResponsesToolChoice | undefined,
): IrToolChoice | undefined {
  if (!choice) return undefined;
  if (choice === "auto" || choice === "none" || choice === "required")
    return choice;
  if (typeof choice === "object" && choice.type === "function") {
    return { type: "function", name: choice.name };
  }
  return undefined;
}
