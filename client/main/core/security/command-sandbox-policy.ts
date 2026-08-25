import path from "node:path";
import { validatePathBoundary } from "../permissions/path-boundary-validator";
import {
  analyzeShellCommand,
  type ParsedShellCommand,
  type ShellCommandAnalysis,
} from "../permissions/shell-command-parser";
import type { SandboxProfile } from "./sandbox-broker";

export interface CommandSandboxInput {
  command: string;
  workspaceRoot?: string;
  sandboxProfile: SandboxProfile;
}

export interface CommandSandboxDecision {
  allowed: boolean;
  reason?: string;
  analysis?: ShellCommandAnalysis;
}

const NETWORK_EXECUTABLES = new Set([
  "curl",
  "curl.exe",
  "invoke-restmethod",
  "invoke-webrequest",
  "irm",
  "iwr",
  "wget",
  "wget.exe",
]);

const PACKAGE_MANAGERS = new Set([
  "bun",
  "bun.exe",
  "npm",
  "npm.cmd",
  "pnpm",
  "pnpm.cmd",
  "yarn",
  "yarn.cmd",
  "pip",
  "pip.exe",
  "pip3",
  "pip3.exe",
]);

const SHELL_EXECUTABLES = new Set([
  "bash",
  "bash.exe",
  "cmd",
  "cmd.exe",
  "powershell",
  "powershell.exe",
  "pwsh",
  "pwsh.exe",
  "sh",
  "sh.exe",
  "zsh",
]);

const WRITE_EXECUTABLES = new Set([
  "add-content",
  "copy",
  "copy-item",
  "cp",
  "del",
  "erase",
  "mkdir",
  "move",
  "move-item",
  "mv",
  "new-item",
  "out-file",
  "remove-item",
  "ren",
  "rename-item",
  "ri",
  "rm",
  "rmdir",
  "set-content",
  "tee",
  "touch",
]);

export function enforceCommandSandbox(
  input: CommandSandboxInput,
): CommandSandboxDecision {
  return enforceCommandSandboxInner(input, 0);
}

function enforceCommandSandboxInner(
  input: CommandSandboxInput,
  depth: number,
): CommandSandboxDecision {
  if (input.sandboxProfile === "danger-full-access") return { allowed: true };
  if (!input.workspaceRoot) {
    return {
      allowed: false,
      reason: "Sandboxed command execution requires a workspace root.",
    };
  }

  const analysis = analyzeShellCommand(input.command);
  if (!analysis.ok) {
    return {
      allowed: false,
      reason: `Command cannot be sandboxed safely: ${analysis.error ?? "parse error"}.`,
      analysis,
    };
  }

  if (
    input.sandboxProfile === "read-only" &&
    analysis.redirections.some(
      (item) => item.operator === ">" || item.operator === ">>",
    )
  ) {
    return {
      allowed: false,
      reason: "Read-only sandbox blocks shell output redirection.",
      analysis,
    };
  }

  if (
    input.sandboxProfile === "workspace-write" &&
    analysis.redirections.some(
      (item) => item.operator === ">" || item.operator === ">>",
    )
  ) {
    return {
      allowed: false,
      reason:
        "Workspace-write sandbox cannot prove shell redirection target boundaries; use a file tool instead.",
      analysis,
    };
  }

  for (const parsed of analysis.commands) {
    const commandDecision = enforceParsedCommand({
      parsed,
      workspaceRoot: input.workspaceRoot,
      sandboxProfile: input.sandboxProfile,
      depth,
    });
    if (!commandDecision.allowed) return { ...commandDecision, analysis };
  }

  return { allowed: true, analysis };
}

