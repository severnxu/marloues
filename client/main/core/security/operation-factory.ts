import type { RuntimeKind } from "@shared/types";
import { parseSimpleCommand } from "../permissions/shell-command-parser";

export type SecurityOperationCategory =
  | "command_execution"
  | "file_read"
  | "file_change"
  | "network_access"
  | "other";

export type SecurityFileAction =
  "read" | "list" | "write" | "patch" | "delete" | "move";

export interface SecurityOperation {
  id: string;
  runtimeId: RuntimeKind;
  threadId?: string;
  turnId?: string;
  toolName: string;
  input: unknown;
  category: SecurityOperationCategory;
  workspaceRoot?: string;
  command?: string;
  commandFingerprint?: string;
  fileAction?: SecurityFileAction;
  path?: string;
  destinationPath?: string;
  resolvedPath?: string;
  resolvedDestinationPath?: string;
  networkHost?: string;
  networkHosts?: string[];
}

export interface CreateSecurityOperationInput {
  runtimeId: RuntimeKind;
  threadId?: string;
  turnId?: string;
  toolName: string;
  input?: unknown;
  workspaceRoot?: string;
}

export function createSecurityOperation(
  input: CreateSecurityOperationInput,
): SecurityOperation {
  const record = inputRecord(input.input);
  const command = stringValue(record.command) ?? stringValue(record.cmd);
  const path =
    stringValue(record.path) ??
    stringValue(record.file_path) ??
    stringValue(record.filename) ??
    stringValue(record.target) ??
    stringValue(record.grantRoot) ??
    stringValue(record.grant_root);
  const destinationPath =
    stringValue(record.destinationPath) ??
    stringValue(record.destination_path) ??
    stringValue(record.dest) ??
    stringValue(record.to);
  const fileAction = inferFileAction(input.toolName);
  const category = inferCategory(input.toolName, command, path, fileAction);
  const networkHosts = inferNetworkHosts(record, command);
  const networkHost = networkHosts[0];
  return {
    id: crypto.randomUUID(),
    runtimeId: input.runtimeId,
    threadId: input.threadId,
    turnId: input.turnId,
    toolName: input.toolName,
    input: input.input,
    category,
    workspaceRoot: input.workspaceRoot,
    command,
    commandFingerprint: command ? commandFingerprintOf(command) : undefined,
    fileAction,
    path,
    destinationPath,
    networkHost,
    networkHosts,
  };
}

function inferNetworkHosts(
  record: Record<string, unknown>,
  command: string | undefined,
): string[] {
  const candidates = [
    stringValue(record.url),
    stringValue(record.uri),
    ...(command?.match(/https?:\/\/[^\s'"`]+/giu) ?? []),
  ].filter((value): value is string => Boolean(value));
  const hosts = candidates.flatMap((candidate) => {
    try {
      return [new URL(candidate).hostname.toLowerCase()];
    } catch {
      return [];
    }
  });
  return Array.from(new Set(hosts));
}

export function commandFingerprintOf(command: string): string | undefined {
  const argv = parseSimpleCommand(command);
  if (!argv) return undefined;
  return JSON.stringify(argv);
}

function inferCategory(
  toolName: string,
  command: string | undefined,
  path: string | undefined,
  fileAction: SecurityFileAction | undefined,
): SecurityOperationCategory {
  if (
    command ||
    /(^|[._-])(bash|shell|exec|terminal)([._-]|$)/i.test(toolName)
  ) {
    return "command_execution";
  }
  // browser.navigate and similar navigation tools → network_access
  if (
    /(\b|[._-])(browse|navigate|web_?fetch|web_?search)(\b|[._-])/i.test(
      toolName,
    )
  ) {
    return "network_access";
  }
  if (/^(WebFetch|WebSearch)$/.test(toolName)) return "network_access";
  if (path && (fileAction === "read" || fileAction === "list")) {
    return "file_read";
  }
  if (path && fileAction) return "file_change";
  if (/^(Read|Grep|Glob|LS)$/.test(toolName)) return "file_read";
  if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(toolName))
    return "file_change";
  return "other";
}

function inferFileAction(toolName: string): SecurityFileAction | undefined {
  if (/(\b|[._-])(read|grep|glob)(\b|[._-])/i.test(toolName)) return "read";
  if (/(\b|[._-])(list|ls)(\b|[._-])/i.test(toolName)) return "list";
  if (/(\b|[._-])(write|create)(\b|[._-])/i.test(toolName)) return "write";
  if (/(\b|[._-])(edit|patch|multiEdit)(\b|[._-])/i.test(toolName))
    return "patch";
  if (/(\b|[._-])undo(\b|[._-])/i.test(toolName)) return "patch";
  if (/(\b|[._-])(delete|remove|unlink)(\b|[._-])/i.test(toolName))
    return "delete";
  if (/(\b|[._-])(move|rename)(\b|[._-])/i.test(toolName)) return "move";
  if (toolName === "Read") return "read";
  if (toolName === "LS") return "list";
  if (toolName === "Write") return "write";
  if (toolName === "Edit" || toolName === "MultiEdit") return "patch";
  return undefined;
}

function inputRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
