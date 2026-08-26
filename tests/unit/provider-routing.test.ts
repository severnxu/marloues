import { describe, expect, it } from "vitest";
import {
  resolveRuntimeProviderRoutes,
  runtimeSourceProtocol,
} from "../../client/main/core/config/provider-routing";
import type {
  AgentSettings,
  ModelProviderConfig,
} from "../../client/shared/types";

describe("runtime provider routing", () => {
  it("selects the hidden Anthropic endpoint for an SDK built-in provider", () => {
    const plan = resolveRuntimeProviderRoutes(
      settings({
        id: "deepseek",
        name: "DeepSeek",
        kind: "builtin",
        presetId: "deepseek",
        enabled: true,
        apiKey: "test-key",
        models: [{ id: "deepseek-v4-flash", enabled: true }],
      }),
      { runtimeId: "sdk" },
    );

    expect(plan.sourceProtocol).toBe("anthropic");
    expect(plan.directRoute).toMatchObject({
      endpointId: "deepseek-anthropic",
      protocol: "anthropic",
      baseUrl: "https://api.deepseek.com/anthropic",
    });
    expect(plan.requiresGateway).toBe(false);
  });

  it("uses the gateway for Binary when a provider has no Responses endpoint", () => {
    const plan = resolveRuntimeProviderRoutes(
      settings({
        id: "deepseek",
        name: "DeepSeek",
        kind: "builtin",
        presetId: "deepseek",
        enabled: true,
        apiKey: "test-key",
        models: [{ id: "deepseek-v4-flash", enabled: true }],
      }),
      { runtimeId: "binary" },
    );

    expect(runtimeSourceProtocol("binary")).toBe("openai-responses");
    expect(plan.directRoute).toBeUndefined();
    expect(plan.requiresGateway).toBe(true);
    expect(plan.routes[0]).toMatchObject({
      endpointId: "deepseek-openai",
      protocol: "openai-chat",
    });
  });

  it("connects Binary directly to one explicit Responses endpoint", () => {
    const plan = resolveRuntimeProviderRoutes(
      settings(
        customProvider([
          endpoint(
            "responses",
            "openai-responses",
            "https://one.example/v1",
            10,
          ),
        ]),
      ),
      { runtimeId: "binary" },
    );

    expect(plan.directRoute?.endpointId).toBe("responses");
    expect(plan.requiresGateway).toBe(false);
  });

  it("keeps same-protocol multi-endpoint routes behind the gateway for failover", () => {
    const plan = resolveRuntimeProviderRoutes(
      settings(
        customProvider([
          endpoint("secondary", "openai-chat", "https://two.example/v1", 20),
          endpoint("primary", "openai-chat", "https://one.example/v1", 10),
        ]),
      ),
      { runtimeId: "self-built" },
    );

    expect(plan.directRoute).toBeUndefined();
    expect(plan.requiresGateway).toBe(true);
    expect(plan.routes.map((route) => route.endpointId)).toEqual([
      "primary",
      "secondary",
    ]);
  });
});

function settings(provider: ModelProviderConfig): AgentSettings {
  return {
    providers: [provider],
    defaultModel: { providerId: provider.id, modelId: provider.models[0].id },
    activeRuntimeId: "sdk",
  } as AgentSettings;
}

function customProvider(
  endpoints: Extract<ModelProviderConfig, { kind: "custom" }>["endpoints"],
): ModelProviderConfig {
  return {
    id: "custom",
    name: "Custom",
    kind: "custom",
    endpoints,
    enabled: true,
    apiKey: "test-key",
    models: [{ id: "test-model", enabled: true }],
  };
}

function endpoint(
  id: string,
  protocol: "anthropic" | "openai-chat" | "openai-responses",
  baseUrl: string,
  priority: number,
) {
  return { id, protocol, baseUrl, enabled: true, priority };
}