function enforceParsedCommand(input: {
  parsed: ParsedShellCommand;
  workspaceRoot: string;
  sandboxProfile: SandboxProfile;
  depth: number;
}): CommandSandboxDecision {
  const executable = normalizeExecutable(input.parsed.argv[0] ?? "");
  const args = input.parsed.argv.slice(1);

  const nested = nestedShellCommand(executable, args);
  if (nested) {
    if (input.depth >= 3) {
      return {
        allowed: false,
        reason: "Nested shell command exceeds sandbox inspection depth.",
      };
    }
    return enforceCommandSandboxInner(
      {
        command: nested,
        workspaceRoot: input.workspaceRoot,
        sandboxProfile: input.sandboxProfile,
      },
      input.depth + 1,
    );
  }

  if (
    input.sandboxProfile !== "workspace-write-network" &&
    isNetworkCommand(executable, args)
  ) {
    return {
      allowed: false,
      reason: "Sandbox profile blocks network-capable command execution.",
    };
  }

  const mutation = mutationTargets(executable, args);
  if (!mutation.mutates) return { allowed: true };

  if (input.sandboxProfile === "read-only") {
    return {
      allowed: false,
      reason: `Read-only sandbox blocks mutating command: ${executable}.`,
    };
  }

  if (!mutation.targets.length) {
    return {
      allowed: false,
      reason: `Workspace-write sandbox cannot prove mutation boundaries for: ${executable}.`,
    };
  }

  for (const target of mutation.targets) {
    const result = validatePathBoundary(target, input.workspaceRoot);
    if (!result.allowed) {
      return {
        allowed: false,
        reason:
          result.reason ??
          `Command mutation target escapes the workspace: ${target}`,
      };
    }
  }

  return { allowed: true };
}

function nestedShellCommand(
  executable: string,
  args: string[],
): string | undefined {
  if (!SHELL_EXECUTABLES.has(executable)) return undefined;
  const lower = args.map((arg) => arg.toLowerCase());
  if (executable === "cmd" || executable === "cmd.exe") {
    const index = lower.findIndex((arg) => arg === "/c" || arg === "/k");
    return index >= 0 ? args.slice(index + 1).join(" ") : undefined;
  }
  const index = lower.findIndex(
    (arg) => arg === "-c" || arg === "-command" || arg === "-encodedcommand",
  );
  if (index < 0) return undefined;
  if (lower[index] === "-encodedcommand") {
    return "powershell -EncodedCommand";
  }
  return args[index + 1];
}

function isNetworkCommand(executable: string, args: string[]): boolean {
  if (NETWORK_EXECUTABLES.has(executable)) return true;
  if (executable === "git") {
    return ["clone", "fetch", "pull", "push", "ls-remote"].includes(
      args[0]?.toLowerCase() ?? "",
    );
  }
  if (!PACKAGE_MANAGERS.has(executable)) return false;
  return args.some((arg) =>
    ["add", "ci", "install", "publish", "update", "upgrade"].includes(
      arg.toLowerCase(),
    ),
  );
}

function mutationTargets(
  executable: string,
  args: string[],
): { mutates: boolean; targets: string[] } {
  if (executable === "git") {
    const subcommand = args[0]?.toLowerCase();
    if (
      [
        "add",
        "apply",
        "checkout",
        "commit",
        "merge",
        "rebase",
        "restore",
        "stash",
        "switch",
      ].includes(subcommand ?? "")
    ) {
      return { mutates: true, targets: ["."] };
    }
    return { mutates: false, targets: [] };
  }

  if (!WRITE_EXECUTABLES.has(executable))
    return { mutates: false, targets: [] };

  const positional = pathLikeArgs(args);
  if (
    [
      "copy",
      "copy-item",
      "cp",
      "move",
      "move-item",
      "mv",
      "ren",
      "rename-item",
    ].includes(executable)
  ) {
    return { mutates: true, targets: positional };
  }

  const explicitPath = optionValue(args, [
    "-destination",
    "-filepath",
    "-literalpath",
    "-path",
    "-target",
  ]);
  return {
    mutates: true,
    targets: [...explicitPath, ...positional],
  };
}

function pathLikeArgs(args: string[]): string[] {
  const output: string[] = [];
  const optionsWithValues = new Set([
    "-destination",
    "-encoding",
    "-exclude",
    "-filter",
    "-include",
    "-itemtype",
    "-literalpath",
    "-name",
    "-path",
    "-target",
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const lower = arg.toLowerCase();
    if (!arg || arg === "--") continue;
    if (optionsWithValues.has(lower)) {
      index += 1;
      continue;
    }
    if (arg.startsWith("-") || arg.startsWith("/")) continue;
    output.push(stripQuotes(arg));
  }
  return output;
}

function optionValue(args: string[], names: string[]): string[] {
  const normalized = new Set(names.map((name) => name.toLowerCase()));
  const output: string[] = [];
  for (let index = 0; index < args.length - 1; index += 1) {
    if (normalized.has(args[index].toLowerCase())) {
      output.push(stripQuotes(args[index + 1]));
      index += 1;
    }
  }
  return output;
}

function normalizeExecutable(value: string): string {
  return path.basename(value).toLowerCase();
}

function stripQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/g, "");
}
