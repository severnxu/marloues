import { dialog } from "electron";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import type {
  SkillDetail,
  SkillInfo,
  SkillMarketplaceDetail,
  SkillMarketplaceListResponse,
} from "@shared/types";
import {
  getEnterpriseSkillsDir,
  getMarlouesHome,
  getUserSkillsDir,
} from "../app-paths";
import { logInfo } from "../core/logging/app-logger";
import {
  getAgentSettings,
  getEnterpriseSkillRoots,
  saveAgentSettings,
} from "./config-service";
import { getSkillRuntimePolicy } from "./skill-policy";
import { getCurrentWorkspace } from "./workspace-service";

const SKILL_CACHE_TTL_MS = 30_000;

interface SkillCacheEntry {
  signature: string;
  skills: SkillInfo[];
  refreshedAt: number;
}

let skillCache: SkillCacheEntry | null = null;

/** 迁移旧技能目录（~/.marloues-dev/skills → runtime-config/skills）一次。 */
let skillDirMigrationDone = false;
function migrateLegacySkillDirs(): void {
  if (skillDirMigrationDone) return;
  skillDirMigrationDone = true;
  const legacyPairs: Array<[string, string]> = [
    [join(getMarlouesHome(), "skills"), getUserSkillsDir()],
    [join(getMarlouesHome(), "enterprise-skills"), getEnterpriseSkillsDir()],
  ];
  for (const [legacyDir, targetDir] of legacyPairs) {
    if (!existsSync(legacyDir)) continue;
    if (existsSync(targetDir) && readdirSync(targetDir).length > 0) continue;
    const entries = readdirSync(legacyDir);
    if (entries.length === 0) continue;
    mkdirSync(targetDir, { recursive: true });
    for (const name of entries) {
      cpSync(join(legacyDir, name), join(targetDir, name), {
        recursive: true,
        force: true,
      });
    }
    logInfo("skills.migratedLegacyDir", {
      from: legacyDir,
      to: targetDir,
      count: entries.length,
    });
  }
}

export function listInstalledSkills(): SkillInfo[] {
  migrateLegacySkillDirs();
  const signature = buildSkillCacheSignature();
  const now = Date.now();
  if (
    skillCache?.signature === signature &&
    now - skillCache.refreshedAt < SKILL_CACHE_TTL_MS
  ) {
    return [...skillCache.skills];
  }
  return refreshSkillCache(signature);
}

export function prepareSkillRuntimeCache(reason = "startup"): SkillInfo[] {
  const startedAt = Date.now();
  const skills = refreshSkillCache(buildSkillCacheSignature());
  const enabledCount = skills.filter((skill) => skill.enabled).length;
  logInfo("skills.runtimeCache.prepared", {
    reason,
    skillCount: skills.length,
    enabledSkillCount: enabledCount,
    elapsedMs: Date.now() - startedAt,
  });
  return skills;
}

