import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import type { MemoryFileKind, MemoryFileRecord } from "@shared/types";
import { getRuntimeConfigDir } from "../app-paths";
import { getAgentSettings } from "./config-service";

interface MemoryCandidate {
  path: string;
  label: string;
  kind: MemoryFileKind;
  scope: string;
}

const MEMORY_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".json"]);

export async function listMemoryFiles(workspace?: { path?: string; name?: string } | null): Promise<MemoryFileRecord[]> {
  const candidates = await buildMemoryCandidates(workspace);
  const byPath = new Map<string, MemoryCandidate>();
  for (const candidate of candidates) byPath.set(normalizePath(candidate.path), candidate);

  const records = await Promise.all(Array.from(byPath.values()).map(toRecord));
  return records.sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || a.label.localeCompare(b.label));
}

export async function readMemoryFile(fileId: string, workspace?: { path?: string; name?: string } | null): Promise<string> {
  const target = await resolveMemoryFile(fileId, workspace);
  if (!existsSync(target.path)) return "";
  const fileStat = await stat(target.path);
  if (!fileStat.isFile()) throw new Error("Memory path is not a file");
  if (fileStat.size > 512 * 1024) throw new Error("Memory file is too large to edit");
  return readFile(target.path, "utf-8");
}

export async function writeMemoryFile(
  fileId: string,
  content: string,
  workspace?: { path?: string; name?: string } | null,
): Promise<MemoryFileRecord> {
  const target = await resolveMemoryFile(fileId, workspace);
  await mkdir(dirname(target.path), { recursive: true });
  await writeFile(target.path, content, "utf-8");
  return toRecord(target);
}

async function resolveMemoryFile(
  fileId: string,
  workspace?: { path?: string; name?: string } | null,
): Promise<MemoryCandidate> {
  const candidates = await buildMemoryCandidates(workspace);
  const normalizedId = normalizePath(fileId);
  const direct = candidates.find(
    (candidate) => candidate.path === fileId || normalizePath(candidate.path) === normalizedId,
  );
  if (direct) return direct;

  const resolved = resolve(expandHome(fileId));
  const roots = memoryRoots(candidates);
  if (!roots.some((root) => isInside(root.path, resolved))) {
    throw new Error("Memory file is outside the configured memory roots.");
  }
  return {
    path: resolved,
    label: basename(resolved),
    kind: roots.some((root) => root.kind === "auto" && isInside(root.path, resolved)) ? "auto" : "project",
    scope: "Marloues memory",
  };
}

async function buildMemoryCandidates(workspace?: { path?: string; name?: string } | null): Promise<MemoryCandidate[]> {
  const settings = getAgentSettings();
  const candidates: MemoryCandidate[] = [];

  if (workspace?.path) {
    candidates.push(
      {
        path: join(workspace.path, "CLAUDE.md"),
        label: "Project CLAUDE.md",
        kind: "project",
        scope: "Project instruction memory",
      },
      {
        path: join(workspace.path, ".claude", "CLAUDE.md"),
        label: ".claude/CLAUDE.md",
        kind: "project",
        scope: "Project-scoped instruction memory",
      },
      {
        path: join(workspace.path, ".marloues", "memory.md"),
        label: "Project Marloues memory",
        kind: "project",
        scope: workspace.name ?? workspace.path,
      },
    );
  }

  candidates.push({
    path: join(getMemoryConfigDir(settings.runtimeConfigDir), "CLAUDE.md"),
    label: "User CLAUDE.md",
    kind: "local",
    scope: "Loaded for every workspace",
  });

  const autoRoots = await buildAutoMemoryRoots(workspace?.path, settings.autoMemoryDirectory, settings.runtimeConfigDir);
  for (const root of autoRoots) {
    candidates.push(...(await listAutoMemoryCandidates(root)));
  }

  return candidates;
}

async function buildAutoMemoryRoots(
  workspacePath: string | undefined,
  configuredDirectory: string | undefined,
  runtimeConfigDir: string | undefined,
): Promise<string[]> {
  if (configuredDirectory) return [expandHome(configuredDirectory)];
  if (!workspacePath) return [];
  const configDir = getMemoryConfigDir(runtimeConfigDir);
  const candidates = projectKeyCandidates(workspacePath).map((projectKey) => join(configDir, "projects", projectKey, "memory"));
  const discovered = await discoverProjectMemoryRoots(configDir, workspacePath);
  return Array.from(new Set([...candidates, ...discovered].map(normalizeDisplayPath)));
}

