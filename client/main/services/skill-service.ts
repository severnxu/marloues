import { createHash, randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  extname,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { unzipSync } from "fflate";
import type {
  SkillInstallSource,
  SkillDetail,
  SkillDetailFile,
  SkillInfo,
  SkillImportPreview,
  SkillMarketplaceEndpoint,
  SkillMarketplaceDetail,
  SkillMarketplaceDetailSection,
  SkillMarketplaceItem,
  SkillMarketplaceListResponse,
  SkillMarketplaceListRequest,
  WorkspaceInfo,
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
import { requestMarketplaceBinary } from "./marketplace-http-client";
import {
  getRemoteSkillDetail,
  listRemoteSkills,
  testSkillMarketplaceEndpoint,
} from "./skill-marketplace/skill-marketplace-service";
import { getWorkspaceSettings } from "./workspace-service";
import { isWorkspaceSkillEnabled } from "./workspace-extension-policy";

const SKILL_CACHE_TTL_MS = 30_000;
const GITHUB_API_URL = "https://api.github.com";
const MAX_MARKETPLACE_FILE_COUNT = 100;
const MAX_MARKETPLACE_FILE_SIZE_BYTES = 512 * 1024;
const MAX_MARKETPLACE_TOTAL_SIZE_BYTES = 5 * 1024 * 1024;

interface LocalSkillImportDescriptor {
  preview: SkillImportPreview;
  directoryName: string;
  sourceKind: SkillImportPreview["sourceKind"];
  archiveFiles?: Array<{ path: string; content: Uint8Array }>;
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

export function listInstalledSkills(
  workspace: WorkspaceInfo | null = null,
): SkillInfo[] {
  migrateLegacySkillDirs();
  const signature = buildSkillCacheSignature(workspace);
  const now = Date.now();
  if (
    skillCache?.signature === signature &&
    now - skillCache.refreshedAt < SKILL_CACHE_TTL_MS
  ) {
    return [...skillCache.skills];
  }
  return refreshSkillCache(signature, workspace);
}

export function prepareSkillRuntimeCache(reason = "startup"): SkillInfo[] {
  const startedAt = Date.now();
  const skills = refreshSkillCache(buildSkillCacheSignature(null), null);
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
  signature = buildSkillCacheSignature(null),
  workspace: WorkspaceInfo | null = null,
): SkillInfo[] {
  const settings = getAgentSettings();
  const disabled = new Set(settings.disabledSkills);
  const customDirs = (settings.skillDirectories ?? []).map((dir) =>
    resolve(dir),
  );
  const dirs = [
    ...listSkillChildDirs(getUserSkillsDir()).map((dir) => ({
      dir,
      scope: "user" as const,
    })),
    ...customDirs.map((dir) => ({ dir, scope: "user" as const })),
    ...projectSkillDirectories(workspace).map((dir) => ({
      dir,
      scope: "project" as const,
    })),
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
      enabled: isWorkspaceSkillEnabled(skill, disabled, workspace?.skillPolicy),
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

function buildSkillCacheSignature(workspace: WorkspaceInfo | null): string {
  const settings = getAgentSettings();
  const policy = getSkillRuntimePolicy();
  return createHash("sha256")
    .update(
      JSON.stringify({
        userSkillsDir: getUserSkillsDir(),
        enterpriseSkillsDir: getEnterpriseSkillsDir(),
        enterpriseSkillRoots: getEnterpriseSkillRoots().map((dir) =>
          resolve(dir),
        ),
        workspacePath: workspace?.path,
        workspaceSkillPolicy: workspace?.skillPolicy,
        skillDirectories: (settings.skillDirectories ?? []).map((dir) =>
          resolve(dir),
        ),
        disabledSkills: settings.disabledSkills,
        policy,
      }),
    )
    .digest("hex");
}

export function listWorkspaceSkills(
  workspaceId: string,
  workspacePath?: string,
): SkillInfo[] {
  const persistedWorkspace = getWorkspaceSettings().workspaces.find(
    (item) => item.id === workspaceId,
  );
  const workspace =
    persistedWorkspace ??
    (workspacePath
      ? {
          id: workspaceId,
          name: basename(workspacePath) || "workspace",
          path: workspacePath,
          lastOpenedAt: Date.now(),
        }
      : null);
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);
  return listInstalledSkills(workspace);
}

function projectSkillDirectories(workspace: WorkspaceInfo | null): string[] {
  if (!workspace?.path) return [];
  const roots = [
    join(workspace.path, ".marloues", "skills"),
    join(workspace.path, ".claude", "skills"),
    join(workspace.path, ".agents", "skills"),
  ];
  return roots.flatMap((root) => listSkillChildDirs(root));
}

export function inspectSkillImportSource(source: string): SkillImportPreview {
  const policy = getSkillRuntimePolicy();
  if (!policy.allowLocalImport) {
    throw new Error(
      `Local Skill import is disabled in ${policy.env} environment.`,
    );
  }
  return describeLocalSkillImport(source, getUserSkillsDir()).preview;
}

export function importSkillSourceToRoot(
  source: string,
  targetRoot: string,
): SkillInfo {
  const descriptor = describeLocalSkillImport(source, targetRoot);
  const sourcePath = resolve(source);
  const target = resolve(targetRoot, descriptor.directoryName);
  mkdirSync(targetRoot, { recursive: true });
  if (descriptor.sourceKind === "directory" && sourcePath === target) {
    const existing = readSkillInfo(target, "user");
    if (!existing) throw new Error("导入后的 Skill 无法读取。");
    return { ...existing, enabled: true, removable: false };
  }

  const staging = resolve(
    targetRoot,
    `.${descriptor.directoryName}.importing-${randomUUID()}`,
  );
  try {
    if (descriptor.sourceKind === "directory") {
      cpSync(sourcePath, staging, { recursive: true, force: true });
    } else if (descriptor.sourceKind === "manifest") {
      mkdirSync(staging, { recursive: true });
      writeFileSync(resolve(staging, "SKILL.md"), readFileSync(sourcePath));
    } else {
      mkdirSync(staging, { recursive: true });
      for (const file of descriptor.archiveFiles ?? []) {
        const output = safeSkillTargetPath(staging, file.path);
        mkdirSync(dirname(output), { recursive: true });
        writeFileSync(output, Buffer.from(file.content));
      }
    }

    const stagedSkill = readSkillInfo(staging, "user");
    if (!stagedSkill) throw new Error("导入内容不包含可用的 SKILL.md。");
    rmSync(target, { recursive: true, force: true });
    renameSync(staging, target);
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }

  const imported = readSkillInfo(target, "user");
  if (!imported) throw new Error("导入后的 Skill 无法读取。");
  skillCache = null;
  logInfo("skill.imported", {
    skillId: imported.id,
    name: imported.name,
    sourcePath,
    sourceKind: descriptor.sourceKind,
  });
  return {
    ...imported,
    enabled: true,
    removable: false,
  };
}

/** Kept for service callers that still use the old directory-specific name. */
export function importSkillFolderToRoot(
  source: string,
  targetRoot: string,
): SkillInfo {
  return importSkillSourceToRoot(source, targetRoot);
}

function describeLocalSkillImport(
  source: string,
  targetRoot: string,
): LocalSkillImportDescriptor {
  const sourcePath = resolve(source);
  if (!existsSync(sourcePath)) throw new Error("所选导入内容不存在。");
  const stats = statSync(sourcePath);

  if (stats.isDirectory()) {
    const skill = readSkillInfo(sourcePath, "user");
    if (!skill) throw new Error("所选文件夹的根目录不包含 SKILL.md。");
    const metrics = measureLocalSkillDirectory(sourcePath);
    const directoryName = safeImportedDirectoryName(
      basename(sourcePath),
      skill.name,
    );
    return {
      sourceKind: "directory",
      directoryName,
      preview: createLocalImportPreview({
        path: sourcePath,
        name: skill.name,
        version: skill.version,
        sourceKind: "directory",
        fileCount: metrics.fileCount,
        totalBytes: metrics.totalBytes,
        targetRoot,
        directoryName,
      }),
    };
  }

  if (!stats.isFile())
    throw new Error("仅支持 Skill 文件夹、ZIP 或 SKILL.md。");
  const extension = extname(sourcePath).toLowerCase();
  if (basename(sourcePath).toLowerCase() === "skill.md") {
    if (stats.size > MAX_MARKETPLACE_FILE_SIZE_BYTES) {
      throw new Error("SKILL.md 超过 512 KB 大小限制。");
    }
    const metadata = parseSkillMetadata(readFileSync(sourcePath, "utf8"));
    const name = metadata.name || basename(dirname(sourcePath));
    const directoryName = safeImportedDirectoryName(name, "local-skill");
    return {
      sourceKind: "manifest",
      directoryName,
      preview: createLocalImportPreview({
        path: sourcePath,
        name,
        version: metadata.version,
        sourceKind: "manifest",
        fileCount: 1,
        totalBytes: stats.size,
        targetRoot,
        directoryName,
      }),
    };
  }

  if (extension !== ".zip") {
    throw new Error("仅支持 Skill 文件夹、.zip 或名为 SKILL.md 的文件。");
  }
  if (stats.size > MAX_MARKETPLACE_TOTAL_SIZE_BYTES) {
    throw new Error("ZIP 文件超过 5 MB 大小限制。");
  }
  return describeLocalSkillArchive(sourcePath, targetRoot);
}

function describeLocalSkillArchive(
  sourcePath: string,
  targetRoot: string,
): LocalSkillImportDescriptor {
  let declaredFileCount = 0;
  let declaredTotalBytes = 0;
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(readFileSync(sourcePath), {
      filter: (file) => {
        if (file.name.endsWith("/")) return false;
        declaredFileCount += 1;
        declaredTotalBytes += file.originalSize;
        if (file.originalSize > MAX_MARKETPLACE_FILE_SIZE_BYTES) {
          throw new Error("ZIP 中包含超过 512 KB 的单个文件。");
        }
        assertSkillInstallLimits(declaredFileCount, declaredTotalBytes);
        return true;
      },
    });
  } catch (error) {
    if (error instanceof Error && /(?:超过|exceeds)/i.test(error.message)) {
      throw error;
    }
    throw new Error("无法读取 ZIP，请确认压缩包未损坏。", {
      cause: error,
    });
  }

  const rawPaths = Object.keys(unzipped).filter(
    (path) => !isIgnoredArchivePath(path),
  );
  const rootPrefix = inferArchiveRootPrefix(rawPaths);
  const files = rawPaths.map((archivePath) => ({
    path: removeArchiveRootPrefix(archivePath, rootPrefix),
    content: unzipped[archivePath],
  }));
  if (files.some((file) => !isSafeRelativePath(file.path))) {
    throw new Error("ZIP 中包含不安全的文件路径。");
  }
  const manifests = files.filter(
    (file) => file.path.toLowerCase() === "skill.md",
  );
  if (manifests.length !== 1) {
    throw new Error("ZIP 根目录必须包含且只能包含一个 SKILL.md。");
  }
  const metadata = parseSkillMetadata(
    Buffer.from(manifests[0].content).toString("utf8"),
  );
  const name = metadata.name || rootPrefix || basename(sourcePath, ".zip");
  const directoryName = safeImportedDirectoryName(
    rootPrefix || name,
    "local-skill",
  );
  return {
    sourceKind: "archive",
    directoryName,
    archiveFiles: files,
    preview: createLocalImportPreview({
      path: sourcePath,
      name,
      version: metadata.version,
      sourceKind: "archive",
      fileCount: files.length,
      totalBytes: files.reduce((sum, file) => sum + file.content.byteLength, 0),
      targetRoot,
      directoryName,
    }),
  };
}

function createLocalImportPreview(input: {
  path: string;
  name: string;
  version?: string;
  sourceKind: SkillImportPreview["sourceKind"];
  fileCount: number;
  totalBytes: number;
  targetRoot: string;
  directoryName: string;
}): SkillImportPreview {
  return {
    path: input.path,
    name: input.name,
    version: input.version,
    entry: "SKILL.md",
    sourceKind: input.sourceKind,
    fileCount: input.fileCount,
    totalBytes: input.totalBytes,
    replacesExisting: existsSync(
      resolve(input.targetRoot, input.directoryName),
    ),
  };
}

function safeImportedDirectoryName(primary: string, fallback: string): string {
  const normalize = (value: string) =>
    value
      .trim()
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120);
  return normalize(primary) || normalize(fallback) || "local-skill";
}

function measureLocalSkillDirectory(rootDir: string): {
  fileCount: number;
  totalBytes: number;
} {
  const root = resolve(rootDir);
  const queue = [root];
  let fileCount = 0;
  let totalBytes = 0;
  while (queue.length) {
    const current = queue.shift()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolutePath = resolve(current, entry.name);
      if (!absolutePath.startsWith(`${root}${sep}`)) {
        throw new Error("Skill 文件夹包含不安全的文件路径。");
      }
      if (entry.isSymbolicLink()) {
        throw new Error("Skill 文件夹不能包含符号链接。");
      }
      if (entry.isDirectory()) {
        queue.push(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const size = statSync(absolutePath).size;
      if (size > MAX_MARKETPLACE_FILE_SIZE_BYTES) {
        throw new Error(`Skill 文件过大：${relative(root, absolutePath)}`);
      }
      fileCount += 1;
      totalBytes += size;
      assertSkillInstallLimits(fileCount, totalBytes);
    }
  }
  return { fileCount, totalBytes };
}

function isIgnoredArchivePath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  return (
    normalized.startsWith("__MACOSX/") ||
    normalized.endsWith("/.DS_Store") ||
    normalized === ".DS_Store"
  );
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
    files: listLocalSkillDetailFiles(skill.path),
  };
}

export async function listMarketplaceSkills(
  request: SkillMarketplaceListRequest = {},
): Promise<SkillMarketplaceListResponse> {
  const response = await listRemoteSkills(request);
  return {
    ...response,
    items: response.items.map(markMarketplaceInstalled),
  };
}

export async function testMarketplaceEndpoint(
  endpoint: SkillMarketplaceEndpoint,
): Promise<import("@shared/types").EndpointTestResult> {
  return testSkillMarketplaceEndpoint(endpoint);
}

export async function getMarketplaceSkillDetail(
  slug: string,
  version?: string,
  section: SkillMarketplaceDetailSection | string = "base",
): Promise<SkillMarketplaceDetail> {
  const normalizedSection = normalizeMarketplaceDetailSection(section);
  const detail = await getRemoteSkillDetail(
    slug,
    undefined,
    version,
    normalizedSection,
  );
  const installed = markMarketplaceInstalled(detail);
  if (installed.content.trim() || installed.install?.type !== "github") {
    return installed;
  }
  return {
    ...installed,
    content: await downloadSkillMarkdown(
      parseGithubSkillSource(installed.install),
    ),
  };
}

export async function installMarketplaceSkill(
  slug: string,
  version?: string,
): Promise<SkillInfo[]> {
  // Installation only needs the version manifest, security verdict and source.
  // Fetching "all" also downloads the archive once for UI previews, causing a
  // direct install to download the same package a second time below.
  const detail = await getRemoteSkillDetail(
    slug,
    undefined,
    version,
    "security",
  );
  assertMarketplaceInstallAllowed(detail);
  const source = detail.install;
  if (!source) throw new Error("该 Skill 没有可用的安装来源。");
  const targetRoot = getUserSkillsDir();
  const targetDir = join(targetRoot, marketplaceDirectoryName(detail.slug));
  const temporaryDir = `${targetDir}.installing-${Date.now()}`;

  mkdirSync(targetRoot, { recursive: true });
  rmSync(temporaryDir, { recursive: true, force: true });
  try {
    await downloadMarketplaceSkill(source, temporaryDir);
    if (!existsSync(join(temporaryDir, "SKILL.md"))) {
      throw new Error("该 Skill 安装包不包含 SKILL.md。");
    }
    rmSync(targetDir, { recursive: true, force: true });
    renameSync(temporaryDir, targetDir);
  } catch (error) {
    rmSync(temporaryDir, { recursive: true, force: true });
    throw error;
  }
  skillCache = null;
  logInfo("skill.marketplaceInstalled", {
    skillId: detail.slug,
    sourceUrl: detail.sourceUrl,
    targetDir,
  });
  return listInstalledSkills();
}

function normalizeMarketplaceDetailSection(
  section: SkillMarketplaceDetailSection | string,
): SkillMarketplaceDetailSection {
  if (
    section === "base" ||
    section === "content" ||
    section === "files" ||
    section === "security" ||
    section === "versions" ||
    section === "all"
  ) {
    return section;
  }
  return "base";
}

function markMarketplaceInstalled<T extends SkillMarketplaceItem>(item: T): T {
  return {
    ...item,
    installed: isMarketplaceSkillInstalled(item.slug),
  };
}

async function downloadSkillMarkdown(
  source: GithubSkillSource,
): Promise<string> {
  const file = await getGithubContents(
    source,
    source.path ? `${source.path.replace(/\/$/, "")}/SKILL.md` : "SKILL.md",
  );
  if (
    Array.isArray(file) ||
    file.type !== "file" ||
    file.encoding !== "base64" ||
    !file.content
  ) {
    throw new Error("无法下载该 Skill 的 SKILL.md。");
  }
  const content = Buffer.from(
    file.content.replace(/\n/g, ""),
    "base64",
  ).toString("utf8");
  if (!content.trim()) throw new Error("该 Skill 的 SKILL.md 为空。");
  return content;
}

async function downloadMarketplaceSkill(
  source: SkillInstallSource,
  targetDir: string,
): Promise<void> {
  if (source.type === "github") {
    await downloadGithubDirectory(parseGithubSkillSource(source), targetDir);
    return;
  }
  if (source.type === "archive") {
    await downloadSkillArchive(source, targetDir);
    return;
  }
  await downloadSkillFiles(source, targetDir);
}

function parseGithubSkillSource(
  source: Extract<SkillInstallSource, { type: "github" }>,
): GithubSkillSource {
  const url = new URL(source.repositoryUrl);
  if (url.protocol !== "https:" || url.hostname !== "github.com") {
    throw new Error("该 Skill 使用了不支持的 GitHub 来源。");
  }
  const segments = url.pathname.split("/").filter(Boolean);
  const [owner, repository, tree, urlRef, ...path] = segments;
  if (!owner || !repository) {
    throw new Error("该 Skill 使用了无效的 GitHub 来源。");
  }
  return {
    owner,
    repository,
    ref: source.ref ?? (tree === "tree" ? urlRef : undefined) ?? "HEAD",
    path: source.path ?? (tree === "tree" ? path.join("/") : ""),
  };
}

async function downloadSkillArchive(
  source: Extract<SkillInstallSource, { type: "archive" }>,
  targetDir: string,
): Promise<void> {
  const archive = await requestMarketplaceBinary(source.url, {
    maxBytes: MAX_MARKETPLACE_TOTAL_SIZE_BYTES,
  });
  if (isClawHubGithubHandoff(archive, source.url)) {
    throw new Error(
      "该 Skill 使用 ClawHub 的 GitHub 源交接格式，当前没有可逐文件校验的托管安装包。",
    );
  }
  if (source.sha256) {
    const digest = createHash("sha256").update(archive).digest("hex");
    if (digest !== source.sha256) {
      throw new Error("Skill 安装包校验失败。");
    }
  }
  let declaredFileCount = 0;
  let declaredTotalBytes = 0;
  const entries = unzipSync(archive, {
    filter: (file) => {
      if (file.name.endsWith("/")) return false;
      declaredFileCount += 1;
      declaredTotalBytes += file.originalSize;
      if (file.originalSize > MAX_MARKETPLACE_FILE_SIZE_BYTES) {
        throw new Error("Skill 安装包包含超过大小限制的文件。");
      }
      assertSkillInstallLimits(declaredFileCount, declaredTotalBytes);
      return true;
    },
  });
  const paths = Object.keys(entries);
  const rootPrefix = inferArchiveRootPrefix(paths);
  const manifest = source.verification
    ? new Map(source.verification.files.map((file) => [file.path, file]))
    : undefined;
  const verifiedPaths = new Set<string>();
  let fileCount = 0;
  let totalBytes = 0;
  for (const [archivePath, content] of Object.entries(entries)) {
    const relativePath = removeArchiveRootPrefix(archivePath, rootPrefix);
    if (!relativePath || !isSafeRelativePath(relativePath)) continue;
    if (manifest && relativePath === "_meta.json") continue;
    fileCount += 1;
    totalBytes += content.byteLength;
    assertSkillInstallLimits(fileCount, totalBytes);
    if (manifest) {
      const expected = manifest.get(relativePath);
      if (!expected) {
        throw new Error(`Skill 安装包包含清单外文件：${relativePath}`);
      }
      if (expected.size !== undefined && expected.size !== content.byteLength) {
        throw new Error(`Skill 文件大小校验失败：${relativePath}`);
      }
      const digest = createHash("sha256").update(content).digest("hex");
      if (digest !== expected.sha256) {
        throw new Error(`Skill 文件校验失败：${relativePath}`);
      }
      verifiedPaths.add(relativePath);
    }
    const localPath = safeSkillTargetPath(targetDir, relativePath);
    mkdirSync(dirname(localPath), { recursive: true });
    writeFileSync(localPath, Buffer.from(content));
  }
  if (manifest && verifiedPaths.size !== manifest.size) {
    const missing = [...manifest.keys()].find(
      (path) => !verifiedPaths.has(path),
    );
    throw new Error(`Skill 安装包缺少清单文件：${missing ?? "未知文件"}`);
  }
}

function isClawHubGithubHandoff(content: Buffer, sourceUrl: string): boolean {
  if (!content.subarray(0, 64).toString("utf8").trimStart().startsWith("{")) {
    return false;
  }
  try {
    const url = new URL(sourceUrl);
    if (url.hostname !== "clawhub.ai") return false;
    const payload = JSON.parse(content.toString("utf8")) as {
      sourceRef?: unknown;
    };
    return payload.sourceRef === "public-github";
  } catch {
    return false;
  }
}

async function downloadSkillFiles(
  source: Extract<SkillInstallSource, { type: "files" }>,
  targetDir: string,
): Promise<void> {
  let totalBytes = 0;
  if (source.files.length > MAX_MARKETPLACE_FILE_COUNT) {
    throw new Error(
      "Skill exceeds the marketplace installation safety limits.",
    );
  }
  for (const file of source.files) {
    if (!isSafeRelativePath(file.path)) {
      throw new Error("Skill 文件路径不安全。");
    }
    const content = await requestMarketplaceBinary(file.url, {
      maxBytes: MAX_MARKETPLACE_FILE_SIZE_BYTES,
    });
    if (file.sha256) {
      const digest = createHash("sha256").update(content).digest("hex");
      if (digest !== file.sha256) {
        throw new Error(`Skill 文件校验失败：${file.path}`);
      }
    }
    totalBytes += content.byteLength;
    assertSkillInstallLimits(source.files.length, totalBytes);
    const localPath = safeSkillTargetPath(targetDir, file.path);
    mkdirSync(dirname(localPath), { recursive: true });
    writeFileSync(localPath, content);
  }
}

function inferArchiveRootPrefix(paths: string[]): string | undefined {
  const nonDirectoryPaths = paths.filter((path) => !path.endsWith("/"));
  if (!nonDirectoryPaths.length) return undefined;
  const firstSegment = nonDirectoryPaths[0].split("/")[0];
  if (!firstSegment) return undefined;
  const hasRootSkill = nonDirectoryPaths.some(
    (path) => path === "SKILL.md" || path.startsWith("SKILL.md/"),
  );
  if (hasRootSkill) return undefined;
  const allShareRoot = nonDirectoryPaths.every((path) =>
    path.startsWith(`${firstSegment}/`),
  );
  return allShareRoot ? firstSegment : undefined;
}

function removeArchiveRootPrefix(
  path: string,
  rootPrefix: string | undefined,
): string {
  if (!rootPrefix) return path;
  return path.startsWith(`${rootPrefix}/`)
    ? path.slice(rootPrefix.length + 1)
    : path;
}

function isSafeRelativePath(path: string): boolean {
  if (!path || path.startsWith("/") || path.includes("\\")) return false;
  const parts = path.split("/").filter(Boolean);
  return parts.every((part) => part !== "." && part !== "..");
}

function safeSkillTargetPath(targetDir: string, relativePath: string): string {
  const target = resolve(targetDir, relativePath);
  if (!target.startsWith(`${resolve(targetDir)}${sep}`)) {
    throw new Error("Skill 文件路径不安全。");
  }
  return target;
}

function assertSkillInstallLimits(fileCount: number, totalBytes: number): void {
  if (
    fileCount > MAX_MARKETPLACE_FILE_COUNT ||
    totalBytes > MAX_MARKETPLACE_TOTAL_SIZE_BYTES
  ) {
    throw new Error(
      "Skill exceeds the marketplace installation safety limits.",
    );
  }
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
  if (source.ref && source.ref !== "HEAD") {
    url.searchParams.set("ref", source.ref);
  }
  const response = await fetch(url, {
    headers: { Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error("Unable to download the Skill directory from GitHub.");
  return (await response.json()) as GithubContentEntry[] | GithubContentEntry;
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
  return `marketplace-${skillId
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .slice(0, 120)}`;
}

function isMarketplaceSkillInstalled(skillId: string): boolean {
  return ["marketplace", "skillsmp"].some((prefix) =>
    existsSync(
      join(
        getUserSkillsDir(),
        `${prefix}-${normaliseMarketplaceSlug(skillId)}`,
      ),
    ),
  );
}

function normaliseMarketplaceSlug(skillId: string): string {
  return skillId.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 120);
}

function assertMarketplaceInstallAllowed(detail: SkillMarketplaceDetail): void {
  const policy = getSkillRuntimePolicy();
  if (policy.requireSignature && !hasVerifiedMarketplaceArtifact(detail)) {
    throw new Error("当前环境仅允许安装经受信任市场清单校验的 Skill。");
  }
}

function hasVerifiedMarketplaceArtifact(
  detail: SkillMarketplaceDetail,
): boolean {
  const verification =
    detail.install?.type === "archive"
      ? detail.install.verification
      : undefined;
  return Boolean(
    verification?.kind === "sha256-manifest" &&
    verification.registry === "clawhub.ai" &&
    verification.status === "clean" &&
    verification.files.length > 0,
  );
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

function listLocalSkillDetailFiles(rootDir: string): SkillDetailFile[] {
  const root = resolve(rootDir);
  const queue = [root];
  const files: SkillDetailFile[] = [];
  while (queue.length && files.length < MAX_MARKETPLACE_FILE_COUNT) {
    const current = queue.shift()!;
    let entries: Dirent<string>[];
    try {
      entries = readdirSync(current, {
        withFileTypes: true,
        encoding: "utf8",
      });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (files.length >= MAX_MARKETPLACE_FILE_COUNT) break;
      const absolutePath = resolve(current, entry.name);
      if (!absolutePath.startsWith(`${root}${sep}`)) continue;
      if (entry.isDirectory()) {
        queue.push(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const size = statSync(absolutePath).size;
        const path = relative(root, absolutePath).split(sep).join("/");
        files.push({
          path,
          size,
          content:
            size <= MAX_MARKETPLACE_FILE_SIZE_BYTES &&
            isLocalTextPreviewFile(path)
              ? readFileSync(absolutePath, "utf8")
              : undefined,
        });
      } catch {
        // A file may disappear while the detail dialog is opening.
      }
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function isLocalTextPreviewFile(path: string): boolean {
  return /\.(?:md|mdx|txt|json|ya?ml|toml|ini|js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|sh|bash|zsh|fish|ps1|html?|css|scss|xml)$/i.test(
    path,
  );
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
