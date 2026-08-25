import { spawn } from "node:child_process";
import path from "node:path";
import {
  resolveBundledCodexBinary,
  type CodexBinaryResolution,
} from "../../codex/transport/connection";
import {
  codexWorkspaceFilesystemConfig,
  type SandboxProfile,
  type SecurityPermit,
} from "./sandbox-broker";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_CAPTURE_BYTES = 1024 * 1024;
const SENSITIVE_ENV_NAME =
  /(api.?key|auth|bearer|cookie|credential|password|private.?key|secret|session|token)/i;
const BLOCKED_ENV_NAMES = new Set([
  "CLAUDE_CONFIG_DIR",
  "CODEX_HOME",
  "ELECTRON_RUN_AS_NODE",
  "NODE_OPTIONS",
]);
const NETWORK_PROXY_ENV_NAMES = new Set([
  "ALL_PROXY",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
]);

export interface ProcessSandboxRunInput {
  command: string;
  cwd: string;
  permit: SecurityPermit;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export interface ProcessSandboxRunResult {
  backend: "codex-cli" | "direct";
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface ProcessSandboxRunner {
  readonly backend: "codex-cli";
  isAvailable(): boolean;
  run(input: ProcessSandboxRunInput): Promise<ProcessSandboxRunResult>;
}

export class CodexProcessSandboxRunner implements ProcessSandboxRunner {
  readonly backend = "codex-cli" as const;
  private readonly resolution: CodexBinaryResolution | null;

  constructor(options?: { resolution?: CodexBinaryResolution | null }) {
    this.resolution = options?.resolution ?? resolveBundledCodexBinary();
  }

  isAvailable(): boolean {
    return this.resolution !== null;
  }

  async run(input: ProcessSandboxRunInput): Promise<ProcessSandboxRunResult> {
    assertPermit(input.permit, input.cwd);
    const shell = platformShell(input.command);
    const env = sanitizeSandboxEnvironment(
      input.env ?? process.env,
      input.permit.network.mode,
    );
    const timeoutMs = Math.max(1, input.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    if (input.permit.sandboxProfile === "danger-full-access") {
      return runProcess({
        backend: "direct",
        executable: shell.executable,
        args: shell.args,
        cwd: input.cwd,
        env,
        timeoutMs,
      });
    }

    if (!this.resolution) {
      throw new Error(
        "Codex process sandbox is unavailable; refusing to run the command unsandboxed.",
      );
    }

    const sandboxEnv = withPathDirs(env, this.resolution.pathDirs);
    return runProcess({
      backend: "codex-cli",
      executable: this.resolution.binaryPath,
      args: [
        ...codexSandboxArgs(input.permit.sandboxProfile),
        "--",
        shell.executable,
        ...shell.args,
      ],
      cwd: input.cwd,
      env: sandboxEnv,
      timeoutMs,
    });
  }
}

export function codexSandboxArgs(profile: SandboxProfile): string[] {
  const windowsArgs =
    process.platform === "win32" ? ["-c", 'windows.sandbox="unelevated"'] : [];
  if (profile === "read-only") {
    return ["sandbox", "-P", ":read-only", ...windowsArgs];
  }
  if (profile === "workspace-write") {
    return [
      "sandbox",
      "-P",
      "marloues-process",
      "-c",
      `permissions.marloues-process.filesystem=${codexWorkspaceFilesystemConfig()}`,
      ...windowsArgs,
    ];
  }
  if (profile === "workspace-write-network") {
    return [
      "sandbox",
      "-P",
      "marloues-process-network",
      "-c",
      `permissions.marloues-process-network.filesystem=${codexWorkspaceFilesystemConfig()}`,
      "-c",
      "permissions.marloues-process-network.network.enabled=true",
      ...windowsArgs,
    ];
  }
  return [];
}

export function sanitizeSandboxEnvironment(
  source: NodeJS.ProcessEnv,
  networkMode: SecurityPermit["network"]["mode"] = "allow",
): NodeJS.ProcessEnv {
  const output: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue;
    const normalized = name.toUpperCase();
    if (BLOCKED_ENV_NAMES.has(normalized)) continue;
    if (networkMode === "deny" && NETWORK_PROXY_ENV_NAMES.has(normalized)) {
      continue;
    }
    if (SENSITIVE_ENV_NAME.test(normalized)) continue;
    output[name] = value;
  }
  return output;
}

function assertPermit(permit: SecurityPermit, cwd: string): void {
  if (permit.sandboxOwnership.kind !== "managed") {
    throw new Error(
      "Process sandbox runner requires a managed sandbox permit.",
    );
  }
  if (permit.sandboxOwnership.backend !== "codex-cli") {
    throw new Error(
      `Unsupported process sandbox backend: ${permit.sandboxOwnership.backend}`,
    );
  }
  const workspace = permit.fs.read[0];
  if (!workspace || path.resolve(workspace) !== path.resolve(cwd)) {
    throw new Error(
      "Sandbox permit does not match the command working directory.",
    );
  }
}

function platformShell(command: string): {
  executable: string;
  args: string[];
} {
  if (process.platform === "win32") {
    return {
      executable: "powershell.exe",
      args: [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        command,
      ],
    };
  }
  return { executable: "/bin/sh", args: ["-lc", command] };
}

function withPathDirs(
  env: NodeJS.ProcessEnv,
  pathDirs: string[],
): NodeJS.ProcessEnv {
  if (!pathDirs.length) return env;
  const separator = process.platform === "win32" ? ";" : ":";
  const output = { ...env };
  const pathEntries = Object.entries(output).filter(
    ([name]) => name.toUpperCase() === "PATH",
  );
  const inheritedPath = pathEntries[0]?.[1] ?? "";
  for (const [name] of pathEntries) delete output[name];
  output[process.platform === "win32" ? "Path" : "PATH"] = [
    ...pathDirs,
    inheritedPath,
  ]
    .filter(Boolean)
    .join(separator);
  return output;
}

function runProcess(input: {
  backend: ProcessSandboxRunResult["backend"];
  executable: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}): Promise<ProcessSandboxRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.executable, input.args, {
      cwd: input.cwd,
      env: input.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const append = (current: string, chunk: Buffer): string =>
      (current + chunk.toString("utf-8")).slice(-MAX_CAPTURE_BYTES);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    child.once("error", reject);
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, input.timeoutMs);
    child.once("close", (code) => {
      clearTimeout(timeout);
      resolve({
        backend: input.backend,
        exitCode: code ?? 1,
        stdout,
        stderr,
        timedOut,
      });
    });
  });
}
