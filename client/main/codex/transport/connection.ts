import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { existsSync } from "fs";
import { createRequire } from "module";
import * as path from "path";
import type { Readable, Writable } from "stream";
import { log as clog } from "../../logger";

const require = createRequire(import.meta.url);

export interface CodexTransportOptions {
  binaryPath: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  pathDirs?: string[];
  onStderr?: (chunk: string) => void;
  args?: string[];
}

export interface CodexTransport {
  start(): Promise<void>;
  stop(): Promise<void>;
  isAlive(): boolean;
  readonly stdin: Writable;
  readonly stdout: Readable;
  onNotification(handler: (method: string, params: unknown) => void): void;
  onServerRequest(
    handler: (id: string | number, method: string, params: unknown) => void,
  ): void;
  onResponse(handler: (msg: unknown) => void): void;
}

export interface CodexBinaryResolution {
  binaryPath: string;
  pathDirs: string[];
}

function getCodexTargetTriple(): string | null {
  if (process.platform === "win32" && process.arch === "x64")
    return "x86_64-pc-windows-msvc";
  if (process.platform === "win32" && process.arch === "arm64")
    return "aarch64-pc-windows-msvc";
  if (process.platform === "darwin" && process.arch === "x64")
    return "x86_64-apple-darwin";
  if (process.platform === "darwin" && process.arch === "arm64")
    return "aarch64-apple-darwin";
  if (
    (process.platform === "linux" || process.platform === "android") &&
    process.arch === "x64"
  ) {
    return "x86_64-unknown-linux-musl";
  }
  if (
    (process.platform === "linux" || process.platform === "android") &&
    process.arch === "arm64"
  ) {
    return "aarch64-unknown-linux-musl";
  }
  return null;
}

function getCodexPlatformPackageName(): string | null {
  if (process.platform === "win32" && process.arch === "x64")
    return "codex-win32-x64";
  if (process.platform === "win32" && process.arch === "arm64")
    return "codex-win32-arm64";
  if (process.platform === "darwin" && process.arch === "x64")
    return "codex-darwin-x64";
  if (process.platform === "darwin" && process.arch === "arm64")
    return "codex-darwin-arm64";
  if (
    (process.platform === "linux" || process.platform === "android") &&
    process.arch === "x64"
  ) {
    return "codex-linux-x64";
  }
  if (
    (process.platform === "linux" || process.platform === "android") &&
    process.arch === "arm64"
  ) {
    return "codex-linux-arm64";
  }
  return null;
}

function getPathSeparator(): string {
  return process.platform === "win32" ? ";" : ":";
}

function withAdditionalPathDirs(
  env: NodeJS.ProcessEnv,
  pathDirs: string[],
): NodeJS.ProcessEnv {
  if (pathDirs.length === 0) return env;
  return {
    ...env,
    PATH: [...pathDirs, env.PATH || ""]
      .filter(Boolean)
      .join(getPathSeparator()),
  };
}

function getCodexBinaryName(): string {
  return process.platform === "win32" ? "codex.exe" : "codex";
}

function buildNativeCodexResolutions(
  vendorRoot: string,
  targetTriple: string,
): CodexBinaryResolution[] {
  const archRoot = path.join(vendorRoot, targetTriple);
  const layouts = [
    {
      binaryPath: path.join(archRoot, "bin", getCodexBinaryName()),
      pathDir: path.join(archRoot, "codex-path"),
    },
    {
      binaryPath: path.join(archRoot, "codex", getCodexBinaryName()),
      pathDir: path.join(archRoot, "path"),
    },
  ];
  return layouts.map(({ binaryPath, pathDir }) => ({
    binaryPath,
    pathDirs: existsSync(pathDir) ? [pathDir] : [],
  }));
}

function tryResolvePackageJson(
  packageName: string,
  paths: string[],
): string | null {
  try {
    return require.resolve(`${packageName}/package.json`, { paths });
  } catch {
    return null;
  }
}

function tryResolveLocalPackageJson(packageName: string): string | null {
  try {
    return require.resolve(`${packageName}/package.json`);
  } catch {
    return null;
  }
}

function tryResolveCodexPlatformPackageJson(
  platformPackageName: string,
): string | null {
  const codexPackageJsonPath =
    tryResolveLocalPackageJson("@openai/codex") ??
    tryResolvePackageJson("@openai/codex", [process.cwd()]);
  if (!codexPackageJsonPath) return null;

  try {
    const codexPackageRequire = createRequire(
      path.join(path.dirname(codexPackageJsonPath), "bin", "codex.js"),
    );
    return codexPackageRequire.resolve(
      `@openai/${platformPackageName}/package.json`,
    );
  } catch {
    return null;
  }
}

