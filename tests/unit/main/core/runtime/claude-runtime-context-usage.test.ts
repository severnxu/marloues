import { describe, expect, it, vi } from "vitest";
import type { AgentSettings } from "@shared/types";
import type { RuntimeEvent } from "@shared/agent-runtime";

const mocks = vi.hoisted(() => ({
  queryClaude: vi.fn(),
  workflowThreadStore: {
    startTurn: vi.fn(),
    applyRuntimeEvent: vi.fn(),
  },
}));

vi.mock("../../../../../client/main/core/sdk/claude-sdk", () => ({
  queryClaude: mocks.queryClaude,
}));
vi.mock("../../../../../client/main/services/config-service", () => ({
  getAgentSettings: vi.fn(),
  saveAgentSettings: vi.fn(),
  buildSdkEnv: vi.fn(() => ({})),
}));
vi.mock("../../../../../client/main/services/mcp-service", () => ({
  recordMcpRuntimeStatus: vi.fn(),
}));
vi.mock("../../../../../client/main/core/context/context-policy", () => ({
  evaluateContextPolicy: vi.fn(),
}));
vi.mock("../../../../../client/main/core/config/model-provider", () => ({
  resolveModelProvider: vi.fn(() => ({
    provider: {
      id: "test",
      name: "Test",
      kind: "custom",
      enabled: true,
      apiKey: "test-key",
      endpoints: [
        {
          id: "test-anthropic",
          protocol: "anthropic",
          baseUrl: "https://models.example.test",
          enabled: true,
          priority: 10,
        },
      ],
      models: [{ id: "test-model", label: "Test", enabled: true }],
    },
    selection: { providerId: "test", modelId: "test-model" },
    model: "test-model",
    apiKey: "test-key",
  })),
}));
vi.mock("../../../../../client/main/core/config/options-builder", () => ({
  buildClaudeRuntimeOptions: vi.fn(() => ({})),
}));
vi.mock("../../../../../client/main/core/runtime/mcp-tools", () => ({
  configuredMcpTools: vi.fn(() => []),
}));
vi.mock("../../../../../client/main/core/runtime/runtime-models", () => ({
  configuredRuntimeModels: vi.fn(() => []),
}));
vi.mock(
  "../../../../../client/main/core/runtime/workflow-thread-store",
  () => ({
    workflowThreadStore: mocks.workflowThreadStore,
  }),
);
vi.mock(
  "../../../../../client/main/core/permissions/tool-permission-engine",
  () => ({
    evaluateToolPermission: vi.fn(),
  }),
);
vi.mock("../../../../../client/main/core/runtime/tool-storm-breaker", () => ({
  ToolStormBreaker: class {
    resetTurn = vi.fn();
    check = vi.fn(() => ({ action: "allow" as const }));
  },
}));
vi.mock("../../../../../client/main/core/logging/app-logger", () => ({
  logInfo: vi.fn(),
  logQuiet: vi.fn(),
  logWarn: vi.fn(),
}));
vi.mock("../../../../../client/main/gateway", () => ({
  startGateway: vi.fn(async () => ({
    port: 45678,
    baseUrl: "http://127.0.0.1:45678",
    token: "gateway-token",
  })),
  stopGateway: vi.fn(),
  isGatewayStarted: vi.fn(() => false),
  getGatewayPort: vi.fn(() => 0),
}));
vi.mock("../../../../../client/main/core/runtime/steer-queue", () => ({
  SteerQueue: class {
    flushNextAtBoundary = vi.fn(() => false);
  },
}));
vi.mock("../../../../../client/main/core/runtime/message-channel", () => ({
  createMessageChannel: vi.fn(() => ({
    enqueue: vi.fn(),
    close: vi.fn(),
    isClosed: () => false,
    generator: (async function* () {})(),
  })),
}));
vi.mock("../../../../../client/main/core/runtime/sdk-content", () => ({
  buildSdkUserContent: vi.fn(() => [{ type: "text", text: "hi" }]),
}));
vi.mock("../../../../../client/main/core/runtime/turn-state", () => ({
  RuntimeEventQueue: class {
    push = vi.fn();
    next = vi.fn(() => new Promise<RuntimeEvent>(() => {}));
    *drainSync() {}
  },
  createTurnLifetime: vi.fn(() => ({
    finished: Promise.resolve(),
    finish: vi.fn(),
  })),
}));
vi.mock("../../../../../client/main/services/outbox-service", () => ({
  recoverApplyingOutbox: vi.fn(),
}));

