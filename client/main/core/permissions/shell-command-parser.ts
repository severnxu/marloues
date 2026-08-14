export type ShellChainOperator =
  "&&" | "||" | "|" | "|&" | ";" | "&" | "newline";

export type ShellDynamicSyntax =
  | "command_substitution"
  | "environment_assignment"
  | "glob"
  | "grouping"
  | "variable_expansion";

export type ShellRiskCode =
  | "destructive_repository_operation"
  | "disk_overwrite"
  | "power_control"
  | "privilege_escalation"
  | "recursive_delete"
  | "recursive_permission_change"
  | "remote_code_execution"
  | "root_delete"
  | "system_configuration"
  | "system_path_modification";

export interface ParsedShellCommand {
  raw: string;
  argv: string[];
}

export interface ShellOperatorMatch {
  operator: ShellChainOperator;
  commandIndex: number;
}

export interface ShellRedirectionMatch {
  operator: "<" | "<<" | ">" | ">>";
  commandIndex: number;
}

export interface ShellRiskHint {
  code: ShellRiskCode;
  commandIndex: number;
  reason: string;
}

export interface ShellCommandAnalysis {
  ok: boolean;
  commands: ParsedShellCommand[];
  operators: ShellOperatorMatch[];
  redirections: ShellRedirectionMatch[];
  dynamicSyntax: ShellDynamicSyntax[];
  riskHints: ShellRiskHint[];
  error?:
    "empty_command" | "empty_segment" | "trailing_operator" | "unclosed_quote";
}

const ENV_ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;
const SHELL_NAMES = new Set([
  "ash",
  "bash",
  "cmd",
  "cmd.exe",
  "dash",
  "fish",
  "iex",
  "invoke-expression",
  "powershell",
  "powershell.exe",
  "pwsh",
  "pwsh.exe",
  "sh",
  "zsh",
]);
const DOWNLOAD_NAMES = new Set([
  "curl",
  "curl.exe",
  "invoke-restmethod",
  "invoke-webrequest",
  "irm",
  "iwr",
  "wget",
  "wget.exe",
]);

/**
 * Conservatively tokenizes common POSIX shell, cmd.exe, and PowerShell command
 * lines. It is intentionally not a shell evaluator: dynamic syntax is surfaced
 * to callers and is never expanded.
 */
export function analyzeShellCommand(command: string): ShellCommandAnalysis {
  const commands: ParsedShellCommand[] = [];
  const operators: ShellOperatorMatch[] = [];
  const redirections: ShellRedirectionMatch[] = [];
  const dynamicSyntax = new Set<ShellDynamicSyntax>();

  if (!command.trim()) {
    return {
      ok: false,
      commands,
      operators,
      redirections,
      dynamicSyntax: [],
      riskHints: [],
      error: "empty_command",
    };
  }

  let argv: string[] = [];
  let current = "";
  let hasCurrent = false;
  let quote: "'" | '"' | "`" | null = null;
  let segmentStart = 0;
  let lastOperator: ShellChainOperator | undefined;
  let parseError: ShellCommandAnalysis["error"];

  const pushCurrent = (): void => {
    if (!hasCurrent) return;
    argv.push(current);
    current = "";
    hasCurrent = false;
  };

  const pushSegment = (end: number): boolean => {
    pushCurrent();
    if (!argv.length) return false;
    commands.push({ raw: command.slice(segmentStart, end).trim(), argv });
    argv = [];
    return true;
  };

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    const next = command[index + 1];

    if (quote) {
      if (char === quote) {
        quote = null;
        hasCurrent = true;
        continue;
      }
      if (quote === "`") {
        dynamicSyntax.add("command_substitution");
      } else if (quote === '"') {
        recordDynamicSyntax(command, index, dynamicSyntax, false);
      }
      if (
        char === "\\" &&
        quote === '"' &&
        next &&
        ['"', "\\", "$", "`"].includes(next)
      ) {
        current += next;
        hasCurrent = true;
        index += 1;
        continue;
      }
      current += char;
      hasCurrent = true;
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      if (char === "`") dynamicSyntax.add("command_substitution");
      hasCurrent = true;
      continue;
    }

    if (char === " " || char === "\t") {
      pushCurrent();
      continue;
    }

    if (char === "\\") {
      const isWindowsPathSeparatorBeforeWhitespace =
        !!next &&
        /\s/.test(next) &&
        (/^[A-Za-z]:/.test(current) || current.startsWith("\\\\"));
      if (isWindowsPathSeparatorBeforeWhitespace) {
        current += char;
        hasCurrent = true;
        continue;
      }
      if (next && " \t\r\n'\"|&;<>$`(){}[]*?~!#".includes(next)) {
        current += next;
        hasCurrent = true;
        index += 1;
      } else {
        current += char;
        hasCurrent = true;
      }
      continue;
    }

    const chain = readChainOperator(command, index);
    if (chain) {
      const pushed = pushSegment(index);
      const skippableSeparator =
        chain.operator === "newline" || chain.operator === ";";
      if (!pushed && !skippableSeparator) {
        parseError = "empty_segment";
        break;
      }
      if (pushed) {
        operators.push({
          operator: chain.operator,
          commandIndex: commands.length - 1,
        });
        lastOperator = chain.operator;
      }
      index += chain.length - 1;
      segmentStart = index + 1;
      continue;
    }

    const redirection = readRedirection(command, index);
    if (redirection) {
      pushCurrent();
      redirections.push({
        operator: redirection.operator,
        commandIndex: commands.length,
      });
      index += redirection.length - 1;
      continue;
    }

    recordDynamicSyntax(command, index, dynamicSyntax);
    current += char;
    hasCurrent = true;
  }

  if (!parseError && quote) parseError = "unclosed_quote";
  if (!parseError) {
    const pushed = pushSegment(command.length);
    if (!pushed && commands.length === 0) parseError = "empty_command";
    if (!pushed && lastOperator && ![";", "newline"].includes(lastOperator)) {
      parseError = "trailing_operator";
    }
  }

  for (const parsed of commands) {
    if (ENV_ASSIGNMENT_RE.test(parsed.argv[0] ?? "")) {
      dynamicSyntax.add("environment_assignment");
    }
  }

  const result: ShellCommandAnalysis = {
    ok: !parseError,
    commands,
    operators,
    redirections,
    dynamicSyntax: [...dynamicSyntax],
    riskHints: [],
    error: parseError,
  };
  result.riskHints = detectRiskHints(result);
  return result;
}