function refreshSkillCache(
  signature = buildSkillCacheSignature(),
): SkillInfo[] {
  const settings = getAgentSettings();
  const disabled = new Set(settings.disabledSkills);
  const workspace = getCurrentWorkspace();
  const projectSkillsRoot = workspace?.path
    ? join(workspace.path, ".claude", "skills")
    : undefined;
  const customDirs = (settings.skillDirectories ?? []).map((dir) =>
    resolve(dir),
  );
  const dirs = [
    ...listSkillChildDirs(getUserSkillsDir()).map((dir) => ({
      dir,
      scope: "user" as const,
    })),
    ...customDirs.map((dir) => ({ dir, scope: "user" as const })),
    ...(projectSkillsRoot
      ? listSkillChildDirs(projectSkillsRoot).map((dir) => ({
          dir,
          scope: "project" as const,
        }))
      : []),
    ...listSkillChildDirs(getEnterpriseSkillsDir()).map((dir) => ({
      dir,
      scope: "enterprise" as const,
    })),
    ...getEnterpriseSkillRoots().flatMap((root) =>
      listSkillChildDirs(root).map((dir) => ({
        dir,
        scope: "enterprise" as const,
      })),
    ),
  ];

  const byId = new Map<string, SkillInfo>();
  for (const entry of dirs) {
    const skill = readSkillInfo(entry.dir, entry.scope);
    if (!skill) continue;
    byId.set(skill.id, {
      ...skill,
      enabled: !disabled.has(skill.id),
      removable:
        entry.scope === "user" && customDirs.includes(resolve(entry.dir)),
    });
  }

  const skills = Array.from(byId.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  skillCache = { signature, skills, refreshedAt: Date.now() };
  logInfo("skills.cache.refreshed", {
    skillCount: skills.length,
    enabledSkillCount: skills.filter((skill) => skill.enabled).length,
  });
  return [...skills];
}

function buildSkillCacheSignature(): string {
  const settings = getAgentSettings();
  const policy = getSkillRuntimePolicy();
  const workspace = getCurrentWorkspace();
  return createHash("sha256")
    .update(
      JSON.stringify({
        userSkillsDir: getUserSkillsDir(),
        enterpriseSkillsDir: getEnterpriseSkillsDir(),
        enterpriseSkillRoots: getEnterpriseSkillRoots().map((dir) =>
          resolve(dir),
        ),
        workspacePath: workspace?.path,
        skillDirectories: (settings.skillDirectories ?? []).map((dir) =>
          resolve(dir),
        ),
        disabledSkills: settings.disabledSkills,
        policy,
      }),
    )
    .digest("hex");
}

export async function importSkillFolder(): Promise<SkillInfo | null> {
  const policy = getSkillRuntimePolicy();
  if (!policy.allowLocalImport) {
    throw new Error(
      `Local Skill import is disabled in ${policy.env} environment.`,
    );
  }

  const result = await dialog.showOpenDialog({
    title: "Import Skill folder",
    properties: ["openDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return null;

  const dir = resolve(result.filePaths[0]);
  const skill = readSkillInfo(dir, "user");
  if (!skill) throw new Error("Selected folder does not contain SKILL.md.");

  return importSkillFolderToRoot(dir, getUserSkillsDir());
}

export function importSkillFolderToRoot(
  source: string,
  targetRoot: string,
): SkillInfo {
  const sourceDir = resolve(source);
  const skill = readSkillInfo(sourceDir, "user");
  if (!skill) throw new Error("Selected folder does not contain SKILL.md.");

  const target = resolve(targetRoot, basename(sourceDir));
  mkdirSync(targetRoot, { recursive: true });
  if (sourceDir !== target) {
    cpSync(sourceDir, target, { recursive: true, force: true });
  }
  skillCache = null;

  const imported = readSkillInfo(target, "user");
  if (!imported)
    throw new Error("Imported Skill could not be read after copying.");
  logInfo("skill.imported", {
    skillId: imported.id,
    name: imported.name,
    sourceDir,
  });
  return {
    ...imported,
    enabled: true,
    removable: false,
  };
}

export function toggleSkill(skillId: string, enabled: boolean): SkillInfo[] {
  assertMutableLocalSkills("Changing Skill enabled state");
  const settings = getAgentSettings();
  const disabled = new Set(settings.disabledSkills);
  if (enabled) disabled.delete(skillId);
  else disabled.add(skillId);
  saveAgentSettings({
    ...settings,
    disabledSkills: Array.from(disabled),
  });
  logInfo("skill.toggled", { skillId, enabled });
  return listInstalledSkills();
}

export function removeSkill(skillId: string): SkillInfo[] {
  assertMutableLocalSkills("Removing local Skills");
  const settings = getAgentSettings();
  const skill = listInstalledSkills().find((item) => item.id === skillId);
  if (!skill) throw new Error(`Skill not found: ${skillId}`);
  if (!skill.removable)
    throw new Error("Only imported user Skills can be removed.");

  saveAgentSettings({
    ...settings,
    skillDirectories: (settings.skillDirectories ?? []).filter(
      (dir) => skillIdForPath(dir) !== skillId,
    ),
    disabledSkills: settings.disabledSkills.filter((id) => id !== skillId),
  });
  logInfo("skill.removed", { skillId, path: skill.path });
  return listInstalledSkills();
}

export function getSkillDetail(skillId: string): SkillDetail {
  const skill = listInstalledSkills().find((item) => item.id === skillId);
  if (!skill) throw new Error(`Skill not found: ${skillId}`);
  return {
    ...skill,
    content: readSkillContent(skill.path),
  };
}

export function listMarketplaceSkills(): SkillMarketplaceListResponse {
  return { items: [], total: 0, hasMore: false };
}

export function getMarketplaceSkillDetail(
  slug: string,
): SkillMarketplaceDetail {
  return {
    slug,
    name: slug,
    installed: false,
    sourceUrl: "",
    content:
      "Skill marketplace is not configured in this build. Use Import to add a local Skill folder.",
    securityStatus: "unknown",
  };
}

export function installMarketplaceSkill(): SkillInfo[] {
  return listInstalledSkills();
}

export function readSkillInfo(
  dir: string,
  scope: SkillInfo["scope"],
): SkillInfo | null {
  const skillPath = resolve(dir);
  const skillFile = resolve(skillPath, "SKILL.md");
  if (!existsSync(skillFile)) return null;
  const content = readSkillContent(skillPath);
  const metadata = parseSkillMetadata(content);
  const id = skillIdForPath(skillPath);
  return {
    id,
    name: metadata.name ?? basename(skillPath),
    scope,
    path: skillPath,
    enabled: true,
    description: metadata.description,
    permissions: metadata.permissions,
    mutable: scope !== "enterprise",
    removable: false,
    trusted: scope === "enterprise",
    integrityStatus: "unchecked",
    version: metadata.version,
  };
}

export function skillIdForPath(dir: string): string {
  return `local:${resolve(dir)}`;
}

function listSkillChildDirs(parentDir: string): string[] {
  try {
    if (!existsSync(parentDir)) return [];
    return readdirSync(parentDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => resolve(parentDir, entry.name));
  } catch {
    return [];
  }
}

function readSkillContent(dir: string): string {
  const skillFile = resolve(dir, "SKILL.md");
  return readFileSync(skillFile, "utf-8");
}

function parseSkillMetadata(content: string): {
  name?: string;
  description?: string;
  version?: string;
  permissions?: string[];
} {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const source =
    frontmatter?.[1] ?? content.split(/\r?\n/).slice(0, 40).join("\n");
  const metadata: ReturnType<typeof parseSkillMetadata> = {};
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.+?)\s*$/);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const value = match[2].replace(/^["']|["']$/g, "").trim();
    if (key === "name") metadata.name = value;
    if (key === "description") metadata.description = value;
    if (key === "version") metadata.version = value;
    if (key === "permissions") {
      const inlinePermissions = parseInlinePermissionList(value);
      if (inlinePermissions.length) metadata.permissions = inlinePermissions;
    }
  }
  metadata.permissions ??= parseBlockPermissionList(source);
  if (!metadata.name) {
    const heading = content.match(/^#\s+(.+)$/m);
    if (heading) metadata.name = heading[1].trim();
  }
  if (!metadata.description) {
    const paragraph = content
      .replace(/^---\r?\n[\s\S]*?\r?\n---/, "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("#"));
    if (paragraph) metadata.description = paragraph.slice(0, 180);
  }
  return metadata;
}

function parseInlinePermissionList(value: string): string[] {
  return value
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((item) => cleanPermissionValue(item))
    .filter(Boolean);
}

function parseBlockPermissionList(source: string): string[] | undefined {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => /^\s*permissions\s*:\s*$/.test(line));
  if (start < 0) return undefined;
  const permissions: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!/^\s*-\s+/.test(line)) break;
    const value = cleanPermissionValue(line.replace(/^\s*-\s+/, ""));
    if (value) permissions.push(value);
  }
  return permissions.length ? permissions : undefined;
}

function cleanPermissionValue(value: string): string {
  return value.replace(/^["']|["']$/g, "").trim();
}

function assertMutableLocalSkills(action: string): void {
  const enterprisePolicy = getAgentSettings().enterprisePolicy;
  if (enterprisePolicy?.allowLocalSkillDisable === false) {
    throw new Error(
      "Enterprise policy does not allow changing Skill enabled state.",
    );
  }
  const policy = getSkillRuntimePolicy();
  if (!policy.allowMutableLocalSkills) {
    throw new Error(`${action} is disabled in ${policy.env} environment.`);
  }
}
