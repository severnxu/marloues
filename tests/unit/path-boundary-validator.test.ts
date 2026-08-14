import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isPathWithinRoot,
  validatePathBoundary,
} from "../../client/main/core/permissions/path-boundary-validator";

const cleanupFiles: string[] = [];
const cleanupDirectories: string[] = [];

afterEach(() => {
  for (const filePath of cleanupFiles.splice(0).reverse()) {
    try {
      lstatSync(filePath);
      unlinkSync(filePath);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
  for (const directoryPath of cleanupDirectories.splice(0).reverse()) {
    try {
      rmdirSync(directoryPath);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
});

describe("validatePathBoundary lexical containment", () => {
  it("handles POSIX relative and absolute paths without prefix confusion", () => {
    const options = { flavor: "posix" as const, checkSymlinks: false };

    expect(
      validatePathBoundary("src/index.ts", "/workspace/app", options).allowed,
    ).toBe(true);
    expect(
      validatePathBoundary("src/../README.md", "/workspace/app", options)
        .allowed,
    ).toBe(true);
    expect(
      validatePathBoundary("../secret.txt", "/workspace/app", options).failure,
    ).toBe("outside_workspace");
    expect(
      validatePathBoundary(
        "/workspace/application/file",
        "/workspace/app",
        options,
      ).failure,
    ).toBe("outside_workspace");
    expect(
      validatePathBoundary("/etc/passwd", "/workspace/app", options).failure,
    ).toBe("outside_workspace");
  });

  it("handles Windows drives, case folding, UNC shares, and sibling prefixes", () => {
    const options = { flavor: "win32" as const, checkSymlinks: false };

    expect(
      validatePathBoundary("src\\index.ts", "C:\\Workspace\\App", options)
        .allowed,
    ).toBe(true);
    expect(
      validatePathBoundary(
        "c:\\workspace\\app\\README.md",
        "C:\\Workspace\\App",
        options,
      ).allowed,
    ).toBe(true);
    expect(
      validatePathBoundary("..\\secret.txt", "C:\\Workspace\\App", options)
        .failure,
    ).toBe("outside_workspace");
    expect(
      validatePathBoundary("D:\\secret.txt", "C:\\Workspace\\App", options)
        .failure,
    ).toBe("outside_workspace");
    expect(
      validatePathBoundary(
        "C:\\Workspace\\Application\\x",
        "C:\\Workspace\\App",
        options,
      ).failure,
    ).toBe("outside_workspace");
    expect(
      validatePathBoundary("docs\\a.md", "\\\\server\\share\\app", options)
        .allowed,
    ).toBe(true);
    expect(
      validatePathBoundary(
        "\\\\server\\other\\a.md",
        "\\\\server\\share\\app",
        options,
      ).failure,
    ).toBe("outside_workspace");
  });

  it("rejects ambiguous or alias-prone Windows path forms", () => {
    const options = { flavor: "win32" as const, checkSymlinks: false };

    expect(
      validatePathBoundary("C:relative.txt", "C:\\Workspace", options).failure,
    ).toBe("invalid_path");
    expect(
      validatePathBoundary("\\Windows\\file", "C:\\Workspace", options).failure,
    ).toBe("invalid_path");
    expect(
      validatePathBoundary("file.txt:stream", "C:\\Workspace", options).failure,
    ).toBe("invalid_path");
    expect(
      validatePathBoundary("folder.\\file", "C:\\Workspace", options).failure,
    ).toBe("invalid_path");
    expect(
      validatePathBoundary(
        "\\\\?\\C:\\Workspace\\file",
        "C:\\Workspace",
        options,
      ).failure,
    ).toBe("invalid_path");
  });

  it("exposes a side-effect-free containment helper", () => {
    expect(isPathWithinRoot("src/a.ts", "/workspace/app", "posix")).toBe(true);
    expect(isPathWithinRoot("../../a.ts", "/workspace/app", "posix")).toBe(
      false,
    );
    expect(
      isPathWithinRoot("c:\\WORK\\app\\a.ts", "C:\\work\\app", "win32"),
    ).toBe(true);
  });
});

describe("validatePathBoundary native real-path checks", () => {
  it("allows existing and not-yet-created paths inside an existing workspace", () => {
    const root = createTemporaryDirectory("marloues-path-root-");
    const existing = join(root, "existing.txt");
    writeFileSync(existing, "ok");
    cleanupFiles.push(existing);

    const existingResult = validatePathBoundary(existing, root);
    const newResult = validatePathBoundary(
      join(root, "new", "nested.txt"),
      root,
    );

    expect(existingResult).toMatchObject({
      allowed: true,
      symlinksChecked: true,
    });
    expect(newResult).toMatchObject({ allowed: true, symlinksChecked: true });
  });

  it("classifies an ordinary lexical escape separately from a symlink escape", () => {
    const root = createTemporaryDirectory("marloues-path-root-");
    const outside = createTemporaryDirectory("marloues-path-outside-");

    expect(validatePathBoundary(join(outside, "file.txt"), root).failure).toBe(
      "outside_workspace",
    );
  });

  it("rejects a symlinked directory that redirects a future file outside", () => {
    const root = createTemporaryDirectory("marloues-path-root-");
    const outside = createTemporaryDirectory("marloues-path-outside-");
    const link = join(root, "redirect");
    symlinkSync(
      outside,
      link,
      process.platform === "win32" ? "junction" : "dir",
    );
    cleanupFiles.push(link);

    const result = validatePathBoundary(join(link, "future.txt"), root);

    expect(result.allowed).toBe(false);
    expect(result.failure).toBe("symlink_escape");
    expect(result.symlinksChecked).toBe(true);
  });

  it("allows a symlink that resolves to a directory inside the workspace", () => {
    const root = createTemporaryDirectory("marloues-path-root-");
    const realDirectory = join(root, "real");
    mkdirSync(realDirectory);
    cleanupDirectories.push(realDirectory);
    const link = join(root, "inside-link");
    symlinkSync(
      realDirectory,
      link,
      process.platform === "win32" ? "junction" : "dir",
    );
    cleanupFiles.push(link);

    const result = validatePathBoundary(join(link, "future.txt"), root);

    expect(result.allowed).toBe(true);
    expect(result.resolvedPath).toBe(
      join(realpathSync.native(realDirectory), "future.txt"),
    );
  });

  it("fails closed when the workspace root cannot be resolved", () => {
    const parent = createTemporaryDirectory("marloues-path-parent-");
    const result = validatePathBoundary(
      "file.txt",
      join(parent, "missing-root"),
    );

    expect(result.allowed).toBe(false);
    expect(result.failure).toBe("unresolvable_workspace");
  });
});

function createTemporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  cleanupDirectories.push(directory);
  return directory;
}

function isMissing(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
