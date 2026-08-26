import { lstatSync, realpathSync, statSync } from "node:fs";
import path, { posix, win32, type PlatformPath } from "node:path";

export type PathFlavor = "native" | "posix" | "win32";

export type PathBoundaryFailure =
  | "invalid_path"
  | "outside_workspace"
  | "symlink_escape"
  | "unresolvable_workspace";

export interface PathBoundaryOptions {
  /** Selects lexical path semantics. Runtime callers should use the native default. */
  flavor?: PathFlavor;
  /**
   * Resolve the nearest existing ancestor to prevent symlink escapes. Enabled by
   * default. Disable only for platform-independent lexical policy tests.
   */
  checkSymlinks?: boolean;
}

export interface PathBoundaryResult {
  allowed: boolean;
  failure?: PathBoundaryFailure;
  reason?: string;
  resolvedPath?: string;
  resolvedWorkspaceRoot?: string;
  symlinksChecked: boolean;
}

interface RealPathResolution {
  ok: boolean;
  resolvedPath?: string;
  reason?: string;
}

/**
 * Validates a file target against a writable workspace root. It checks both the
 * lexical path and, on the native filesystem, the real path of the nearest
 * existing ancestor so a workspace symlink cannot redirect writes outside.
 */
export function validatePathBoundary(
  filePath: string,
  workspaceRoot: string,
  options: PathBoundaryOptions = {},
): PathBoundaryResult {
  const flavor = options.flavor ?? "native";
  const pathApi = pathForFlavor(flavor);
  const checkSymlinks = options.checkSymlinks ?? true;

  const invalidInput = validateInput(filePath, workspaceRoot, flavor);
  if (invalidInput) return denied("invalid_path", invalidInput, false);

  const foreignRoot = foreignAbsoluteRoot(filePath, flavor);
  if (foreignRoot) return denied("outside_workspace", foreignRoot, false);

  let lexicalRoot: string;
  let lexicalTarget: string;
  try {
    lexicalRoot = pathApi.resolve(workspaceRoot);
    lexicalTarget = pathApi.isAbsolute(filePath)
      ? pathApi.normalize(filePath)
      : pathApi.resolve(lexicalRoot, filePath);
  } catch {
    return denied("invalid_path", "Path normalization failed.", false);
  }

  if (!isWithinRoot(lexicalTarget, lexicalRoot, pathApi)) {
    return {
      ...denied(
        "outside_workspace",
        "Target path escapes the workspace root.",
        false,
      ),
      resolvedPath: lexicalTarget,
      resolvedWorkspaceRoot: lexicalRoot,
    };
  }

  if (!checkSymlinks) {
    return {
      allowed: true,
      resolvedPath: lexicalTarget,
      resolvedWorkspaceRoot: lexicalRoot,
      symlinksChecked: false,
    };
  }

  if (!canResolveFlavorOnHost(flavor)) {
    return denied(
      "invalid_path",
      `Cannot resolve ${flavor} symlinks on the current host; use native paths at runtime.`,
      false,
    );
  }

  let realRoot: string;
  try {
    realRoot = realpathSync.native(lexicalRoot);
    if (!statSync(realRoot).isDirectory()) {
      return denied(
        "unresolvable_workspace",
        "Workspace root is not a directory.",
        true,
      );
    }
  } catch {
    return denied(
      "unresolvable_workspace",
      "Workspace root cannot be resolved.",
      true,
    );
  }

  const targetResolution = resolveNearestExistingAncestor(
    lexicalTarget,
    pathApi,
  );
  if (!targetResolution.ok || !targetResolution.resolvedPath) {
    return denied(
      "invalid_path",
      targetResolution.reason ?? "Target path cannot be resolved safely.",
      true,
    );
  }

  if (!isWithinRoot(targetResolution.resolvedPath, realRoot, pathApi)) {
    return {
      ...denied(
        "symlink_escape",
        "Target resolves outside the workspace through a symlink.",
        true,
      ),
      resolvedPath: targetResolution.resolvedPath,
      resolvedWorkspaceRoot: realRoot,
    };
  }

  return {
    allowed: true,
    resolvedPath: targetResolution.resolvedPath,
    resolvedWorkspaceRoot: realRoot,
    symlinksChecked: true,
  };
}

export function isPathWithinRoot(
  filePath: string,
  workspaceRoot: string,
  flavor: PathFlavor = "native",
): boolean {
  if (validateInput(filePath, workspaceRoot, flavor)) return false;
  const pathApi = pathForFlavor(flavor);
  const root = pathApi.resolve(workspaceRoot);
  const target = pathApi.isAbsolute(filePath)
    ? pathApi.normalize(filePath)
    : pathApi.resolve(root, filePath);
  return isWithinRoot(target, root, pathApi);
}

