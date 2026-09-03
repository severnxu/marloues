import { createHash } from "node:crypto";
import { join, resolve, sep } from "node:path";
import type {
  AgentSettings,
  McpServerConfig,
  RuntimeKind,
  SkillInfo,
  WorkspaceInfo,
} from "@shared/types";
import { listInstalledSkills } from "./skill-service";
import {
  findWorkspaceByPath,
  getEffectiveAgentSettings,
} from "./workspace-service";

export interface EffectiveExtensionPlan {
  runtimeId: RuntimeKind;
  workspace: WorkspaceInfo | null;
  skills: SkillInfo[];
  mcpServers: McpServerConfig[];
  skillStates: Array<{ path: string; enabled: boolean }>;
  fingerprint: string;
}

/**
 * Single source of truth for project extension resolution. Every runtime gets
 * the same selected assets and only translates their loading mechanism.
 */
export function resolveEffectiveExtensionPlan(
  baseSettings: AgentSettings,
  workspacePath: string | undefined,
  runtimeId: RuntimeKind,
): EffectiveExtensionPlan {
  const workspace = findWorkspaceByPath(workspacePath);
  const effectiveSettings = getEffectiveAgentSettings(
    baseSettings,
    workspacePath,
  );
  const skillInventory = listInstalledSkills(workspace);
  const skills = skillInventory.filter((skill) => skill.enabled);
  const skillStates = skillInventory.map((skill) => ({
    path: join(resolve(skill.path), "SKILL.md"),
    enabled: skill.enabled,
  }));
  const mcpServers = effectiveSettings.mcpServers.filter(
    (server) => server.enabled,
  );
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        runtimeId,
        workspaceId: workspace?.id ?? null,
        skills: skills.map((skill) => ({
          id: skill.id,
          path: resolve(skill.path),
          version: skill.version ?? null,
        })),
        skillStates,
        mcpServers: mcpServers.map((server) => ({
          id: server.id,
          name: server.name,
          config: server.config,
        })),
      }),
    )
    .digest("hex");

  return {
    runtimeId,
    workspace,
    skills,
    mcpServers,
    skillStates,
    fingerprint,
  };
}

/** Claude discovers project .claude/skills natively; every other selected
 * Skill is injected as a session-local plugin. */
export function claudePluginPaths(plan: EffectiveExtensionPlan): string[] {
  return uniquePaths(
    plan.skills
      .filter(
        (skill) =>
          !isUnderProjectSkillRoot(skill.path, plan.workspace, ".claude"),
      )
      .map((skill) => skill.path),
  );
}

/** Codex discovers project .agents/skills natively; all other selected Skills
 * are supplied as extra roots to the per-session app-server. */
export function codexExtraSkillRoots(plan: EffectiveExtensionPlan): string[] {
  return uniquePaths(
    plan.skills
      .filter(
        (skill) =>
          !isUnderProjectSkillRoot(skill.path, plan.workspace, ".agents"),
      )
      .map((skill) => skill.path),
  );
}

/** Per-thread override prevents Codex's native .agents/skills discovery from
 * bypassing a project's allow-list, without mutating global Codex config. */
export function codexSkillConfig(plan: EffectiveExtensionPlan): {
  config: Array<{ path: string; enabled: boolean }>;
} {
  return { config: plan.skillStates };
}

export function codexMcpServersConfig(
  servers: McpServerConfig[],
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  for (const server of servers) {
    const source = asRecord(server.config);
    const command =
      typeof source.command === "string" ? source.command.trim() : "";
    const url = typeof source.url === "string" ? source.url.trim() : "";
    const config: Record<string, unknown> = { enabled: true };
    if (command) {
      config.command = command;
      if (Array.isArray(source.args)) config.args = source.args.map(String);
      if (isStringRecord(source.env)) config.env = source.env;
      if (typeof source.cwd === "string" && source.cwd.trim()) {
        config.cwd = source.cwd.trim();
      }
    } else if (url) {
      config.url = url;
      const headers = isStringRecord(source.headers)
        ? source.headers
        : isStringRecord(source.http_headers)
          ? source.http_headers
          : undefined;
      if (headers) config.http_headers = headers;
      if (typeof source.bearer_token_env_var === "string") {
        config.bearer_token_env_var = source.bearer_token_env_var;
      }
    } else {
      continue;
    }
    result[server.name.trim() || server.id] = config;
  }
  return result;
}

function isUnderProjectSkillRoot(
  path: string,
  workspace: WorkspaceInfo | null,
  nativeDirectory: ".claude" | ".agents",
): boolean {
  if (!workspace) return false;
  const root = resolve(workspace.path, nativeDirectory, "skills");
  const candidate = resolve(path);
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function uniquePaths(paths: string[]): string[] {
  return Array.from(new Set(paths.map((path) => resolve(path))));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string"),
  );
}
