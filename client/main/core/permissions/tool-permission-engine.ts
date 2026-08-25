import type { AgentPermissionMode, ToolPermissionPolicy } from "@shared/types";

export type ToolPermissionAction = "deny" | "ask" | "allow";

export interface ToolPermissionRule {
  pattern: string;
  action: ToolPermissionAction;
  description?: string;
}

export interface ToolPermissionInput {
  toolName: string;
  input?: unknown;
  permissionMode?: AgentPermissionMode | "plan" | "bypass";
  policy?: ToolPermissionPolicy;
  sessionAllowedTools?: ReadonlySet<string>;
}

export interface ToolPermissionDecision {
  action: ToolPermissionAction;
  reason: string;
  matchedRule?: string;
}

interface ParsedPattern {
  toolPattern: string;
  argumentPattern?: string;
}

type ExtendedToolPermissionPolicy = ToolPermissionPolicy & {
  rules?: ToolPermissionRule[];
};

const SAFE_BUILTIN_TOOLS = ["Read", "Glob", "Grep", "LS", "TodoWrite"];
const SENSITIVE_BUILTIN_TOOLS = [
  "Bash",
  "Edit",
  "MultiEdit",
  "Write",
  "NotebookEdit",
  "Permissions",
];
const SENSITIVE_TOOL_NAME_PATTERN =
  /(bash|shell|exec|write|edit|patch|undo|delete|remove|move|copy|upload|download|browser|playwright)/i;

export function evaluateToolPermission(
  input: ToolPermissionInput,
): ToolPermissionDecision {
  const toolName = input.toolName.trim();
  const policy = input.policy;
  const rules = normalizeRules(policy);
  const matched = rules.filter((rule) =>
    matchesRule(rule.pattern, toolName, input.input),
  );

  const deny = matched.find((rule) => rule.action === "deny");
  if (deny)
    return {
      action: "deny",
      reason: "Matched deny rule.",
      matchedRule: deny.pattern,
    };

  if (input.sessionAllowedTools?.has(toolName)) {
    return { action: "allow", reason: "Allowed for this session." };
  }

  const ask = matched.find((rule) => rule.action === "ask");
  if (ask)
    return {
      action: "ask",
      reason: "Matched ask rule.",
      matchedRule: ask.pattern,
    };

  const allow = matched.find((rule) => rule.action === "allow");
  if (allow)
    return {
      action: "allow",
      reason: "Matched allow rule.",
      matchedRule: allow.pattern,
    };

  if (
    input.permissionMode === "bypassPermissions" ||
    input.permissionMode === "bypass"
  ) {
    return { action: "allow", reason: "Permission mode bypasses prompts." };
  }

  if (input.permissionMode === "plan") {
    return { action: "deny", reason: "Plan mode cannot execute tools." };
  }

  if (input.permissionMode === "acceptEdits" && isEditTool(toolName)) {
    return { action: "allow", reason: "acceptEdits allows edit tools." };
  }

  if (isSensitiveTool(toolName)) {
    const requiresConfirmation =
      policy?.requireConfirmationForSensitiveTools ?? true;
    return requiresConfirmation
      ? { action: "ask", reason: "Sensitive tool requires confirmation." }
      : { action: "allow", reason: "Sensitive confirmation is disabled." };
  }

  return { action: "allow", reason: "Tool is not sensitive." };
}

export function matchesRule(
  pattern: string,
  toolName: string,
  input?: unknown,
): boolean {
  const parsed = parsePattern(pattern);
  if (!globMatch(parsed.toolPattern, toolName)) return false;
  if (parsed.argumentPattern === undefined) return true;
  return getComparableToolArguments(toolName, input).some((value) =>
    globMatch(parsed.argumentPattern ?? "", value),
  );
}

function normalizeRules(policy?: ToolPermissionPolicy): ToolPermissionRule[] {
  const extendedPolicy = policy as ExtendedToolPermissionPolicy | undefined;
  const rules: ToolPermissionRule[] = [];
  rules.push(
    ...(extendedPolicy?.rules ?? []).filter((rule) => rule.pattern.trim()),
  );
  rules.push(
    ...(policy?.disallowedTools ?? []).map((pattern) => ({
      pattern,
      action: "deny" as const,
    })),
  );
  rules.push(
    ...(policy?.allowedTools ?? []).map((pattern) => ({
      pattern,
      action: "allow" as const,
    })),
  );
  rules.push(
    ...(policy?.sensitiveToolAllowlist ?? SAFE_BUILTIN_TOOLS).map(
      (pattern) => ({ pattern, action: "allow" as const }),
    ),
  );
  return rules;
}

function parsePattern(pattern: string): ParsedPattern {
  const trimmed = pattern.trim();
  const match = /^([^()\s]+)\((.*)\)$/.exec(trimmed);
  if (!match) return { toolPattern: trimmed };
  return {
    toolPattern: match[1].trim(),
    argumentPattern: match[2].trim(),
  };
}

function getComparableToolArguments(
  toolName: string,
  input: unknown,
): string[] {
  if (!input || typeof input !== "object") return [];
  const record = input as Record<string, unknown>;
  const preferredKeys = isEditTool(toolName)
    ? ["file_path", "path", "filename", "target"]
    : toolName === "Bash"
      ? ["command", "cmd"]
      : ["command", "cmd", "file_path", "path", "name", "url", "query"];
  const values = preferredKeys
    .map((key) => record[key])
    .filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
  if (values.length) return values;
  return [JSON.stringify(record)];
}

function isSensitiveTool(toolName: string): boolean {
  if (SENSITIVE_BUILTIN_TOOLS.includes(toolName)) return true;
  if (toolName.startsWith("mcp__")) return true;
  return SENSITIVE_TOOL_NAME_PATTERN.test(toolName);
}

function isEditTool(toolName: string): boolean {
  return (
    ["Edit", "MultiEdit", "Write", "NotebookEdit"].includes(toolName) ||
    /(^|[._-])(edit|write|patch|undo)([._-]|$)/i.test(toolName)
  );
}

function globMatch(pattern: string, value: string): boolean {
  if (pattern === value) return true;
  const regex = new RegExp(`^${globToRegex(pattern)}$`);
  return regex.test(value);
}

function globToRegex(pattern: string): string {
  let output = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];
    if (char === "*" && next === "*") {
      output += ".*";
      index += 1;
      continue;
    }
    if (char === "*") {
      output += "[^\\r\\n]*";
      continue;
    }
    output += escapeRegexChar(char);
  }
  return output;
}

function escapeRegexChar(value: string): string {
  return /[|\\{}()[\]^$+?.]/.test(value) ? `\\${value}` : value;
}
