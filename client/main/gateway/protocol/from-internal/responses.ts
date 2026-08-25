/**
 * IR Request -> OpenAI Responses API Encoder
 */

import type { IrRequest, IrToolChoice } from "../../types";

export interface OpenAIResponsesRequestBody {
  model: string;
  instructions?: string;
  input: ResponsesInputItem[];
  tools?: ResponsesTool[];
  tool_choice?: ResponsesToolChoice;
  temperature?: number;
  top_p?: number;
  max_output_tokens?: number;
  stream?: boolean;
}

export type ResponsesInputItem =
  | {
      type: "message";
      role: "user" | "assistant";
      content: ResponsesMessageContent[];
    }
  | {
      type: "function_call";
      call_id: string;
      name: string;
      arguments: string;
    }
  | {
      type: "function_call_output";
      call_id: string;
      output: string;
    };

export type ResponsesMessageContent =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string }
  | { type: "output_text"; text: string };

export interface ResponsesTool {
  type: "function";
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
}

export type ResponsesToolChoice =
  "auto" | "none" | "required" | { type: "function"; name: string };

export function encodeOpenAIResponsesRequest(
  ir: IrRequest,
): OpenAIResponsesRequestBody {
  const input: ResponsesInputItem[] = [];

  for (const message of ir.messages) {
    if (message.role === "system") continue;

    if (message.role === "tool") {
      if (message.toolCallId) {
        input.push({
          type: "function_call_output",
          call_id: message.toolCallId,
          output: extractText(message.content),
        });
      }
      continue;
    }

    if (message.role === "assistant" && message.toolCalls?.length) {
      if (hasText(message.content)) {
        input.push(messageItem("assistant", message.content, "output_text"));
      }
      for (const toolCall of message.toolCalls) {
        input.push({
          type: "function_call",
          call_id: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.arguments,
        });
      }
      continue;
    }

    input.push(messageItem(message.role, message.content, "input_text"));
  }

  const body: OpenAIResponsesRequestBody = {
    model: ir.model,
    input,
    stream: ir.stream,
  };

  if (ir.system) body.instructions = ir.system;
  if (ir.generation.temperature !== undefined)
    body.temperature = ir.generation.temperature;
  if (ir.generation.topP !== undefined) body.top_p = ir.generation.topP;
  if (ir.generation.maxTokens !== undefined)
    body.max_output_tokens = ir.generation.maxTokens;

  const tools = ir.tools?.filter((tool) => tool.name);
  if (tools?.length) {
    body.tools = tools.map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters:
        tool.parameters && Object.keys(tool.parameters).length > 0
          ? tool.parameters
          : { type: "object", properties: {} },
    }));
  }

  if (ir.toolChoice) {
    const toolChoice = convertToolChoice(ir.toolChoice);
    if (toolChoice) body.tool_choice = toolChoice;
  }

  return body;
}

function messageItem(
  role: "user" | "assistant",
  content: IrRequest["messages"][number]["content"],
  textType: "input_text" | "output_text",
): ResponsesInputItem {
  return {
    type: "message",
    role,
    content: Array.isArray(content)
      ? content.flatMap((part): ResponsesMessageContent[] => {
          if (part.type === "text" && part.text) {
            return [{ type: textType, text: part.text }];
          }
          if (part.type === "image" && part.data) {
            return [{ type: "input_image", image_url: part.data }];
          }
          return [];
        })
      : [{ type: textType, text: content }],
  };
}

function hasText(content: IrRequest["messages"][number]["content"]): boolean {
  return Boolean(extractText(content));
}

function extractText(
  content: IrRequest["messages"][number]["content"],
): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part.type === "text" && part.text)
    .map((part) => part.text ?? "")
    .join("");
}

function convertToolChoice(
  choice: IrToolChoice,
): ResponsesToolChoice | undefined {
  if (choice === "auto" || choice === "none" || choice === "required")
    return choice;
  if (typeof choice === "object" && choice.type === "function") {
    return { type: "function", name: choice.name };
  }
  return undefined;
}
