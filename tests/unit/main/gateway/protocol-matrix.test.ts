import { describe, expect, it } from "vitest";

import {
  decodeRequest,
  encodeRequest,
  formatResponse,
  parseResponse,
} from "../../../../client/main/gateway/protocol";
import { AnthropicSseParser } from "../../../../client/main/gateway/protocol/stream/anthropic";
import { OpenAIChatSseParser } from "../../../../client/main/gateway/protocol/stream/openai-chat";
import { OpenAIResponsesSseParser } from "../../../../client/main/gateway/protocol/stream/responses";
import type { IrRequest } from "../../../../client/main/gateway/types";
import type { ProtocolId } from "../../../../client/main/gateway/types";

const protocols: ProtocolId[] = [
  "anthropic",
  "openai-chat",
  "openai-responses",
];

const requests = {
  anthropic: {
    model: "test-model",
    system: "You are concise.",
    messages: [
      { role: "user", content: "Use the tool." },
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "call-1",
            name: "lookup",
            input: { city: "SF" },
          },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "call-1", content: "22C" },
        ],
      },
    ],
    tools: [
      {
        name: "lookup",
        description: "Look up weather",
        input_schema: { type: "object", properties: {} },
      },
    ],
    max_tokens: 128,
    stream: false,
  },
  "openai-chat": {
    model: "test-model",
    messages: [
      { role: "system", content: "You are concise." },
      { role: "user", content: "Use the tool." },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: { name: "lookup", arguments: '{"city":"SF"}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "call-1", content: "22C" },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "lookup",
          description: "Look up weather",
          parameters: { type: "object", properties: {} },
        },
      },
    ],
    max_tokens: 128,
    stream: false,
  },
  "openai-responses": {
    model: "test-model",
    instructions: "You are concise.",
    input: [
      { role: "user", content: "Use the tool." },
      {
        type: "function_call",
        call_id: "call-1",
        name: "lookup",
        arguments: '{"city":"SF"}',
      },
      { type: "function_call_output", call_id: "call-1", output: "22C" },
    ],
    tools: [
      {
        type: "function",
        name: "lookup",
        description: "Look up weather",
        parameters: { type: "object", properties: {} },
      },
    ],
    max_output_tokens: 128,
    stream: false,
  },
} as const;

const responses = {
  anthropic: {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "test-model",
    content: [
      { type: "text", text: "It is 22C." },
      { type: "tool_use", id: "call-1", name: "lookup", input: { city: "SF" } },
    ],
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  },
  "openai-chat": {
    id: "chatcmpl_1",
    object: "chat.completion",
    created: 1,
    model: "test-model",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: "It is 22C.",
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: { name: "lookup", arguments: '{"city":"SF"}' },
            },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  },
  "openai-responses": {
    id: "resp_1",
    object: "response",
    status: "completed",
    model: "test-model",
    output: [
      {
        id: "msg_1",
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "It is 22C." }],
      },
      {
        id: "fc_1",
        call_id: "call-1",
        type: "function_call",
        name: "lookup",
        arguments: '{"city":"SF"}',
      },
    ],
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
  },
} as const;

