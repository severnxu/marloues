import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { DirEntry, FileStat, WorkspaceInfo } from "@shared/types";

const DEFAULT_MAX_PREVIEW_BYTES = 512 * 1024;
const DEFAULT_MAX_DIR_ENTRIES = 500;

export function resolveInWorkspace(workspace: WorkspaceInfo | null | undefined, inputPath: string): string {
  if (!workspace?.path) throw new Error("No workspace selected");
  const root = resolve(workspace.path);
  const candidate = inputPath && inputPath !== "." ? resolve(root, inputPath) : root;
  const rel = relative(root, candidate);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Path escapes workspace");
  }
  return candidate;
}

export async function listWorkspaceDir(
  workspace: WorkspaceInfo | null | undefined,
  dirPath: string,
  options: { maxEntries?: number; hideGit?: boolean } = {},
): Promise<DirEntry[]> {
  const target = resolveInWorkspace(workspace, dirPath || ".");
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_DIR_ENTRIES;
  const entries = await readdir(target, { withFileTypes: true });
  return entries
    .filter((entry) => !(options.hideGit ?? true) || !entry.name.startsWith(".git"))
    .slice(0, maxEntries)
    .map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }));
}

export async function readWorkspaceFile(
  workspace: WorkspaceInfo | null | undefined,
  filePath: string,
  options: { maxBytes?: number } = {},
): Promise<string> {
  const target = resolveInWorkspace(workspace, filePath);
  const file = await stat(target);
  if (!file.isFile()) throw new Error("Path is not a file");
  if (file.size > (options.maxBytes ?? DEFAULT_MAX_PREVIEW_BYTES)) {
    throw new Error("File is too large to preview");
  }
  return readFile(target, "utf-8");
}

export async function statWorkspaceFile(
  workspace: WorkspaceInfo | null | undefined,
  filePath: string,
): Promise<FileStat> {
  const file = await stat(resolveInWorkspace(workspace, filePath));
  return {
    size: file.size,
    modifiedAt: file.mtimeMs,
  };
}
