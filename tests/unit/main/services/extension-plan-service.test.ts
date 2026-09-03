import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentSettings,
  McpServerConfig,
  SkillInfo,
  WorkspaceInfo,
} from "../../../../client/shared/types";

const mocks = vi.hoisted(() => ({
  listInstalledSkills: vi.fn(),
  findWorkspaceByPath: vi.fn(),
  getEffectiveAgentSettings: vi.fn(),
}));

vi.mock("../../../../client/main/services/skill-service", () => ({
  listInstalledSkills: mocks.listInstalledSkills,
}));

vi.mock("../../../../client/main/services/workspace-service", () => ({
  findWorkspaceByPath: mocks.findWorkspaceByPath,
  getEffectiveAgentSettings: mocks.getEffectiveAgentSettings,
}));

import {
  claudePluginPaths,
  codexExtraSkillRoots,
  codexMcpServersConfig,
  codexSkillConfig,
  resolveEffectiveExtensionPlan,
} from "../../../../client/main/services/extension-plan-service";

const workspace: WorkspaceInfo = {
  id: "workspace-1",
  name: "demo",
  path: "/work/demo",
  lastOpenedAt: 1,
};

const skills: SkillInfo[] = [
  {
    id: "global",
    name: "global-skill",
    path: "/marloues/skills/global-skill",
    scope: "user",
    enabled: true,
  },
  {
    id: "claude-native",
    name: "claude-native",
    path: "/work/demo/.claude/skills/claude-native",
    scope: "project",
    enabled: true,
  },
  {
    id: "codex-native",
    name: "codex-native",
    path: "/work/demo/.agents/skills/codex-native",
    scope: "project",
    enabled: true,
  },
  {
    id: "disabled",
    name: "disabled-skill",
    path: "/marloues/skills/disabled-skill",
    scope: "user",
    enabled: false,
  },
];

function settings(mcpServers: McpServerConfig[] = []): AgentSettings {
  return { mcpServers } as AgentSettings;
}

describe("EffectiveExtensionPlan", () => {
  beforeEach(() => {
    mocks.findWorkspaceByPath.mockReturnValue(workspace);
    mocks.listInstalledSkills.mockReturnValue(skills);
    mocks.getEffectiveAgentSettings.mockImplementation(
      (baseSettings: AgentSettings) => baseSettings,
    );
  });

  it("uses one selected inventory while adapting native roots per runtime", () => {
    const plan = resolveEffectiveExtensionPlan(
      settings(),
      workspace.path,
      "binary",
    );

    expect(plan.skills.map((skill) => skill.id)).toEqual([
      "global",
      "claude-native",
      "codex-native",
    ]);
    expect(claudePluginPaths(plan)).toEqual([
      "/marloues/skills/global-skill",
      "/work/demo/.agents/skills/codex-native",
    ]);
    expect(codexExtraSkillRoots(plan)).toEqual([
      "/marloues/skills/global-skill",
      "/work/demo/.claude/skills/claude-native",
    ]);
    expect(codexSkillConfig(plan)).toEqual({
      config: [
        { path: "/marloues/skills/global-skill/SKILL.md", enabled: true },
        {
          path: "/work/demo/.claude/skills/claude-native/SKILL.md",
          enabled: true,
        },
        {
          path: "/work/demo/.agents/skills/codex-native/SKILL.md",
          enabled: true,
        },
        {
          path: "/marloues/skills/disabled-skill/SKILL.md",
          enabled: false,
        },
      ],
    });
  });

  it("translates STDIO and HTTP MCP configs to Codex thread config", () => {
    expect(
      codexMcpServersConfig([
        {
          id: "stdio-id",
          name: "local-tools",
          enabled: true,
          config: {
            command: " node ",
            args: ["server.js", 7],
            env: { TOKEN: "secret" },
          },
        },
        {
          id: "http-id",
          name: "remote-tools",
          enabled: true,
          config: {
            url: " https://mcp.example.test/api ",
            headers: { "X-Project": "demo" },
            bearer_token_env_var: "MCP_TOKEN",
          },
        },
      ]),
    ).toEqual({
      "local-tools": {
        enabled: true,
        command: "node",
        args: ["server.js", "7"],
        env: { TOKEN: "secret" },
      },
      "remote-tools": {
        enabled: true,
        url: "https://mcp.example.test/api",
        http_headers: { "X-Project": "demo" },
        bearer_token_env_var: "MCP_TOKEN",
      },
    });
  });

  it("changes the fingerprint when the project selection changes", () => {
    const first = resolveEffectiveExtensionPlan(
      settings(),
      workspace.path,
      "binary",
    );
    mocks.listInstalledSkills.mockReturnValue(
      skills.map((skill) =>
        skill.id === "global" ? { ...skill, enabled: false } : skill,
      ),
    );
    const second = resolveEffectiveExtensionPlan(
      settings(),
      workspace.path,
      "binary",
    );

    expect(first.fingerprint).not.toBe(second.fingerprint);
  });
});
