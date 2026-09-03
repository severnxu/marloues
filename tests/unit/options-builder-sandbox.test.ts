import { describe, expect, it } from "vitest";
import type { AgentSettings } from "../../client/shared/types";
import {
  ACTION_EXECUTION_GUARDRAIL,
  buildClaudeRuntimeOptions,
} from "../../client/main/core/config/options-builder";

function settings(): AgentSettings {
  return {
    providers: [],
    defaultModel: { providerId: "test", modelId: "test-model" },
    maxTurns: 5,
    workMode: "execute",
    permissionMode: "default",
    permissionApprovalTimeoutMs: 30_000,
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

describe("buildClaudeRuntimeOptions sandbox adapter", () => {
  it("merges the in-process sandbox server and redirects Bash", () => {
    const server = { type: "sdk", name: "marloues_sandbox" };
    const options = buildClaudeRuntimeOptions({
      settings: settings(),
      cwd: process.cwd(),
      env: {},
      canUseTool: async () => ({ behavior: "allow" }),
      sdkMcpServers: { marloues_sandbox: server },
      toolAliases: { Bash: "mcp__marloues_sandbox__bash" },
    });

    expect(options.mcpServers).toEqual({ marloues_sandbox: server });
    expect(options.toolAliases).toEqual({
      Bash: "mcp__marloues_sandbox__bash",
    });
    expect(options).not.toHaveProperty("sandbox");
  });

  it("keeps the SDK gate enabled when the application bypasses prompts", () => {
    const options = buildClaudeRuntimeOptions({
      settings: { ...settings(), permissionMode: "bypassPermissions" },
      cwd: process.cwd(),
      env: {},
      canUseTool: async () => ({ behavior: "allow" }),
    });

    expect(options.permissionMode).toBe("default");
    expect(options.allowDangerouslySkipPermissions).toBe(false);
  });

  it("requires fresh tool execution before reporting an action complete", () => {
    const options = buildClaudeRuntimeOptions({
      settings: settings(),
      cwd: process.cwd(),
      env: {},
      canUseTool: async () => ({ behavior: "allow" }),
    });

    expect(options.systemPrompt).toEqual({
      type: "preset",
      preset: "claude_code",
      append: ACTION_EXECUTION_GUARDRAIL,
    });
    expect(ACTION_EXECUTION_GUARDRAIL).toContain("reopen");
    expect(ACTION_EXECUTION_GUARDRAIL).toContain("current turn");
  });

  it("limits Claude to the project-selected Skills", () => {
    const options = buildClaudeRuntimeOptions({
      settings: settings(),
      cwd: process.cwd(),
      env: {},
      canUseTool: async () => ({ behavior: "allow" }),
      pluginPaths: ["/tmp/demo-skill"],
      skillNames: ["demo-skill"],
    });

    expect(options.plugins).toEqual([
      {
        type: "local",
        path: "/tmp/demo-skill",
        skipMcpDiscovery: true,
      },
    ]);
    expect(options.skills).toEqual(["demo-skill"]);
    expect(options.strictMcpConfig).toBe(true);
  });
});
