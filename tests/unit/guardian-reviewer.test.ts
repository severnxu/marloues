import { afterEach, describe, expect, it, vi } from "vitest";
import { createSecurityOperation } from "../../client/main/core/security/operation-factory";
import { runGuardianReview } from "../../client/main/core/security/guardian-reviewer";
import type { AgentSettings } from "../../client/shared/types";

function settings(): AgentSettings {
  return {
    providers: [
      {
        id: "reviewer",
        name: "Reviewer",
        kind: "custom",
        enabled: true,
        endpoints: [
          {
            id: "reviewer-chat",
            protocol: "openai-chat",
            baseUrl: "https://models.example.test/v1",
            enabled: true,
            priority: 10,
          },
        ],
        apiKey: "test-key",
        models: [
          { id: "main-model", label: "Main", enabled: true },
          { id: "gpt-5.6-luna", label: "Guardian", enabled: true },
        ],
      },
    ],
    defaultModel: { providerId: "reviewer", modelId: "main-model" },
    maxTurns: 10,
    workMode: "execute",
    securityMode: "auto-review",
    securityRules: {
      autoAllowPaths: [],
      protectedPaths: [],
      commandAllowlist: [],
      commandAsklist: [],
      networkAccess: "ask",
      allowedDomains: [],
      deniedDomains: [],
    },
    permissionMode: "default",
    permissionApprovalTimeoutMs: 120_000,
    desktopNotificationsEnabled: false,
    autoMemoryEnabled: false,
    thinkingEnabled: false,
    maxThinkingTokens: 0,
    activeToolProfileId: "default",
    toolProfiles: [],
    mcpServers: [],
    disabledSkills: [],
    sandboxEnabled: true,
    sandboxMode: "workspace-write",
  };
}

function decision() {
  return {
    action: "ask" as const,
    reason: "Sensitive tool requires confirmation.",
    operation: createSecurityOperation({
      runtimeId: "sdk",
      toolName: "Bash",
      input: { command: "git status" },
      workspaceRoot: "C:\\workspace\\demo",
    }),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("Guardian reviewer", () => {
  it("uses the current model even when a dedicated review model exists", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          content: [
            {
              type: "text",
              text: JSON.stringify({
                action: "allow",
                riskLevel: "low",
                userAuthorization: "high",
                reason: "Read-only repository inspection.",
              }),
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await runGuardianReview(decision(), settings(), {
      trustedUserRequest: "Inspect the repository status.",
    });

    expect(result).toEqual({
      action: "allow",
      riskLevel: "low",
      userAuthorization: "high",
      reason: "Read-only repository inspection.",
      model: "main-model",
      attemptCount: 1,
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://models.example.test/v1/chat/completions",
    );
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(request.headers).toMatchObject({
      authorization: "Bearer test-key",
    });
    expect(String(request.body)).toContain('"model":"main-model"');
    expect(String(request.body)).toContain(
      '"role":"system","content":"You are Guardian',
    );
    expect(String(request.body)).toContain("trustedUserRequest");
    expect(String(request.body)).toContain("untrustedOperation");
    expect(String(request.body)).not.toContain("test-key");
  });

  it("ignores reasoning blocks and parses the final structured decision", async () => {
    const anthropicSettings = settings();
    const provider = anthropicSettings.providers[0];
    if (provider.kind !== "custom") throw new Error("expected custom provider");
    provider.endpoints = [
      {
        id: "reviewer-anthropic",
        protocol: "anthropic",
        baseUrl: "https://api.anthropic.com",
        enabled: true,
        priority: 10,
      },
    ];
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          stop_reason: "end_turn",
          content: [
            { type: "thinking", thinking: "Untrusted reasoning text." },
            {
              type: "text",
              text: JSON.stringify({
                action: "allow",
                riskLevel: "low",
                userAuthorization: "high",
                reason: "Explicitly authorized local read.",
              }),
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await runGuardianReview(decision(), anthropicSettings);

    expect(result.action).toBe("allow");
    expect(result.reason).toBe("Explicitly authorized local read.");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.anthropic.com/v1/messages",
    );
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      "x-api-key": "test-key",
      "anthropic-version": "2023-06-01",
    });
    expect(String(fetchMock.mock.calls[0][1]?.body)).toContain(
      '"max_tokens":1200',
    );
  });

  it("retries malformed model output before returning a decision", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ content: [{ text: "maybe" }] }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            content: [
              {
                text: JSON.stringify({
                  action: "ask",
                  riskLevel: "medium",
                  userAuthorization: "unknown",
                  reason: "Human confirmation is required.",
                }),
              },
            ],
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await runGuardianReview(decision(), settings());

    expect(result.action).toBe("ask");
    expect(result.attemptCount).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails closed without retrying a permanent endpoint failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("unauthorized", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runGuardianReview(decision(), settings());

    expect(result.action).toBe("deny");
    expect(result.riskLevel).toBe("high");
    expect(result.reason).toMatch(/安全策略拒绝执行/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