function validateInput(
  filePath: string,
  workspaceRoot: string,
  flavor: PathFlavor,
): string | null {
  if (typeof filePath !== "string" || !filePath.trim())
    return "Target path is empty.";
  if (typeof workspaceRoot !== "string" || !workspaceRoot.trim()) {
    return "Workspace root is empty.";
  }
  if (filePath.includes("\0") || workspaceRoot.includes("\0")) {
    return "Paths cannot contain NUL bytes.";
  }

  const windowsSemantics =
    flavor === "win32" || (flavor === "native" && process.platform === "win32");
  if (windowsSemantics) {
    const targetFailure = validateWindowsPathSyntax(filePath, false);
    if (targetFailure) return targetFailure;
    const rootFailure = validateWindowsPathSyntax(workspaceRoot, true);
    if (rootFailure) return rootFailure;
  }
  return null;
}

function validateWindowsPathSyntax(
  value: string,
  workspaceRoot: boolean,
): string | null {
  if (
    value.startsWith("\\\\?\\") ||
    value.startsWith("\\\\.\\") ||
    value.startsWith("\\??\\")
  ) {
    return "Windows device and extended-length path namespaces are not accepted.";
  }
  if (/^[A-Za-z]:($|[^\\/])/.test(value)) {
    return "Drive-relative Windows paths are ambiguous and are not accepted.";
  }
  if (!workspaceRoot && /^[\\/](?![\\/])/.test(value)) {
    return "Drive-rooted Windows paths must include an explicit drive letter.";
  }

  const withoutDrive = value.replace(/^[A-Za-z]:/, "");
  if (withoutDrive.includes(":"))
    return "Windows alternate data stream paths are not accepted.";

  const segments = withoutDrive.split(/[\\/]/).filter(Boolean);
  if (
    segments.some(
      (segment) => ![".", ".."].includes(segment) && /[. ]$/.test(segment),
    )
  ) {
    return "Windows path segments cannot end in a dot or space.";
  }
  return null;
}

function resolveNearestExistingAncestor(
  absolutePath: string,
  pathApi: PlatformPath,
): RealPathResolution {
  const tail: string[] = [];
  let current = absolutePath;

  for (let depth = 0; depth < 256; depth += 1) {
    try {
      lstatSync(current);
      try {
        const realBase = realpathSync.native(current);
        return {
          ok: true,
          resolvedPath: tail.length
            ? pathApi.join(realBase, ...tail)
            : realBase,
        };
      } catch {
        return {
          ok: false,
          reason: "An existing path component cannot be resolved.",
        };
      }
    } catch (error) {
      if (!isMissingPathError(error)) {
        return { ok: false, reason: "A path component cannot be inspected." };
      }
      const parent = pathApi.dirname(current);
      if (parent === current) {
        return {
          ok: false,
          reason: "No existing path ancestor could be resolved.",
        };
      }
      tail.unshift(pathApi.basename(current));
      current = parent;
    }
  }

  return { ok: false, reason: "Path nesting exceeds the safety limit." };
}

function isMissingPathError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  const code = (error as { code?: unknown }).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

function isWithinRoot(
  target: string,
  root: string,
  pathApi: PlatformPath,
): boolean {
  const relativePath = pathApi.relative(root, target);
  return (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${pathApi.sep}`) &&
      !pathApi.isAbsolute(relativePath))
  );
}

function pathForFlavor(flavor: PathFlavor): PlatformPath {
  if (flavor === "posix") return posix;
  if (flavor === "win32") return win32;
  return path;
}

function canResolveFlavorOnHost(flavor: PathFlavor): boolean {
  if (flavor === "native") return true;
  return flavor === "win32"
    ? process.platform === "win32"
    : process.platform !== "win32";
}

/**
 * Detects absolute paths rooted in a foreign platform's namespace, such as a
 * Windows drive path on a POSIX host. The native path API treats these as
 * relative, so without this guard they would resolve inside the workspace and
 * mask an out-of-workspace write.
 */
function foreignAbsoluteRoot(
  filePath: string,
  flavor: PathFlavor,
): string | null {
  if (flavor !== "native") return null;
  if (process.platform === "win32") {
    if (/^\/[^/]/.test(filePath) && !/^[A-Za-z]:[\\/]/.test(filePath)) {
      return "Target path is rooted outside the native workspace root.";
    }
    return null;
  }
  if (/^[A-Za-z]:[\\/]/.test(filePath) || /^\\\\[^\\]/.test(filePath)) {
    return "Target path is rooted outside the native workspace root.";
  }
  return null;
}

function denied(
  failure: PathBoundaryFailure,
  reason: string,
  symlinksChecked: boolean,
): PathBoundaryResult {
  return { allowed: false, failure, reason, symlinksChecked };
}
