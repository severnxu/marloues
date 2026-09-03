import { dialog } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { workspacePathsEqual } from "@shared/workspace-path";
import type {
  AgentSettings,
  McpServerConfig,
  WorkspaceConfigUpdate,
  WorkspaceInfo,
  WorkspaceMcpPolicy,
  WorkspaceSettings,
  WorkspaceSkillPolicy,
} from "@shared/types";
import {
  getDevSettingsPathForImport,
  getWorkspaceSettingsPath,
} from "../app-paths";
import { logInfo, logWarn } from "../core/logging/app-logger";
import { prepareSkillRuntimeCache } from "./skill-service";
import { resolveWorkspaceMcpServers } from "./workspace-extension-policy";

let cachedWorkspaceSettings: WorkspaceSettings | null = null;

export function getWorkspaceSettings(): WorkspaceSettings {
  if (!cachedWorkspaceSettings)
    cachedWorkspaceSettings = loadWorkspaceSettings();
  return cachedWorkspaceSettings;
}

export function getCurrentWorkspace(): WorkspaceInfo | null {
  const settings = getWorkspaceSettings();
  if (!settings.currentWorkspaceId) return null;
  return (
    settings.workspaces.find(
      (workspace) => workspace.id === settings.currentWorkspaceId,
    ) ?? null
  );
}

export async function selectWorkspace(): Promise<WorkspaceInfo | null> {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
    title: "Select workspace folder",
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return upsertWorkspace(result.filePaths[0]);
}

/** Pick a project directory without creating or switching a workspace. */
export async function pickWorkspaceFolder(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
    title: "Select workspace folder",
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
}

export function createWorkspace(
  path: string,
  update: WorkspaceConfigUpdate = {},
): WorkspaceInfo {
  const settings = getWorkspaceSettings();
  const normalizedPath = path.trim();
  if (!normalizedPath) throw new Error("Workspace path is required");

  const now = Date.now();
  let workspace = settings.workspaces.find((item) =>
    workspacePathsEqual(item.path, normalizedPath),
  );
  const isNew = !workspace;
  if (!workspace) {
    const name = basename(normalizedPath) || "workspace";
    workspace = {
      id: `${name}-${now}`,
      name,
      path: normalizedPath,
      lastOpenedAt: now,
    };
    settings.workspaces.unshift(workspace);
  }

  workspace.lastOpenedAt = now;
  applyWorkspaceConfig(workspace, update);
  settings.currentWorkspaceId = workspace.id;
  saveWorkspaceSettings(settings);
  prewarmWorkspaceSkills("workspace_created");
  logInfo("workspace.created", {
    workspaceId: workspace.id,
    path: normalizedPath,
    isNew,
  });
  return workspace;
}

export function switchWorkspace(workspaceId: string): WorkspaceInfo | null {
  const settings = getWorkspaceSettings();
  const workspace = settings.workspaces.find((item) => item.id === workspaceId);
  if (!workspace) return null;
  workspace.lastOpenedAt = Date.now();
  settings.currentWorkspaceId = workspace.id;
  saveWorkspaceSettings(settings);
  prewarmWorkspaceSkills("workspace_switched");
  logInfo("workspace.switched", { workspaceId, name: workspace.name });
  return workspace;
}

export function renameWorkspace(
  workspaceId: string,
  name: string,
): WorkspaceInfo | null {
  const nextName = name.trim();
  if (!nextName) return null;
  const settings = getWorkspaceSettings();
  const workspace = settings.workspaces.find((item) => item.id === workspaceId);
  if (!workspace) return null;
  workspace.name = nextName;
  saveWorkspaceSettings(settings);
  logInfo("workspace.renamed", { workspaceId, name: nextName });
  return workspace;
}

export function updateWorkspaceConfig(
  workspaceId: string,
  update: WorkspaceConfigUpdate,
): WorkspaceInfo | null {
  const settings = getWorkspaceSettings();
  const workspace = settings.workspaces.find((item) => item.id === workspaceId);
  if (!workspace) return null;

  applyWorkspaceConfig(workspace, update);

  saveWorkspaceSettings(settings);
  prewarmWorkspaceSkills("workspace_config_updated");
  logInfo("workspace.configUpdated", { workspaceId, name: workspace.name });
  return workspace;
}