function getMemoryConfigDir(runtimeConfigDir: string | undefined): string {
  return runtimeConfigDir?.trim() || getRuntimeConfigDir();
}

function projectKeyCandidates(workspacePath: string): string[] {
  const normalized = resolve(workspacePath);
  const slashOnly = normalized.replace(/\//g, "-");
  const backslashOnly = normalized.replace(/\\/g, "-");
  const dashed = normalized.replace(/[^a-zA-Z0-9]/g, "-").replace(/-+/g, "-");
  const noDriveColon = normalized.replace(/:/g, "").replace(/[\\/]/g, "-").replace(/-+/g, "-");
  return Array.from(new Set([slashOnly, backslashOnly, dashed, noDriveColon].map((item) => item.replace(/^-/, ""))));
}

async function discoverProjectMemoryRoots(configDir: string, workspacePath: string): Promise<string[]> {
  const projectsDir = join(configDir, "projects");
  const entries = await readdir(projectsDir, { withFileTypes: true }).catch(() => []);
  const expectedKeys = new Set(projectKeyCandidates(workspacePath).map(normalizeProjectKey));
  return entries
    .filter((entry) => entry.isDirectory() && expectedKeys.has(normalizeProjectKey(entry.name)))
    .map((entry) => join(projectsDir, entry.name, "memory"));
}

function normalizeProjectKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function listAutoMemoryCandidates(root: string): Promise<MemoryCandidate[]> {
  if (!existsSync(root)) return [];
  const files = await listTextFiles(root, 2, 80);
  return files.map((file) => ({
    path: file,
    label: `Auto memory / ${relativeLabel(root, file)}`,
    kind: "auto",
    scope: root,
  }));
}

async function listTextFiles(root: string, depth: number, limit: number): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string, remainingDepth: number): Promise<void> {
    if (found.length >= limit || remainingDepth < 0) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (found.length >= limit) break;
      const next = join(dir, entry.name);
      if (entry.isDirectory()) await walk(next, remainingDepth - 1);
      else if (MEMORY_EXTENSIONS.has(extname(next).toLowerCase())) found.push(next);
    }
  }
  await walk(root, depth);
  return found;
}

async function toRecord(candidate: MemoryCandidate): Promise<MemoryFileRecord> {
  const fileStat = await stat(candidate.path).catch(() => null);
  return {
    id: normalizePath(candidate.path),
    path: candidate.path,
    label: candidate.label,
    kind: candidate.kind,
    scope: candidate.scope,
    exists: Boolean(fileStat?.isFile()),
    size: fileStat?.isFile() ? fileStat.size : undefined,
    modifiedAt: fileStat?.isFile() ? fileStat.mtimeMs : undefined,
  };
}

function memoryRoots(candidates: MemoryCandidate[]): Array<{ path: string; kind: MemoryFileKind }> {
  const roots = candidates.map((candidate) => ({
    path: candidate.kind === "auto" ? findAutoRoot(candidate.path) : dirname(candidate.path),
    kind: candidate.kind,
  }));
  return Array.from(new Map(roots.map((root) => [normalizePath(root.path), root])).values());
}

function findAutoRoot(filePath: string): string {
  const normalized = normalizePath(filePath);
  const index = normalized.toLowerCase().lastIndexOf("/memory/");
  if (index >= 0) return normalized.slice(0, index + "/memory".length);
  return dirname(filePath);
}

function isInside(root: string, target: string): boolean {
  const relativePath = relative(normalizePath(root), normalizePath(target));
  return !relativePath || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function normalizePath(pathValue: string): string {
  return normalizeDisplayPath(resolve(pathValue)).toLowerCase();
}

function normalizeDisplayPath(pathValue: string): string {
  return pathValue.replace(/\\/g, "/");
}

function expandHome(pathValue: string): string {
  if (pathValue === "~") return homedir();
  if (pathValue.startsWith("~/") || pathValue.startsWith("~\\")) return join(homedir(), pathValue.slice(2));
  return pathValue;
}

function relativeLabel(root: string, filePath: string): string {
  return filePath.slice(root.length).replace(/^[/\\]/, "").replace(/\\/g, "/");
}

function kindRank(kind: MemoryFileKind): number {
  if (kind === "project") return 0;
  if (kind === "local") return 1;
  return 2;
}
