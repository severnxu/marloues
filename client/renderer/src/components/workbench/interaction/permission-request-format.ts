import { STRINGS } from "@shared/strings.zh";
import type { PermissionDialogRequest } from "@shared/types";

export type PermissionRequestSummary =
  | { kind: "command"; value: string }
  | { kind: "file"; value: string; diffPatch?: string };

export type PermissionRequestDetails = {
  title: string;
  description: string;
  summary?: PermissionRequestSummary;
};

export function formatPermissionRequest(
  request: PermissionDialogRequest,
): PermissionRequestDetails {
  const raw = request.inputSummary || request.reason || "";
  const parsed = parsePermissionInput(raw);
  const input = readRecord(parsed, "input") ?? parsed;
  const displayName = readString(parsed, "displayName") ?? request.toolName;
  const command = readString(input, "command");
  const filePath = readString(input, "file_path") ?? readString(input, "path");
  const content =
    readString(input, "content") ?? readString(input, "new_string");
  const oldString = readString(input, "old_string");
  const suppliedDescription =
    readString(input, "description") ?? readString(parsed, "description");

  if (request.toolName === "Write" && filePath) {
    return {
      title: "允许 Marloues 写入文件？",
      description:
        suppliedDescription ?? STRINGS.system.permission.fileWriteDescription,
      summary: {
        kind: "file",
        value: filePath,
        diffPatch: createPermissionFilePatch(filePath, undefined, content),
      },
    };
  }

  if (
    (request.toolName === "Edit" || request.toolName === "MultiEdit") &&
    filePath
  ) {
    return {
      title: "允许 Marloues 修改文件？",
      description:
        suppliedDescription ??
        `修改用户请求的 ${shortPermissionPath(filePath)} 文件。`,
      summary: {
        kind: "file",
        value: filePath,
        diffPatch: createPermissionFilePatch(filePath, oldString, content),
      },
    };
  }

  if (request.toolName === "Bash" && command) {
    return {
      title: "允许 Marloues 运行命令？",
      description:
        suppliedDescription ?? "此命令将在当前工作区执行。请确认后继续任务。",
      summary: { kind: "command", value: command },
    };
  }

  if (command) {
    return {
      title: `允许 Marloues 运行 ${displayName}？`,
      description:
        suppliedDescription ?? "此工具将在当前任务中运行。请确认后继续。",
      summary: { kind: "command", value: command },
    };
  }

  return {
    title: `允许 Marloues 使用 ${displayName}？`,
    description:
      suppliedDescription ??
      readPlainReason(request.reason) ??
      "此工具需要你的确认才能继续运行。",
  };
}

export function shortPermissionPath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function parsePermissionInput(
  inputSummary: string,
): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(inputSummary) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function readRecord(
  record: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  const value = record?.[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(
  record: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readPlainReason(reason: string): string | undefined {
  const value = reason.trim();
  if (!value || value.startsWith("{") || value.startsWith("[")) {
    return undefined;
  }
  return value;
}

function createPermissionFilePatch(
  path: string,
  oldString?: string,
  newString?: string,
): string | undefined {
  if (oldString === undefined && newString === undefined) return undefined;

  const newLines = (newString ?? "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => `+${line}`);
  if (oldString === undefined) {
    return [
      "*** Begin Patch",
      `*** Add File: ${path}`,
      ...newLines,
      "*** End Patch",
    ].join("\n");
  }

  const oldLines = oldString
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => `-${line}`);
  return [
    "*** Begin Patch",
    `*** Update File: ${path}`,
    ...oldLines,
    ...newLines,
    "*** End Patch",
  ].join("\n");
}