export function findWorkspaceByPath(
  workspacePath?: string,
): WorkspaceInfo | null {
  if (!workspacePath) return null;
  return (
    getWorkspaceSettings().workspaces.find((workspace) =>
      workspacePathsEqual(workspace.path, workspacePath),
    ) ?? null
  );
}

/**
 * Resolve the exact MCP set for one workspace. Project policy is an allow-list:
 * installing a new global server never silently enables it in custom mode.
 */
export function getEffectiveAgentSettings(
  baseSettings: AgentSettings,
  workspacePath?: string,
): AgentSettings {
  const workspace = findWorkspaceByPath(workspacePath);
  if (!workspace) return baseSettings;

  return {
    ...baseSettings,
    mcpServers: resolveWorkspaceMcpServers(
      baseSettings.mcpServers,
      workspace.mcpPolicy,
    ),
  };
}

export function removeWorkspace(workspaceId: string): WorkspaceInfo | null {
  const settings = getWorkspaceSettings();
  const index = settings.workspaces.findIndex(
    (item) => item.id === workspaceId,
  );
  if (index === -1) return getCurrentWorkspace();
  const removed = settings.workspaces[index];
  settings.workspaces.splice(index, 1);
  if (settings.currentWorkspaceId === workspaceId) {
    settings.currentWorkspaceId = settings.workspaces[0]?.id;
  }
  saveWorkspaceSettings(settings);
  logInfo("workspace.removed", { workspaceId, path: removed.path });
  return getCurrentWorkspace();
}

export function upsertWorkspace(path: string): WorkspaceInfo {
  return createWorkspace(path);
}

export function resolveWorkspacePath(inputPath: string): string {
  const workspace = getCurrentWorkspace();
  if (!workspace) throw new Error("No workspace selected");
  const root = resolve(workspace.path);
  const candidate =
    inputPath && inputPath !== "." ? resolve(root, inputPath) : root;
  const rel = relative(root, candidate);
  if (rel.startsWith("..") || resolve(rel) === rel) {
    throw new Error("Path is outside the current workspace");
  }
  return candidate;
}

export function resetWorkspaceSettingsCacheForTests(): void {
  cachedWorkspaceSettings = null;
}

