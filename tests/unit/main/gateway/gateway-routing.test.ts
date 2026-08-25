import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: undefined }));
vi.mock("../../../../client/main/core/logging/app-logger", () => ({
  isDeveloperMode: () => false,
  logHttp: vi.fn(),
  logInfo: vi.fn(),
  logQuiet: vi.fn(),
  logWarn: vi.fn(),
}));

import { startGateway, stopGateway } from "../../../../client/main/gateway";
import {
  getAgentSettings,
  saveAgentSettings,
} from "../../../../client/main/services/config-service";
import type { ModelProviderType } from "../../../../client/shared/types";

interface CapturedRequest {
  path?: string;
  body?: Record<string, unknown>;
}

const apiKeyEnv = "MARLOUES_GATEWAY_ROUTING_TEST_KEY";
let home: string;
let originalHome: string | undefined;
let originalApiKey: string | undefined;

beforeAll(() => {
  originalHome = process.env.MARLOUES_HOME;
  originalApiKey = process.env[apiKeyEnv];
  home = mkdtempSync(join(tmpdir(), "marloues-gateway-routing-"));
  process.env.MARLOUES_HOME = home;
  process.env[apiKeyEnv] = "routing-test-key";
});

afterAll(async () => {
  await stopGateway();
  if (originalHome === undefined) {
    delete process.env.MARLOUES_HOME;
  } else {
    process.env.MARLOUES_HOME = originalHome;
  }
  if (originalApiKey === undefined) {
    delete process.env[apiKeyEnv];
  } else {
    process.env[apiKeyEnv] = originalApiKey;
  }
  rmSync(home, { recursive: true, force: true });
});

describe("gateway provider routing", () => {
  it("routes selected endpoint types to their upstream protocol", async () => {
    const cases = [
      {
        providerType: "openai-chat" as ModelProviderType,
        upstreamPath: "/v1/chat/completions",
        response: openAIChatResponse(),
        inboundPath: "/v1/messages",
      },
      {
        providerType: "openai-responses" as ModelProviderType,
        upstreamPath: "/v1/responses",
        response: openAIResponsesResponse(),
        inboundPath: "/v1/messages",
      },
      {
        providerType: "anthropic" as ModelProviderType,
        upstreamPath: "/v1/messages",
        response: anthropicResponse(),
        inboundPath: "/v1/responses",
      },
    ];

    for (const testCase of cases) {
      const upstream = await startUpstream(
        testCase.upstreamPath,
        testCase.response,
      );
      configureSelectedProvider(testCase.providerType, upstream.url);
      const gateway = await startGateway();
      expect(gateway).not.toBeNull();

      const response = await fetch(
        `http://127.0.0.1:${gateway?.port}${testCase.inboundPath}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            testCase.inboundPath === "/v1/responses"
              ? {
                  model: "client-model",
                  input: [{ role: "user", content: "Hello" }],
                  max_output_tokens: 128,
                }
              : {
                  model: "client-model",
                  max_tokens: 128,
                  messages: [{ role: "user", content: "Hello" }],
                },
          ),
        },
      );

      expect(response.status).toBe(200);
      expect(upstream.request.path).toBe(testCase.upstreamPath);
      expect(upstream.request.body?.model).toBe("target-model");
      await closeUpstream(upstream);
    }
  });
});

function configureSelectedProvider(
  type: ModelProviderType,
  baseUrl: string,
): void {
  const settings = getAgentSettings();
  const provider = settings.providers[0];
  saveAgentSettings({
    ...settings,
    providers: [
      {
        ...provider,
        id: "routing-provider",
        name: "Routing Provider",
        type,
        enabled: true,
        baseUrl,
        apiKey: "",
        apiKeyEnv,
        models: [
          {
            ...provider.models[0],
            id: "target-model",
            enabled: true,
          },
        ],
      },
    ],
    defaultModel: {
      providerId: "routing-provider",
      modelId: "target-model",
    },
  });
}

async function startUpstream(
  path: string,
  response: Record<string, unknown>,
): Promise<{ server: http.Server; url: string; request: CapturedRequest }> {
  const request: CapturedRequest = {};
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      request.path = req.url;
      request.body = JSON.parse(Buffer.concat(chunks).toString("utf8"));

      if (req.url !== path) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "unexpected path" } }));
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(response));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
    request,
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
    model: "target-model",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "Hello" },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
  };
}

function openAIResponsesResponse(): Record<string, unknown> {
  return {
    id: "resp_1",
    object: "response",
    status: "completed",
    model: "target-model",
    output: [
      {
        id: "msg_1",
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Hello" }],
      },
    ],
    usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
  };
}

function anthropicResponse(): Record<string, unknown> {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "target-model",
    content: [{ type: "text", text: "Hello" }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 2 },
  };
}