import { ClaudeRuntime } from "../../../../../client/main/core/runtime/claude-runtime";

function settings(): AgentSettings {
  return {
    providers: [],
    defaultModel: { providerId: "test", modelId: "test-model" },
    maxTurns: 1,
    workMode: "code",
    permissionMode: "default",
    thinkingEnabled: false,
    maxThinkingTokens: 0,
  } as unknown as AgentSettings;
}

describe("ClaudeRuntime context usage", () => {
  it("finalizes the workflow turn when the SDK fails before streaming starts", async () => {
    mocks.queryClaude.mockRejectedValueOnce(
      new Error("Claude executable is missing"),
    );

    const runtime = new ClaudeRuntime();

    await expect(
      runtime.sendMessage({
        threadId: "thread-startup-failure",
        turnId: "turn-startup-failure",
        content: "hi",
        settingsSnapshot: settings(),
      }),
    ).rejects.toThrow("Claude executable is missing");

    expect(mocks.workflowThreadStore.applyRuntimeEvent).toHaveBeenCalledWith(
      "thread-startup-failure",
      "turn-startup-failure",
      expect.objectContaining({
        kind: "error",
        payload: expect.objectContaining({
          code: "SDK_STARTUP_ERROR",
          message: "Claude executable is missing",
        }),
      }),
    );
    expect(mocks.workflowThreadStore.applyRuntimeEvent).toHaveBeenCalledWith(
      "thread-startup-failure",
      "turn-startup-failure",
      {
        kind: "turn-complete",
        payload: {
          turnId: "turn-startup-failure",
          result: "error",
          error: "Claude executable is missing",
        },
      },
    );
  });

  it("does not block streaming while the turn-end context probe is pending", async () => {
    let resolveContextUsage!: (value: unknown) => void;
    const getContextUsage = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveContextUsage = resolve;
        }),
    );
    const query = {
      getContextUsage,
      close: vi.fn(),
      [Symbol.asyncIterator]: async function* () {
        yield {
          type: "system",
          subtype: "init",
          session_id: "sdk-session",
        };
        yield {
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "text_delta", text: "hi" },
          },
        };
        yield {
          type: "result",
          subtype: "success",
          result: "success",
          session_id: "sdk-session",
        };
      },
    };
    mocks.queryClaude.mockResolvedValueOnce(query);

    const runtime = new ClaudeRuntime();
    const deferredEvents: RuntimeEvent[] = [];
    runtime.forwardDeferredEvent = (event) => deferredEvents.push(event);

    const stream = await runtime.sendMessage({
      threadId: "thread",
      turnId: "turn",
      content: "hi",
      settingsSnapshot: settings(),
    });
    const events: RuntimeEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "text-chunk" }),
        expect.objectContaining({ kind: "turn-complete" }),
      ]),
    );
    expect(events.some((event) => event.kind === "context-usage")).toBe(false);
    expect(getContextUsage).toHaveBeenCalledTimes(1);

    resolveContextUsage({ totalTokens: 120, maxTokens: 1000 });
    await vi.waitFor(() => expect(deferredEvents).toHaveLength(1));
    expect(runtime.forwardDeferredEvent).toBeUndefined();
    expect(deferredEvents[0]).toMatchObject({
      kind: "context-usage",
      payload: { phase: "turn_end", turnId: "turn" },
    });
  });
});