function prewarmWorkspaceSkills(reason: string): void {
  queueMicrotask(() => {
    try {
      prepareSkillRuntimeCache(reason);
    } catch (error) {
      logWarn("workspace.skillsPrewarm.failed", {
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

function loadWorkspaceSettings(): WorkspaceSettings {
  const settingsPath = getWorkspaceSettingsPath();
  try {
    if (!existsSync(settingsPath)) return { workspaces: [] };
    const parsed = JSON.parse(
      readFileSync(settingsPath, "utf-8"),
    ) as Partial<WorkspaceSettings>;
    const withImportedDevWorkspaces =
      mergeDevWorkspaceSettingsForImport(parsed) ?? {};
    const workspaces = Array.isArray(withImportedDevWorkspaces.workspaces)
      ? withImportedDevWorkspaces.workspaces
          .filter((item): item is WorkspaceInfo =>
            Boolean(
              item &&
              typeof item.id === "string" &&
              typeof item.path === "string",
            ),
          )
          .map(normalizeWorkspace)
      : [];
    const currentWorkspaceId =
      typeof withImportedDevWorkspaces.currentWorkspaceId === "string"
        ? withImportedDevWorkspaces.currentWorkspaceId
        : undefined;
    return {
      workspaces,
      currentWorkspaceId: workspaces.some(
        (item) => item.id === currentWorkspaceId,
      )
        ? currentWorkspaceId
        : workspaces[0]?.id,
    };
  } catch {
    return { workspaces: [] };
  }
}

function normalizeWorkspace(workspace: WorkspaceInfo): WorkspaceInfo {
  return {
    ...workspace,
    tags: Array.isArray(workspace.tags)
      ? Array.from(
          new Set(
            workspace.tags.map((tag) => String(tag).trim()).filter(Boolean),
          ),
        )
      : undefined,
    skillPolicy: workspace.skillPolicy
      ? normalizeSkillPolicy(workspace.skillPolicy)
      : undefined,
    mcpPolicy: workspace.mcpPolicy
      ? normalizeMcpPolicy(workspace.mcpPolicy)
      : undefined,
  };
}

function normalizeSkillPolicy(
  policy: WorkspaceSkillPolicy,
): WorkspaceSkillPolicy {
  return {
    mode: policy.mode === "custom" ? "custom" : "inherit",
    enabledSkillIds: Array.from(
      new Set((policy.enabledSkillIds ?? []).map(String).filter(Boolean)),
    ),
    includeProjectSkills: policy.includeProjectSkills !== false,
  };
}

function normalizeMcpPolicy(policy: WorkspaceMcpPolicy): WorkspaceMcpPolicy {
  return {
    mode: policy.mode === "custom" ? "custom" : "inherit",
    enabledServerIds: Array.from(
      new Set((policy.enabledServerIds ?? []).map(String).filter(Boolean)),
    ),
    projectServers: Array.isArray(policy.projectServers)
      ? policy.projectServers.filter((server): server is McpServerConfig =>
          Boolean(server && typeof server.id === "string" && server.id.trim()),
        )
      : [],
  };
}

function applyWorkspaceConfig(
  workspace: WorkspaceInfo,
  update: WorkspaceConfigUpdate,
): void {
  if (update.name !== undefined) {
    const name = update.name.trim();
    if (name) workspace.name = name;
  }
  if (update.tags !== undefined) {
    workspace.tags = Array.from(
      new Set(update.tags.map((tag) => tag.trim()).filter(Boolean)),
    );
  }
  if (update.skillPolicy !== undefined) {
    workspace.skillPolicy = normalizeSkillPolicy(update.skillPolicy);
  }
  if (update.mcpPolicy !== undefined) {
    workspace.mcpPolicy = normalizeMcpPolicy(update.mcpPolicy);
  }
}

export function mergeWorkspaceSettingsForImport(
  settings: Partial<WorkspaceSettings> | undefined,
  imported: Partial<WorkspaceSettings> | undefined,
): Partial<WorkspaceSettings> | undefined {
  const importedWorkspaces = Array.isArray(imported?.workspaces)
    ? imported.workspaces
    : [];
  if (!importedWorkspaces.length) return settings;

  const merged = [...(settings?.workspaces ?? [])];
  for (const workspace of importedWorkspaces) {
    if (
      !workspace ||
      typeof workspace.id !== "string" ||
      typeof workspace.path !== "string"
    )
      continue;
    if (
      merged.some(
        (item) =>
          item.id === workspace.id ||
          workspacePathsEqual(item.path, workspace.path),
      )
    )
      continue;
    merged.push(workspace);
  }
  return {
    ...settings,
    currentWorkspaceId: settings?.currentWorkspaceId,
    workspaces: merged,
  };
}

function mergeDevWorkspaceSettingsForImport(
  settings: Partial<WorkspaceSettings> | undefined,
): Partial<WorkspaceSettings> | undefined {
  const devSettingsPath = getDevSettingsPathForImport();
  if (!devSettingsPath || !existsSync(devSettingsPath)) return settings;
  try {
    const devStore = JSON.parse(readFileSync(devSettingsPath, "utf-8")) as {
      workspaceSettings?: Partial<WorkspaceSettings>;
    };
    return mergeWorkspaceSettingsForImport(
      settings,
      devStore.workspaceSettings,
    );
  } catch (error) {
    logWarn("workspace.devWorkspaceImportSkipped", {
      devSettingsPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return settings;
  }
}

function saveWorkspaceSettings(settings: WorkspaceSettings): void {
  const settingsPath = getWorkspaceSettingsPath();
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
}