/** Returns argv only for a single command with no shell evaluation semantics. */
export function parseSimpleCommand(command: string): string[] | null {
  const analysis = analyzeShellCommand(command);
  if (
    !analysis.ok ||
    analysis.commands.length !== 1 ||
    analysis.operators.length > 0 ||
    analysis.redirections.length > 0 ||
    analysis.dynamicSyntax.length > 0
  ) {
    return null;
  }
  return analysis.commands[0].argv;
}

export function isSimpleCommand(command: string): boolean {
  return parseSimpleCommand(command) !== null;
}

function readChainOperator(
  command: string,
  index: number,
): { operator: ShellChainOperator; length: number } | null {
  const pair = command.slice(index, index + 2);
  if (pair === "&&" || pair === "||" || pair === "|&") {
    return { operator: pair, length: 2 };
  }
  const char = command[index];
  if (char === "|") return { operator: "|", length: 1 };
  if (char === ";") return { operator: ";", length: 1 };
  if (char === "&") return { operator: "&", length: 1 };
  if (char === "\r" && command[index + 1] === "\n") {
    return { operator: "newline", length: 2 };
  }
  if (char === "\r" || char === "\n") return { operator: "newline", length: 1 };
  return null;
}

function readRedirection(
  command: string,
  index: number,
): { operator: ShellRedirectionMatch["operator"]; length: number } | null {
  const pair = command.slice(index, index + 2);
  if (pair === ">>" || pair === "<<") return { operator: pair, length: 2 };
  if (command[index] === ">" || command[index] === "<") {
    return { operator: command[index] as ">" | "<", length: 1 };
  }
  return null;
}

function recordDynamicSyntax(
  command: string,
  index: number,
  dynamicSyntax: Set<ShellDynamicSyntax>,
  includeUnquotedMetacharacters = true,
): void {
  const char = command[index];
  const next = command[index + 1];
  if (char === "$" && next === "(") dynamicSyntax.add("command_substitution");
  if (char === "$" && (next === "{" || /[A-Za-z_]/.test(next ?? ""))) {
    dynamicSyntax.add("variable_expansion");
  }
  if (char === "%" && /%[^%]+%/.test(command.slice(index))) {
    dynamicSyntax.add("variable_expansion");
  }
  if (
    includeUnquotedMetacharacters &&
    (char === "*" || char === "?" || char === "[")
  ) {
    dynamicSyntax.add("glob");
  }
  if (includeUnquotedMetacharacters && "(){}".includes(char)) {
    dynamicSyntax.add("grouping");
  }
}

