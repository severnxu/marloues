import { describe, expect, it } from "vitest";
import type { McpServerConfig, SkillInfo } from "@shared/types";
import {
  isWorkspaceSkillEnabled,
  resolveWorkspaceMcpServers,
} from "../../../../client/main/services/workspace-extension-policy";

function mcp(id: string, enabled = true): McpServerConfig {
  return { id, name: id, enabled, config: { command: id } };
}

function skill(id: string, scope: SkillInfo["scope"] = "user"): SkillInfo {
  return { id, name: id, path: `/skills/${id}`, scope, enabled: true };
}

describe("workspace extension policy", () => {
  it("uses an allow-list so newly installed global MCP servers do not leak in", () => {
    const resolved = resolveWorkspaceMcpServers(
      [mcp("selected"), mcp("installed-later"), mcp("globally-off", false)],
      {
        mode: "custom",
        enabledServerIds: ["selected"],
        projectServers: [
          { ...mcp("project-only"), source: "local" },
          { ...mcp("project-off", false), source: "local" },
        ],
      },
    );

    expect(resolved.map((server) => server.id)).toEqual([
      "selected",
      "project-only",
    ]);
  });

  it("lets project MCP config override a global server with the same id", () => {
    const project = {
      ...mcp("same"),
      name: "project-version",
      source: "local" as const,
    };
    const resolved = resolveWorkspaceMcpServers([mcp("same")], {
      mode: "inherit",
      enabledServerIds: [],
      projectServers: [project],
    });

    expect(resolved).toEqual([project]);
  });

  it("applies global disables, the project allow-list, and project-skill switch", () => {
    const disabled = new Set(["globally-off"]);
    const policy = {
      mode: "custom" as const,
      enabledSkillIds: ["selected"],
      includeProjectSkills: false,
    };

    expect(isWorkspaceSkillEnabled(skill("selected"), disabled, policy)).toBe(
      true,
    );
    expect(
      isWorkspaceSkillEnabled(skill("installed-later"), disabled, policy),
    ).toBe(false);
    expect(
      isWorkspaceSkillEnabled(skill("globally-off"), disabled, policy),
    ).toBe(false);
    expect(
      isWorkspaceSkillEnabled(skill("project", "project"), disabled, policy),
    ).toBe(false);
  });
});
