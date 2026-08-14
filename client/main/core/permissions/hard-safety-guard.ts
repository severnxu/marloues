import { posix, win32, type PlatformPath } from "node:path";
import {
  analyzeShellCommand,
  type ShellCommandAnalysis,
  type ShellRiskCode,
  type ShellRiskHint,
} from "./shell-command-parser";

export type FileMutationAction = "chmod" | "copy" | "delete" | "move" | "write";

export type HardSafetyOperation =
  | {
      kind: "command";
      command: string;
    }
  | {
      kind: "file";
      action: FileMutationAction;
      path: string;
      destinationPath?: string;
      workspaceRoot?: string;
    };

export type HardSafetyFailure =
  | ShellRiskCode
  | "filesystem_root_mutation"
  | "fork_bomb"
  | "invalid_operation"
  | "sensitive_path"
  | "workspace_root_mutation";

export interface HardSafetyResult {
  allowed: boolean;
  failure?: HardSafetyFailure;
  reason?: string;
  commandIndex?: number;
  analysis?: ShellCommandAnalysis;
}

const HARD_DENY_COMMAND_RISKS = new Set<ShellRiskCode>([
  "destructive_repository_operation",
  "disk_overwrite",
  "power_control",
  "privilege_escalation",
  "remote_code_execution",
  "root_delete",
  "system_configuration",
  "system_path_modification",
]);