describe("gateway protocol matrix", () => {
  it("decodes all three source protocols and encodes every target protocol", () => {
    for (const source of protocols) {
      const ir = decodeRequest(source, requests[source], "request-1");

      expect(ir.model).toBe("test-model");
      expect(ir.system).toBe("You are concise.");
      expect(ir.messages.some((message) => message.role === "tool")).toBe(true);
      expect(ir.tools?.[0]?.name).toBe("lookup");

      for (const target of protocols) {
        const encoded = encodeRequest(target, ir);
        expect(encoded.path).toBe(paths[target]);
        expect((encoded.body as { model: string }).model).toBe("test-model");
        assertTargetRequest(target, encoded.body as Record<string, unknown>);
      }
    }
  });

  it("parses every upstream protocol and formats every client protocol", () => {
    for (const upstream of protocols) {
      const ir = parseResponse(
        upstream,
        responses[upstream],
        "request-1",
        "test-model",
      );

      expect(ir.usage.inputTokens).toBe(10);
      expect(ir.usage.outputTokens).toBe(5);
      expect(irText(ir.choices[0].message.content)).toContain("It is 22C.");
      expect(ir.choices[0].message.toolCalls?.[0]).toMatchObject({
        id: "call-1",
        name: "lookup",
      });

      for (const client of protocols) {
        const formatted = formatResponse(client, ir) as Record<string, unknown>;
        assertFormattedResponse(client, formatted);
      }
    }
  });

  it("parses OpenAI Responses streaming text, tool calls, and usage", () => {
    const parser = new OpenAIResponsesSseParser();
    const deltas = [
      ...parser.parseChunk(
        [
          "event: response.output_item.added",
          'data: {"type":"response.output_item.added","item":{"id":"fc_1","call_id":"call-1","type":"function_call","name":"lookup"}}',
          "",
        ].join("\n"),
      ),
      ...parser.parseChunk(
        'data: {"type":"response.function_call_arguments.delta","item_id":"fc_1","delta":"{\\"city\\":\\"SF\\"}"}\n\n',
      ),
      ...parser.parseChunk(
        'data: {"type":"response.output_text.delta","delta":"It is 22C."}\n\n',
      ),
      ...parser.parseChunk(
        'data: {"type":"response.completed","response":{"usage":{"input_tokens":10,"output_tokens":5}}}\n\n',
      ),
    ];

    expect(deltas).toEqual([
      { type: "tool_call_start", index: 0, id: "call-1", name: "lookup" },
      { type: "tool_call_delta", index: 0, arguments: '{"city":"SF"}' },
      { type: "text", text: "It is 22C." },
      { type: "usage", usage: { inputTokens: 10, outputTokens: 5 } },
      { type: "done", stopReason: "stop" },
    ]);
  });

  it("parses terminal stream metadata from Anthropic and OpenAI Chat", () => {
    const anthropicParser = new AnthropicSseParser();
    const anthropicDeltas = [
      ...anthropicParser.parseChunk(
        'data: {"type":"message_start","message":{"usage":{"input_tokens":10,"output_tokens":0}}}\n\n',
      ),
      ...anthropicParser.parseChunk(
        'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":5}}\n\n',
      ),
    ];

    expect(anthropicDeltas).toEqual([
      { type: "usage", usage: { inputTokens: 10, outputTokens: 0 } },
      { type: "done", stopReason: "tool_use" },
      { type: "usage", usage: { inputTokens: 10, outputTokens: 5 } },
    ]);

    const chatParser = new OpenAIChatSseParser();
    const chatDeltas = chatParser.parseChunk(
      'data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n',
    );

    expect(chatDeltas).toEqual([
      { type: "usage", usage: { inputTokens: 10, outputTokens: 5 } },
      { type: "done", stopReason: "tool_calls" },
    ]);
  });
});

const paths: Record<ProtocolId, string> = {
  anthropic: "/v1/messages",
  "openai-chat": "/v1/chat/completions",
  "openai-responses": "/v1/responses",
};

function assertTargetRequest(
  protocol: ProtocolId,
  body: Record<string, unknown>,
): void {
  if (protocol === "anthropic") {
    expect(body.system).toBe("You are concise.");
    expect(JSON.stringify(body.messages)).toContain("call-1");
    expect(JSON.stringify(body.messages)).toContain("lookup");
  } else if (protocol === "openai-chat") {
    expect(body.messages).toBeDefined();
    expect(JSON.stringify(body.messages)).toContain("call-1");
    expect(JSON.stringify(body.tools)).toContain("lookup");
  } else {
    expect(body.instructions).toBe("You are concise.");
    expect(JSON.stringify(body.input)).toContain("call-1");
    expect(JSON.stringify(body.tools)).toContain("lookup");
  }
}

function assertFormattedResponse(
  protocol: ProtocolId,
  body: Record<string, unknown>,
): void {
  const serialized = JSON.stringify(body);
  expect(serialized).toContain("It is 22C.");
  expect(serialized).toContain("call-1");
  expect(serialized).toContain("lookup");

  if (protocol === "anthropic") expect(body.type).toBe("message");
  if (protocol === "openai-chat") expect(body.object).toBe("chat.completion");
  if (protocol === "openai-responses") expect(body.object).toBe("response");
}

function irText(
  content: string | IrRequest["messages"][number]["content"],
): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("");
}
