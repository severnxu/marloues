/**
 * Protocol Conversion Layer
 */

export * from "../types";
export { AnthropicSseParser, parseAnthropicSseChunk } from "./stream/anthropic";
export {
  OpenAIChatSseParser,
  parseOpenAIChatSseChunk,
} from "./stream/openai-chat";
export {
  OpenAIResponsesSseParser,
  parseOpenAIResponsesSseChunk,
} from "./stream/responses";
export {
  AnthropicSseFormatter,
  formatAnthropicSse,
} from "./stream/anthropic-formatter";
export {
  OpenAIChatSseFormatter,
  formatOpenAIChatSse,
} from "./stream/openai-chat-formatter";
export {
  OpenAIResponsesSseFormatter,
  formatOpenAIResponsesSse,
} from "./stream/responses-formatter";
export type { SseEvent } from "./stream/types";

import type { IrRequest, IrResponse, ProtocolId } from "../types";

import { decodeAnthropicRequest } from "./to-internal/anthropic";
import { decodeOpenAIChatRequest } from "./to-internal/openai-chat";
import { decodeOpenAIResponsesRequest } from "./to-internal/responses";
import { encodeAnthropicRequest } from "./from-internal/anthropic";
import { encodeOpenAIChatRequest } from "./from-internal/openai-chat";
import { encodeOpenAIResponsesRequest } from "./from-internal/responses";
import { parseAnthropicResponse } from "./response/to-internal/anthropic";
import { parseOpenAIChatResponse } from "./response/to-internal/openai-chat";
import { parseOpenAIResponsesResponse } from "./response/to-internal/responses";
import { formatAnthropicResponse } from "./response/from-internal/anthropic";
import { formatOpenAIChatResponse } from "./response/from-internal/openai-chat";
import { formatOpenAIResponsesResponse } from "./response/from-internal/responses";

export {
  decodeAnthropicRequest,
  decodeOpenAIChatRequest,
  decodeOpenAIResponsesRequest,
  encodeAnthropicRequest,
  encodeOpenAIChatRequest,
  encodeOpenAIResponsesRequest,
  parseAnthropicResponse,
  parseOpenAIChatResponse,
  parseOpenAIResponsesResponse,
  formatAnthropicResponse,
  formatOpenAIChatResponse,
  formatOpenAIResponsesResponse,
};

export function decodeRequest(
  protocol: ProtocolId,
  raw: unknown,
  requestId: string,
): IrRequest {
  switch (protocol) {
    case "anthropic":
      return decodeAnthropicRequest(
        raw as Parameters<typeof decodeAnthropicRequest>[0],
        requestId,
      );
    case "openai-chat":
      return decodeOpenAIChatRequest(
        raw as Parameters<typeof decodeOpenAIChatRequest>[0],
        requestId,
      );
    case "openai-responses":
      return decodeOpenAIResponsesRequest(
        raw as Parameters<typeof decodeOpenAIResponsesRequest>[0],
        requestId,
      );
  }
}

interface EncodedRequest {
  body: unknown;
  headers: Record<string, string>;
  path: string;
}

export function encodeRequest(
  protocol: ProtocolId,
  ir: IrRequest,
): EncodedRequest {
  switch (protocol) {
    case "anthropic":
      return {
        body: encodeAnthropicRequest(ir),
        headers: {
          "Content-Type": "application/json",
          "anthropic-version": "2023-06-01",
        },
        path: "/v1/messages",
      };
    case "openai-chat":
      return {
        body: encodeOpenAIChatRequest(ir),
        headers: {
          "Content-Type": "application/json",
        },
        path: "/v1/chat/completions",
      };
    case "openai-responses":
      return {
        body: encodeOpenAIResponsesRequest(ir),
        headers: {
          "Content-Type": "application/json",
        },
        path: "/v1/responses",
      };
  }
}

export function parseResponse(
  protocol: ProtocolId,
  raw: unknown,
  requestId: string,
  originalModel: string,
): IrResponse {
  switch (protocol) {
    case "anthropic":
      return parseAnthropicResponse(
        raw as Parameters<typeof parseAnthropicResponse>[0],
        requestId,
        originalModel,
      );
    case "openai-chat":
      return parseOpenAIChatResponse(
        raw as Parameters<typeof parseOpenAIChatResponse>[0],
        requestId,
        originalModel,
      );
    case "openai-responses":
      return parseOpenAIResponsesResponse(
        raw as Parameters<typeof parseOpenAIResponsesResponse>[0],
        requestId,
        originalModel,
      );
  }
}

export function formatResponse(protocol: ProtocolId, ir: IrResponse): unknown {
  switch (protocol) {
    case "anthropic":
      return formatAnthropicResponse(ir);
    case "openai-chat":
      return formatOpenAIChatResponse(ir);
    case "openai-responses":
      return formatOpenAIResponsesResponse(ir);
  }
}

export function needsConversion(
  sourceProtocol: ProtocolId,
  targetProtocol: ProtocolId,
): boolean {
  return sourceProtocol !== targetProtocol;
}
