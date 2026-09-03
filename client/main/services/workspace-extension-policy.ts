import type {
  McpServerConfig,
  SkillInfo,
  WorkspaceMcpPolicy,
  WorkspaceSkillPolicy,
} from "@shared/types";

export function resolveWorkspaceMcpServers(
  globalServers: McpServerConfig[],
  policy?: WorkspaceMcpPolicy,
): McpServerConfig[] {
  const globallyEnabled = globalServers.filter((server) => server.enabled);
  const selectedGlobal =
    policy?.mode === "custom"
      ? globallyEnabled.filter((server) =>
          policy.enabledServerIds.includes(server.id),
        )
      : globallyEnabled;
  const projectServers = (policy?.projectServers ?? [])
    .filter((server) => server.enabled)
    .map((server) => ({ ...server, source: server.source ?? "local" }));

  return mergeMcpServers(selectedGlobal, projectServers);
}

export function isWorkspaceSkillEnabled(
  skill: SkillInfo,
  globallyDisabled: ReadonlySet<string>,
  policy?: WorkspaceSkillPolicy,
): boolean {
  if (globallyDisabled.has(skill.id)) return false;
  if (skill.scope === "project") return policy?.includeProjectSkills !== false;
  if (policy?.mode !== "custom") return true;
  return policy.enabledSkillIds.includes(skill.id);
}

function mergeMcpServers(
  globalServers: McpServerConfig[],
  projectServers: McpServerConfig[],
): McpServerConfig[] {
  const merged = new Map<string, McpServerConfig>();
  for (const server of globalServers) merged.set(server.id, server);
  // A project-owned server intentionally wins on an ID collision.
  for (const server of projectServers) merged.set(server.id, server);
  return Array.from(merged.values());
}