function detectRiskHints(analysis: ShellCommandAnalysis): ShellRiskHint[] {
  const risks: ShellRiskHint[] = [];
  const add = (
    code: ShellRiskCode,
    commandIndex: number,
    reason: string,
  ): void => {
    if (
      !risks.some(
        (risk) => risk.code === code && risk.commandIndex === commandIndex,
      )
    ) {
      risks.push({ code, commandIndex, reason });
    }
  };

  analysis.commands.forEach((command, commandIndex) => {
    const executable = normalizeExecutable(command.argv[0] ?? "");
    const args = command.argv.slice(1);
    const loweredArgs = args.map((arg) => arg.toLowerCase());
    const unwrapped = unwrapPrivilegeCommand(executable, args);
    const effectiveExecutable = unwrapped?.executable ?? executable;
    const effectiveArgs = unwrapped?.args ?? args;
    const effectiveLoweredArgs = effectiveArgs.map((arg) => arg.toLowerCase());

    if (isPrivilegeEscalation(executable, loweredArgs)) {
      add(
        "privilege_escalation",
        commandIndex,
        "Command requests elevated privileges.",
      );
    }
    if (isDiskOverwrite(effectiveExecutable, effectiveLoweredArgs)) {
      add(
        "disk_overwrite",
        commandIndex,
        "Command can format or overwrite a disk device.",
      );
    }
    if (isPowerControl(effectiveExecutable)) {
      add(
        "power_control",
        commandIndex,
        "Command can stop or restart the operating system.",
      );
    }
    if (
      isRecursivePermissionChange(effectiveExecutable, effectiveLoweredArgs)
    ) {
      add(
        "recursive_permission_change",
        commandIndex,
        "Command recursively changes permissions or ownership.",
      );
    }
    if (isRecursiveDelete(effectiveExecutable, effectiveLoweredArgs)) {
      add(
        "recursive_delete",
        commandIndex,
        "Command recursively deletes files.",
      );
      const targets = deleteTargets(effectiveExecutable, effectiveArgs);
      if (targets.some(isBroadDeleteTarget)) {
        add(
          "root_delete",
          commandIndex,
          "Command recursively deletes a root or broad user path.",
        );
      }
      if (targets.some(isSystemPath)) {
        add(
          "system_path_modification",
          commandIndex,
          "Command deletes an operating-system path.",
        );
      }
    }
    if (
      isDeleteCommand(effectiveExecutable) &&
      deleteTargets(effectiveExecutable, effectiveArgs).some(isSystemPath)
    ) {
      add(
        "system_path_modification",
        commandIndex,
        "Command deletes an operating-system path.",
      );
    }
    if (isDestructiveGitOperation(effectiveExecutable, effectiveLoweredArgs)) {
      add(
        "destructive_repository_operation",
        commandIndex,
        "Command discards repository or untracked working-tree data.",
      );
    }
    if (isSystemConfigurationChange(effectiveExecutable, effectiveArgs)) {
      add(
        "system_configuration",
        commandIndex,
        "Command changes machine-wide configuration.",
      );
    }
    if (
      isWriteLikeCommand(effectiveExecutable) &&
      effectiveArgs.some(isSystemPath)
    ) {
      add(
        "system_path_modification",
        commandIndex,
        "Command writes to an operating-system path.",
      );
    }
    if (
      analysis.redirections.some(
        (redirection) =>
          redirection.commandIndex === commandIndex &&
          (redirection.operator === ">" || redirection.operator === ">>"),
      ) &&
      args.some(isSystemPath)
    ) {
      add(
        "system_path_modification",
        commandIndex,
        "Command redirects output to an operating-system path.",
      );
    }
  });

  for (const operator of analysis.operators) {
    if (operator.operator !== "|" && operator.operator !== "|&") continue;
    const left = analysis.commands[operator.commandIndex];
    const right = analysis.commands[operator.commandIndex + 1];
    if (!left || !right) continue;
    if (
      DOWNLOAD_NAMES.has(normalizeExecutable(left.argv[0] ?? "")) &&
      SHELL_NAMES.has(normalizeExecutable(right.argv[0] ?? ""))
    ) {
      add(
        "remote_code_execution",
        operator.commandIndex,
        "Downloaded content is piped directly to a shell or evaluator.",
      );
    }
  }

  return risks;
}

function normalizeExecutable(value: string): string {
  return value.split(/[\\/]/).pop()?.toLowerCase() ?? "";
}

function unwrapPrivilegeCommand(
  executable: string,
  args: string[],
): { executable: string; args: string[] } | null {
  if (!["doas", "pkexec", "sudo"].includes(executable)) return null;
  const optionsWithValues = new Set([
    "--chdir",
    "--group",
    "--host",
    "--prompt",
    "--user",
    "-c",
    "-g",
    "-h",
    "-p",
    "-u",
  ]);
  let index = 0;
  while (index < args.length && args[index].startsWith("-")) {
    const option = args[index].toLowerCase();
    index += optionsWithValues.has(option) ? 2 : 1;
  }
  if (index >= args.length) return null;
  return {
    executable: normalizeExecutable(args[index]),
    args: args.slice(index + 1),
  };
}

