import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../client/main/core/logging/app-logger", () => ({
  isDeveloperMode: () => false,
  logHttp: vi.fn(),
  logQuiet: vi.fn(),
}));

import {
  configurePipeline,
  type RouteDecision,
} from "../../../../client/main/gateway/pipeline";
import {
  startServer,
  stopServer,
} from "../../../../client/main/gateway/server";
import type { ProtocolId } from "../../../../client/main/gateway/types";

interface CapturedRequest {
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: Record<string, unknown>;
}

describe("gateway protocol runtime paths", () => {
  afterEach(async () => {
    await stopServer();
  });

  it("converts an Anthropic client request to an OpenAI Chat upstream", async () => {
    const upstream = await startUpstream({
      path: "/v1/chat/completions",
      response: openAIChatResponse(),
    });
    const gatewayPort = await startGatewayWithRoute({
      protocol: "openai-chat",
      baseUrl: upstream.url,
      apiKey: "openai-key",
      model: "openai-model",
    });

    const response = await fetch(
      `http://127.0.0.1:${gatewayPort}/v1/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "anthropic-model",
          system: "You are concise.",
          max_tokens: 128,
          messages: [{ role: "user", content: "Use the tool." }],
          tools: [
            {
              name: "lookup",
              description: "Look up weather",
              input_schema: { type: "object", properties: {} },
            },
          ],
        }),
      },
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.type).toBe("message");
    expect(JSON.stringify(body.content)).toContain("It is 22C.");
    expect(JSON.stringify(body.content)).toContain("call-1");
    expect(body.stop_reason).toBe("tool_use");
    expect(upstream.request?.path).toBe("/v1/chat/completions");
    expect(upstream.request?.headers.authorization).toBe("Bearer openai-key");
    expect(upstream.request?.body.model).toBe("openai-model");
    expect(upstream.request?.body.messages).toContainEqual(
      expect.objectContaining({ role: "system", content: "You are concise." }),
    );
    expect(upstream.request?.body.messages).toContainEqual(
      expect.objectContaining({
        role: "user",
        content: "Use the tool.",
      }),
    );

    await closeUpstream(upstream);
  });

  it("converts an OpenAI Responses client request to an Anthropic upstream", async () => {
    const upstream = await startUpstream({
      path: "/v1/messages",
      response: anthropicResponse(),
    });
    const gatewayPort = await startGatewayWithRoute({
      protocol: "anthropic",
      baseUrl: upstream.url,
      apiKey: "anthropic-key",
      model: "anthropic-model",
    });

    const response = await fetch(
      `http://127.0.0.1:${gatewayPort}/v1/responses`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "responses-model",
          instructions: "You are concise.",
          input: [{ role: "user", content: "Use the tool." }],
          tools: [
            {
              type: "function",
              name: "lookup",
              description: "Look up weather",
              parameters: { type: "object", properties: {} },
            },
          ],
          max_output_tokens: 128,
        }),
      },
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.object).toBe("response");
    expect(JSON.stringify(body.output)).toContain("It is 22C.");
    expect(JSON.stringify(body.output)).toContain("call-1");
    expect(upstream.request?.path).toBe("/v1/messages");
    expect(upstream.request?.headers["x-api-key"]).toBe("anthropic-key");
    expect(upstream.request?.body.model).toBe("anthropic-model");
    expect(upstream.request?.body.system).toBe("You are concise.");
    expect(upstream.request?.body.messages).toContainEqual(
      expect.objectContaining({
        role: "user",
        content: [{ type: "text", text: "Use the tool." }],
      }),
    );

    await closeUpstream(upstream);
  });

  it("streams an Anthropic client response from an OpenAI Chat upstream", async () => {
    const upstream = await startUpstream({
      path: "/v1/chat/completions",
      sse: [
        'data: {"choices":[{"index":0,"delta":{"content":"It is 22C."}}]}\n\n',
        "data: [DONE]\n\n",
      ].join(""),
    });
    const gatewayPort = await startGatewayWithRoute({
      protocol: "openai-chat",
      baseUrl: upstream.url,
      apiKey: "openai-key",
      model: "openai-model",
    });

    const response = await fetch(
      `http://127.0.0.1:${gatewayPort}/v1/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "anthropic-model",
          max_tokens: 128,
          stream: true,
          messages: [{ role: "user", content: "Hello" }],
        }),
      },
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(body).toContain("message_start");
    expect(body).toContain("content_block_delta");
    expect(body).toContain("It is 22C.");
    expect(body).toContain("message_stop");
    expect(upstream.request?.body.stream).toBe(true);

    await closeUpstream(upstream);
  });

  it("streams an OpenAI Responses client response from an Anthropic upstream", async () => {
    const upstream = await startUpstream({
      path: "/v1/messages",
      sse: [
        'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10,"output_tokens":0}}}\n\n',
        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"It is 22C."}}\n\n',
        'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ].join(""),
    });
    const gatewayPort = await startGatewayWithRoute({
      protocol: "anthropic",
      baseUrl: upstream.url,
      apiKey: "anthropic-key",
      model: "anthropic-model",
    });

    const response = await fetch(
      `http://127.0.0.1:${gatewayPort}/v1/responses`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "responses-model",
          stream: true,
          input: [{ role: "user", content: "Hello" }],
        }),
      },
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(body).toContain("response.created");
    expect(body).toContain("response.output_text.delta");
    expect(body).toContain("It is 22C.");
    expect(body).toContain("response.completed");
    expect(upstream.request?.body.stream).toBe(true);

    await closeUpstream(upstream);
  });

  it("streams tool calls from an OpenAI Chat upstream to an Anthropic client", async () => {
    const upstream = await startUpstream({
      path: "/v1/chat/completions",
      sse: [
        'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"lookup","arguments":""}}]}}]}\n\n',
        'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"city\\":\\"SF\\"}"}}]}}]}\n\n',
        'data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n',
        "data: [DONE]\n\n",
      ].join(""),
    });
    const gatewayPort = await startGatewayWithRoute({
      protocol: "openai-chat",
      baseUrl: upstream.url,
      apiKey: "openai-key",
      model: "openai-model",
    });

    const response = await fetch(
      `http://127.0.0.1:${gatewayPort}/v1/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "anthropic-model",
          max_tokens: 128,
          stream: true,
          messages: [{ role: "user", content: "Use the tool." }],
          tools: [
            {
              name: "lookup",
              input_schema: { type: "object", properties: {} },
            },
          ],
        }),
      },
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("message_start");
    expect(body).toContain('"type":"tool_use"');
    expect(body).toContain('"id":"call-1"');
    expect(body).toContain("input_json_delta");
    expect(body).toContain('\\"city\\":\\"SF\\"');
    expect(body).toContain('"stop_reason":"tool_use"');
    expect(body).toContain('"input_tokens":10');
    expect(body).toContain('"output_tokens":5');
    expect(body).toContain("message_stop");

    await closeUpstream(upstream);
  });

  it("streams tool calls from an Anthropic upstream to an OpenAI Responses client", async () => {
    const upstream = await startUpstream({
      path: "/v1/messages",
      sse: [
        'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10,"output_tokens":0}}}\n\n',
        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"call-1","name":"lookup","input":{}}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"city\\":\\"SF\\"}"}}\n\n',
        'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":5}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ].join(""),
    });
    const gatewayPort = await startGatewayWithRoute({
      protocol: "anthropic",
      baseUrl: upstream.url,
      apiKey: "anthropic-key",
      model: "anthropic-model",
    });

    const response = await fetch(
      `http://127.0.0.1:${gatewayPort}/v1/responses`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "responses-model",
          stream: true,
          input: [{ role: "user", content: "Use the tool." }],
          tools: [
            {
              type: "function",
              name: "lookup",
              parameters: { type: "object", properties: {} },
            },
          ],
        }),
      },
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body.indexOf("response.created")).toBeLessThan(
      body.indexOf("response.output_item.added"),
    );
    expect(body).toContain("response.output_item.added");
    expect(body).toContain('"type":"function_call"');
    expect(body).toContain('"call_id":"call-1"');
    expect(body).toContain("response.function_call_arguments.delta");
    expect(body).toContain('\\"city\\":\\"SF\\"');
    expect(body).toContain("response.completed");

    await closeUpstream(upstream);
  });
});