const FORK_BOMB_RE = /:\(\)\s*\{\s*:\|:&\s*\}\s*;\s*:/;
const INLINE_REMOTE_EXECUTION_RE =
  /\b(?:bash|cmd|powershell|pwsh|sh|zsh)(?:\.exe)?\b[^\r\n]*\s(?:-c|-command)\s+['"][^'"]*(?:curl|wget|invoke-webrequest|invoke-restmethod|\biwr\b|\birm\b)[^'"]*\|\s*(?:bash|cmd|iex|invoke-expression|powershell|pwsh|sh|zsh)(?:\.exe)?\b[^'"]*['"]/i;
const POWERSHELL_EXPRESSION_DOWNLOAD_RE =
  /\b(?:iex|invoke-expression)\b\s*\(?[^\r\n]*(?:invoke-webrequest|invoke-restmethod|\biwr\b|\birm\b)/i;

/**
 * Evaluates invariants that must not be bypassed by permission modes, saved
 * grants, or session allowlists. A denied result is terminal.
 */
export function checkHardSafety(
  operation: HardSafetyOperation,
): HardSafetyResult {
  if (operation.kind === "command") return checkCommand(operation.command);
  return checkFileMutation(operation);
}

function checkCommand(command: string): HardSafetyResult {
  if (
    typeof command !== "string" ||
    !command.trim() ||
    command.includes("\0")
  ) {
    return deny(
      "invalid_operation",
      "Command is empty or contains invalid bytes.",
    );
  }

  const analysis = analyzeShellCommand(command);
  const risk = selectHardDenyRisk(analysis.riskHints);
  if (risk) {
    return {
      allowed: false,
      failure: risk.code,
      reason: risk.reason,
      commandIndex: risk.commandIndex,
      analysis,
    };
  }

  if (FORK_BOMB_RE.test(command)) {
    return {
      ...deny("fork_bomb", "Command contains a process-exhaustion fork bomb."),
      analysis,
    };
  }
  if (
    INLINE_REMOTE_EXECUTION_RE.test(command) ||
    POWERSHELL_EXPRESSION_DOWNLOAD_RE.test(command)
  ) {
    return {
      ...deny(
        "remote_code_execution",
        "Command downloads content for immediate shell evaluation.",
      ),
      analysis,
    };
  }

  return { allowed: true, analysis };
}

function checkFileMutation(
  operation: Extract<HardSafetyOperation, { kind: "file" }>,
): HardSafetyResult {
  const targets = [operation.path, operation.destinationPath].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  if (
    !targets.length ||
    targets.some((target) => !target.trim() || target.includes("\0"))
  ) {
    return deny("invalid_operation", "File mutation is missing a valid path.");
  }

  for (const target of targets) {
    if (isFilesystemRoot(target)) {
      return deny(
        "filesystem_root_mutation",
        `File mutation targets a filesystem root: ${target}`,
      );
    }
    if (isProtectedSystemPath(target)) {
      return deny(
        "system_path_modification",
        `File mutation targets an operating-system path: ${target}`,
      );
    }
    if (isSensitiveCredentialPath(target)) {
      return deny(
        "sensitive_path",
        `File mutation targets protected credentials or configuration: ${target}`,
      );
    }
    if (
      operation.workspaceRoot &&
      operation.action !== "copy" &&
      pathsEqual(target, operation.workspaceRoot, operation.workspaceRoot)
    ) {
      return deny(
        "workspace_root_mutation",
        "File mutation targets the workspace root itself.",
      );
    }
  }

  return { allowed: true };
}

function selectHardDenyRisk(risks: ShellRiskHint[]): ShellRiskHint | undefined {
  const priority: ShellRiskCode[] = [
    "disk_overwrite",
    "root_delete",
    "system_path_modification",
    "system_configuration",
    "privilege_escalation",
    "remote_code_execution",
    "power_control",
    "destructive_repository_operation",
  ];
  for (const code of priority) {
    const risk = risks.find(
      (candidate) =>
        candidate.code === code && HARD_DENY_COMMAND_RISKS.has(code),
    );
    if (risk) return risk;
  }
  return undefined;
}

function isFilesystemRoot(value: string): boolean {
  const target = stripQuotes(value.trim());
  return (
    target === "/" ||
    /^[A-Za-z]:[\\/]?$/.test(target) ||
    /^\\\\[^\\]+\\[^\\]+[\\/]?$/.test(target)
  );
}

function isProtectedSystemPath(value: string): boolean {
  const normalized = stripQuotes(value.trim()).replace(/\\/g, "/");
  return (
    /^\/(?:bin|boot|dev|etc|lib(?:64)?|proc|sbin|sys|usr)(?:\/|$)/i.test(
      normalized,
    ) ||
    /^\/(?:Library|System)(?:\/|$)/.test(normalized) ||
    /^\/(?:private\/etc|var\/lib)(?:\/|$)/i.test(normalized) ||
    /^[A-Za-z]:\/(?:\$Recycle\.Bin|PerfLogs|Program Files(?: \(x86\))?|ProgramData|Recovery|System Volume Information|Windows)(?:\/|$)/i.test(
      normalized,
    )
  );
}

function isSensitiveCredentialPath(value: string): boolean {
  const normalized = stripQuotes(value.trim()).replace(/\\/g, "/");
  const lower = normalized.toLowerCase();

  if (/\.env\.(?:defaults|example|sample|template)$/i.test(normalized))
    return false;
  if (/\/(?:id_dsa|id_ecdsa|id_ed25519|id_rsa)\.pub$/i.test(normalized))
    return false;

  return (
    /(^|\/)\.ssh(?:\/|$)/.test(lower) ||
    /(^|\/)\.aws(?:\/|$)/.test(lower) ||
    /(^|\/)\.azure(?:\/|$)/.test(lower) ||
    /(^|\/)\.gnupg(?:\/|$)/.test(lower) ||
    /(^|\/)\.kube\/config$/.test(lower) ||
    /(^|\/)\.netrc$/.test(lower) ||
    /(^|\/)\.env(?:\.|$)/.test(lower) ||
    /(^|\/)\.envrc$/.test(lower) ||
    /(^|\/)\.git\/(?:config|hooks)(?:\/|$)/.test(lower) ||
    /(^|\/)\.config\/gcloud\/(?:application_default_credentials\.json|credentials\.db)$/.test(
      lower,
    )
  );
}

function pathsEqual(
  target: string,
  workspaceRoot: string,
  relativeBase: string,
): boolean {
  const pathApi = selectPathApi(target, workspaceRoot);
  const root = pathApi.resolve(workspaceRoot);
  const resolvedTarget = pathApi.isAbsolute(target)
    ? pathApi.normalize(target)
    : pathApi.resolve(relativeBase, target);
  if (pathApi === win32)
    return resolvedTarget.toLowerCase() === root.toLowerCase();
  return resolvedTarget === root;
}

function selectPathApi(first: string, second: string): PlatformPath {
  if (
    /^[A-Za-z]:[\\/]/.test(first) ||
    /^[A-Za-z]:[\\/]/.test(second) ||
    first.startsWith("\\\\")
  ) {
    return win32;
  }
  return posix;
}

function stripQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/g, "");
}

function deny(failure: HardSafetyFailure, reason: string): HardSafetyResult {
  return { allowed: false, failure, reason };
}