export function resolveBundledCodexBinary(): CodexBinaryResolution | null {
  const targetTriple = getCodexTargetTriple();
  const platformPackageName = getCodexPlatformPackageName();
  if (!targetTriple || !platformPackageName) return null;

  const resourceRoots = [
    process.resourcesPath
      ? path.join(process.resourcesPath, "app.asar.unpacked", "node_modules")
      : "",
    process.resourcesPath
      ? path.join(process.resourcesPath, "app.asar", "node_modules")
      : "",
    path.join(process.cwd(), "node_modules"),
  ].filter(Boolean);

  const resolvedPackageCandidates = [
    tryResolveLocalPackageJson(`@openai/${platformPackageName}`),
    tryResolvePackageJson(`@openai/${platformPackageName}`, [process.cwd()]),
    tryResolveCodexPlatformPackageJson(platformPackageName),
    tryResolveLocalPackageJson("@openai/codex"),
    tryResolvePackageJson("@openai/codex", [process.cwd()]),
  ].flatMap((packageJsonPath) => {
    if (!packageJsonPath) return [];
    return buildNativeCodexResolutions(
      path.join(path.dirname(packageJsonPath), "vendor"),
      targetTriple,
    );
  });

  const nativeCandidates = [
    ...resolvedPackageCandidates,
    ...resourceRoots.flatMap((nodeModulesRoot) => [
      ...buildNativeCodexResolutions(
        path.join(nodeModulesRoot, "@openai", platformPackageName, "vendor"),
        targetTriple,
      ),
      ...buildNativeCodexResolutions(
        path.join(
          nodeModulesRoot,
          "@openai",
          "codex",
          "node_modules",
          "@openai",
          platformPackageName,
          "vendor",
        ),
        targetTriple,
      ),
      ...buildNativeCodexResolutions(
        path.join(nodeModulesRoot, "@openai", "codex", "vendor"),
        targetTriple,
      ),
    ]),
  ];

  for (const candidate of nativeCandidates) {
    if (existsSync(candidate.binaryPath)) return candidate;
  }

  const jsCandidates = resourceRoots.map((nodeModulesRoot) => ({
    binaryPath: path.join(
      nodeModulesRoot,
      "@openai",
      "codex",
      "bin",
      "codex.js",
    ),
    pathDirs: [],
  }));

  const candidates = [...nativeCandidates, ...jsCandidates];
  for (const candidate of candidates) {
    if (existsSync(candidate.binaryPath)) return candidate;
  }
  return null;
}

export class CodexTransportImpl implements CodexTransport {
  private child: ChildProcessWithoutNullStreams | null = null;
  private exited = false;
  private notificationHandler:
    ((method: string, params: unknown) => void) | null = null;
  private serverRequestHandler:
    ((id: string | number, method: string, params: unknown) => void) | null =
    null;
  private responseHandler: ((msg: unknown) => void) | null = null;
  private readonly opts: CodexTransportOptions;

  constructor(options: CodexTransportOptions) {
    this.opts = options;
  }

  get stdin(): Writable {
    if (!this.child) throw new Error("Transport not started");
    return this.child.stdin;
  }

  get stdout(): Readable {
    if (!this.child) throw new Error("Transport not started");
    return this.child.stdout;
  }

  isAlive(): boolean {
    return (
      !this.exited &&
      this.child !== null &&
      this.child.exitCode === null &&
      !this.child.killed
    );
  }

  async start(): Promise<void> {
    const {
      binaryPath,
      cwd,
      env,
      pathDirs = [],
      args = ["app-server"],
      onStderr,
    } = this.opts;

    return new Promise((resolve, reject) => {
      let settled = false;
      const startupTimer = setTimeout(() => {
        if (settled) return;
        if (!this.isAlive()) {
          settled = true;
          reject(new Error("Codex app-server exited during startup"));
          return;
        }
        settled = true;
        resolve();
      }, 1500);
      const isNodeEntrypoint = path.extname(binaryPath).toLowerCase() === ".js";
      const command = isNodeEntrypoint ? "node" : binaryPath;
      const commandArgs = isNodeEntrypoint ? [binaryPath, ...args] : args;

      this.child = spawn(command, commandArgs, {
        cwd,
        env: withAdditionalPathDirs(env, pathDirs),
        stdio: ["pipe", "pipe", "pipe"],
      });

      this.child.stderr?.on("data", (chunk: Buffer) => {
        clog("[codex-stderr]", chunk.toString().trim());
        onStderr?.(chunk.toString());
      });

      this.child.on("error", (err) => {
        clog("[codex-error]", err.message);
        if (!settled) {
          settled = true;
          clearTimeout(startupTimer);
          reject(err);
        }
      });

      this.child.on("close", (code) => {
        clog("[codex-exit]", code);
        this.exited = true;
        if (!settled) {
          settled = true;
          clearTimeout(startupTimer);
          reject(
            new Error(
              `Codex app-server exited during startup (code ${code ?? "unknown"})`,
            ),
          );
        }
      });

      // Handle stdout line-by-line for JSON-RPC
      let buffer = "";
      this.child!.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const msg = JSON.parse(trimmed);
            clog("[codex-stdout]", trimmed.slice(0, 200));
            if (
              msg.method &&
              (typeof msg.id === "string" || typeof msg.id === "number")
            ) {
              this.serverRequestHandler?.(msg.id, msg.method, msg.params);
            } else if (msg.method) {
              this.notificationHandler?.(msg.method, msg.params);
            } else if (
              typeof msg.id === "number" &&
              msg.id !== 0 &&
              ("result" in msg || "error" in msg)
            ) {
              // Response to a client request
              this.responseHandler?.(msg);
            }
          } catch {
            // Non-JSON output (e.g. startup messages) — ignore
          }
        }
      });
    });
  }

  async stop(): Promise<void> {
    if (this.child && !this.exited) {
      this.child.kill();
      await new Promise((resolve) => {
        this.child!.on("close", resolve);
        setTimeout(resolve, 2000);
      });
    }
  }

  onNotification(handler: (method: string, params: unknown) => void): void {
    this.notificationHandler = handler;
  }

  onServerRequest(
    handler: (id: string | number, method: string, params: unknown) => void,
  ): void {
    this.serverRequestHandler = handler;
  }

  onResponse(handler: (msg: unknown) => void): void {
    this.responseHandler = handler;
  }
}

export function createCodexTransport(
  options: CodexTransportOptions,
): CodexTransport {
  return new CodexTransportImpl(options);
}