async function startGatewayWithRoute(route: {
  protocol: ProtocolId;
  baseUrl: string;
  apiKey: string;
  model: string;
}): Promise<number> {
  const resolveRoute = (): RouteDecision[] => [
    {
      targetProvider: "test-provider",
      targetModel: route.model,
      targetProtocol: route.protocol,
      targetBaseUrl: route.baseUrl,
      apiKey: route.apiKey,
    },
  ];
  configurePipeline({ resolveRoute });
  return startServer({ port: 0, resolveRoute, getModels: () => [] });
}

async function startUpstream(options: {
  path: string;
  response?: Record<string, unknown>;
  sse?: string;
}): Promise<{ server: http.Server; url: string; request?: CapturedRequest }> {
  const state: { request?: CapturedRequest } = {};
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      state.request = {
        path: req.url,
        headers: req.headers,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
      };

      if (req.url !== options.path) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "unexpected path" } }));
        return;
      }

      if (options.sse) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end(options.sse);
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(options.response));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
    get request() {
      return state.request;
    },
  };
}

async function closeUpstream(upstream: { server: http.Server }): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    upstream.server.close((error) => (error ? reject(error) : resolve()));
  });
}

function openAIChatResponse(): Record<string, unknown> {
  return {
    id: "chatcmpl_1",
    object: "chat.completion",
    created: 1,
    model: "openai-model",
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
  };
}

function anthropicResponse(): Record<string, unknown> {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "anthropic-model",
    content: [
      { type: "text", text: "It is 22C." },
      { type: "tool_use", id: "call-1", name: "lookup", input: { city: "SF" } },
    ],
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}