function isPrivilegeEscalation(executable: string, args: string[]): boolean {
  if (["sudo", "doas", "pkexec", "runas"].includes(executable)) return true;
  if (executable === "su" && (args[0] === "-" || args.includes("root")))
    return true;
  return (
    [
      "powershell",
      "powershell.exe",
      "pwsh",
      "pwsh.exe",
      "start-process",
    ].includes(executable) &&
    args.some((arg, index) => arg === "-verb" && args[index + 1] === "runas")
  );
}

function isDiskOverwrite(executable: string, args: string[]): boolean {
  if (executable === "dd" && args.some((arg) => /^of=\/?dev\//.test(arg)))
    return true;
  if (/^mkfs(?:\.|$)/.test(executable)) return true;
  return [
    "clear-disk",
    "diskpart",
    "format",
    "format-volume",
    "initialize-disk",
    "new-partition",
  ].includes(executable);
}

function isPowerControl(executable: string): boolean {
  return [
    "halt",
    "poweroff",
    "reboot",
    "restart-computer",
    "shutdown",
    "stop-computer",
  ].includes(executable);
}

function isRecursivePermissionChange(
  executable: string,
  args: string[],
): boolean {
  if (["chmod", "chown", "chgrp"].includes(executable)) {
    return args.some((arg) => /^-[a-z]*r[a-z]*$/i.test(arg));
  }
  if (executable === "icacls") return args.includes("/t");
  return false;
}

function isRecursiveDelete(executable: string, args: string[]): boolean {
  if (executable === "rm") {
    const flags = args
      .filter((arg) => /^-[^-]/.test(arg))
      .join("")
      .toLowerCase();
    return flags.includes("r") || args.includes("--recursive");
  }
  if (["remove-item", "ri"].includes(executable)) {
    return args.some((arg) => /^-(recurse|r)$/i.test(arg));
  }
  if (["rd", "rmdir", "del", "erase"].includes(executable)) {
    return args.some((arg) => /^\/s$/i.test(arg));
  }
  return false;
}

function isDeleteCommand(executable: string): boolean {
  return ["del", "erase", "rd", "remove-item", "ri", "rm", "rmdir"].includes(
    executable,
  );
}

function deleteTargets(executable: string, args: string[]): string[] {
  if (executable === "rm") {
    return args.filter((arg) => !arg.startsWith("-") && arg !== "--");
  }
  if (["remove-item", "ri"].includes(executable)) {
    return args.filter((arg, index) => {
      if (arg.startsWith("-")) return false;
      const previous = args[index - 1]?.toLowerCase();
      return !["-filter", "-include", "-exclude"].includes(previous ?? "");
    });
  }
  return args.filter((arg) => !arg.startsWith("/"));
}

function isBroadDeleteTarget(value: string): boolean {
  const target = value.trim().replace(/^['"]|['"]$/g, "");
  return (
    ["/", "/*", ".", "./", "..", "../"].includes(target.toLowerCase()) ||
    /^(?:~|\$home|\$\{home\})(?:[\\/].*)?$/i.test(target) ||
    /^%(?:home|userprofile)%(?:[\\/].*)?$/i.test(target) ||
    /^\$env:(?:home|userprofile)(?:[\\/].*)?$/i.test(target) ||
    /^[A-Za-z]:[\\/]?(?:\*|\*\.[*])?$/.test(target) ||
    /^\\\\[^\\]+\\[^\\]+[\\/]?$/.test(target)
  );
}

function isSystemPath(value: string): boolean {
  const normalized = value
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/\\/g, "/");
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

function isWriteLikeCommand(executable: string): boolean {
  return [
    "add-content",
    "chmod",
    "chown",
    "cp",
    "install",
    "ln",
    "move-item",
    "mv",
    "new-item",
    "out-file",
    "set-content",
    "tee",
  ].includes(executable);
}

function isDestructiveGitOperation(
  executable: string,
  args: string[],
): boolean {
  if (executable !== "git") return false;
  if (args[0] === "reset" && args.includes("--hard")) return true;
  if (args[0] !== "clean") return false;
  return (
    args.some((arg) => /^-[a-z]*f[a-z]*$/i.test(arg)) ||
    args.includes("--force")
  );
}

function isSystemConfigurationChange(
  executable: string,
  args: string[],
): boolean {
  if (
    executable === "reg" &&
    ["add", "delete", "import", "restore"].includes(args[0]?.toLowerCase())
  ) {
    return args.some((arg) =>
      /^(?:HKLM|HKCR|HKEY_LOCAL_MACHINE|HKEY_CLASSES_ROOT)[\\:]/i.test(arg),
    );
  }
  return (
    args.some((arg) => /^(?:HKLM|HKCR):[\\/]/i.test(arg)) &&
    isWriteLikeCommand(executable)
  );
}
