import { dialog } from "electron";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import type {
  SkillDetail,
  SkillInfo,
  SkillMarketplaceDetail,
  SkillMarketplaceItem,
  SkillMarketplaceListResponse,
  SkillMarketplaceListRequest,
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
const SKILLSMP_SEARCH_PATH = "/api/v1/skills/search";
const GITHUB_API_URL = "https://api.github.com";
const MARKETPLACE_DEFAULT_QUERY = "skill";
const MAX_MARKETPLACE_FILE_COUNT = 100;
const MAX_MARKETPLACE_FILE_SIZE_BYTES = 512 * 1024;
const MAX_MARKETPLACE_TOTAL_SIZE_BYTES = 5 * 1024 * 1024;

interface SkillsMpSkill {
  id: string;
  name: string;
  author: string;
  description: string;
  githubUrl: string;
  skillUrl: string;
  stars: number;
  updatedAt: number;
}

interface SkillsMpSearchResponse {
  success: boolean;
  data?: {
    skills?: SkillsMpSkill[];
    pagination?: { page?: number; total?: number; hasMore?: boolean };
  };
  error?: { message?: string };
}

interface GithubContentEntry {
  type: "file" | "dir" | "symlink" | "submodule";
  name: string;
  path: string;
  size?: number;
  content?: string;
  encoding?: string;
}

interface GithubSkillSource {
  owner: string;
  repository: string;
  ref: string;
  path: string;
}

const marketplaceSkills = new Map<string, SkillsMpSkill>();

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

export async function listMarketplaceSkills(
  request: SkillMarketplaceListRequest = {},
): Promise<SkillMarketplaceListResponse> {
  const query = request.query?.trim() || MARKETPLACE_DEFAULT_QUERY;
  const pageNo = Math.max(1, (request.pageNo ?? Number(request.cursor)) || 1);
  const pageSize = Math.min(50, Math.max(1, request.pageSize ?? 20));
  const url = new URL(`${getMarketplaceBaseUrl()}${SKILLSMP_SEARCH_PATH}`);
  url.searchParams.set("q", query);
  url.searchParams.set("page", String(pageNo));
  url.searchParams.set("limit", String(pageSize));
  url.searchParams.set("sortBy", "stars");
  if (request.tagId) url.searchParams.set("category", request.tagId);

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  const payload = (await response.json()) as SkillsMpSearchResponse;
  if (!response.ok || !payload.success) {
    throw new Error(payload.error?.message || "SkillsMP search failed.");
  }
  const remoteSkills = payload.data?.skills ?? [];
  for (const skill of remoteSkills) marketplaceSkills.set(skill.id, skill);
  const total = payload.data?.pagination?.total;
  const hasMore =
    payload.data?.pagination?.hasMore ??
    (total !== undefined && pageNo * pageSize < total);
  return {
    items: remoteSkills.map(toMarketplaceItem),
    total,
    nextCursor: hasMore ? String(pageNo + 1) : undefined,
    hasMore,
  };
}

export async function testMarketplaceEndpoint(
  endpoint: import("@shared/types").MarketplaceEndpoint,
): Promise<import("@shared/types").EndpointTestResult> {
  const startedAt = Date.now();
  try {
    const url = new URL(`${endpoint.baseUrl.replace(/\/$/, "")}/api/health`);
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    const ok = response.ok;
    return {
      ok,
      status: response.status,
      latencyMs: Date.now() - startedAt,
      message: ok
        ? "市场端点连接正常。"
        : `市场端点返回 HTTP ${response.status}。`,
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getMarketplaceSkillDetail(
  slug: string,
): Promise<SkillMarketplaceDetail> {
  const remoteSkill = await findMarketplaceSkill(slug);
  const source = parseGithubSkillSource(remoteSkill.githubUrl);
  const content = await downloadSkillMarkdown(source);
  const item = toMarketplaceItem(remoteSkill);
  return {
    ...item,
    content,
    securityStatus: "unknown",
    securitySummary:
      "来源为 SkillsMP 索引的 GitHub 公开目录。安装时不会执行第三方脚本。",
  };
}

export async function installMarketplaceSkill(
  slug: string,
): Promise<SkillInfo[]> {
  assertMarketplaceInstallAllowed();
  const remoteSkill = await findMarketplaceSkill(slug);
  const source = parseGithubSkillSource(remoteSkill.githubUrl);
  const targetRoot = getUserSkillsDir();
  const targetDir = join(targetRoot, marketplaceDirectoryName(remoteSkill.id));
  const temporaryDir = `${targetDir}.installing-${Date.now()}`;

  mkdirSync(targetRoot, { recursive: true });
  rmSync(temporaryDir, { recursive: true, force: true });
  try {
    await downloadGithubDirectory(source, temporaryDir);
    if (!existsSync(join(temporaryDir, "SKILL.md"))) {
      throw new Error(
        "The selected GitHub directory does not contain SKILL.md.",
      );
    }
    rmSync(targetDir, { recursive: true, force: true });
    renameSync(temporaryDir, targetDir);
  } catch (error) {
    rmSync(temporaryDir, { recursive: true, force: true });
    throw error;
  }
  skillCache = null;
  logInfo("skill.marketplaceInstalled", {
    skillId: remoteSkill.id,
    sourceUrl: remoteSkill.githubUrl,
    targetDir,
  });
  return listInstalledSkills();
}

async function findMarketplaceSkill(slug: string): Promise<SkillsMpSkill> {
  const cached = marketplaceSkills.get(slug);
  if (cached) return cached;
  const result = await listMarketplaceSkills({ query: slug, pageSize: 50 });
  const skill = result.items
    .map((item) => marketplaceSkills.get(item.slug))
    .find((item): item is SkillsMpSkill => item?.id === slug);
  if (!skill) throw new Error("Skill was not found in SkillsMP.");
  return skill;
}

function toMarketplaceItem(skill: SkillsMpSkill): SkillMarketplaceItem {
  return {
    slug: skill.id,
    name: skill.name,
    description: skill.description,
    ownerHandle: skill.author,
    stars: skill.stars,
    updatedAt: skill.updatedAt * 1_000,
    installed: existsSync(
      join(getUserSkillsDir(), marketplaceDirectoryName(skill.id)),
    ),
    sourceUrl: skill.githubUrl,
  };
}

function parseGithubSkillSource(githubUrl: string): GithubSkillSource {
  const url = new URL(githubUrl);
  if (url.protocol !== "https:" || url.hostname !== "github.com") {
    throw new Error("SkillsMP returned a non-GitHub Skill source.");
  }
  const segments = url.pathname.split("/").filter(Boolean);
  const [owner, repository, tree, ref, ...path] = segments;
  if (!owner || !repository || tree !== "tree" || !ref || !path.length) {
    throw new Error("SkillsMP returned an unsupported GitHub Skill URL.");
  }
  return { owner, repository, ref, path: path.join("/") };
}

async function downloadSkillMarkdown(
  source: GithubSkillSource,
): Promise<string> {
  const file = await getGithubContents(source, `${source.path}/SKILL.md`);
  if (
    Array.isArray(file) ||
    file.type !== "file" ||
    file.encoding !== "base64" ||
    !file.content
  ) {
    throw new Error("Unable to download SKILL.md from GitHub.");
  }
  const content = Buffer.from(
    file.content.replace(/\n/g, ""),
    "base64",
  ).toString("utf8");
  if (!content.trim()) throw new Error("Downloaded SKILL.md is empty.");
  return content;
}

async function downloadGithubDirectory(
  source: GithubSkillSource,
  targetDir: string,
): Promise<void> {
  const queue = [{ remotePath: source.path, localPath: targetDir }];
  let fileCount = 0;
  let totalBytes = 0;
  while (queue.length) {
    const current = queue.shift()!;
    const contents = await getGithubContents(source, current.remotePath);
    if (!Array.isArray(contents)) {
      throw new Error("The selected GitHub Skill path is not a directory.");
    }
    mkdirSync(current.localPath, { recursive: true });
    for (const entry of contents) {
      if (
        !isSafeGithubPath(entry.name) ||
        entry.type === "symlink" ||
        entry.type === "submodule"
      )
        continue;
      const localPath = join(current.localPath, entry.name);
      if (entry.type === "dir") {
        queue.push({ remotePath: entry.path, localPath });
        continue;
      }
      if (entry.type !== "file") continue;
      fileCount += 1;
      totalBytes += entry.size ?? 0;
      if (
        fileCount > MAX_MARKETPLACE_FILE_COUNT ||
        entry.size === undefined ||
        entry.size > MAX_MARKETPLACE_FILE_SIZE_BYTES ||
        totalBytes > MAX_MARKETPLACE_TOTAL_SIZE_BYTES
      ) {
        throw new Error(
          "Skill exceeds the marketplace installation safety limits.",
        );
      }
      const file = await getGithubContents(source, entry.path);
      if (
        Array.isArray(file) ||
        file.type !== "file" ||
        file.encoding !== "base64" ||
        !file.content
      ) {
        throw new Error(`Unable to download ${entry.path} from GitHub.`);
      }
      writeFileSync(
        localPath,
        Buffer.from(file.content.replace(/\n/g, ""), "base64"),
      );
    }
  }
}

async function getGithubContents(
  source: GithubSkillSource,
  path: string,
): Promise<GithubContentEntry[] | GithubContentEntry> {
  const url = new URL(
    `${GITHUB_API_URL}/repos/${source.owner}/${source.repository}/contents/${path}`,
  );
  url.searchParams.set("ref", source.ref);
  const response = await fetch(url, {
    headers: { Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error("Unable to download the Skill directory from GitHub.");
  return (await response.json()) as GithubContentEntry[] | GithubContentEntry;
}

function getMarketplaceBaseUrl(): string {
  const endpoint = getAgentSettings().skillMarketplaceEndpoint;
  if (!endpoint?.enabled)
    throw new Error("No enabled Skill marketplace endpoint configured.");
  return endpoint.baseUrl.replace(/\/$/, "");
}

function isSafeGithubPath(name: string): boolean {
  return (
    Boolean(name) &&
    name !== "." &&
    name !== ".." &&
    !name.includes("/") &&
    !name.includes("\\")
  );
}

function marketplaceDirectoryName(skillId: string): string {
  return `skillsmp-${skillId.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 120)}`;
}

function assertMarketplaceInstallAllowed(): void {
  const policy = getSkillRuntimePolicy();
  if (policy.requireSignature) {
    throw new Error(
      "Marketplace installation requires a signed marketplace in this environment.",
    );
  }
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
