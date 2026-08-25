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
  const parsedSummary = parsePermissionInput(request.inputSummary || "");
  const parsedReason = parsePermissionInput(request.reason || "");
  const input =
    readRecord(parsedSummary, "input") ??
    parsedSummary ??
    readRecord(parsedReason, "input") ??
    parsedReason;
  const displayName =
    readString(parsedReason, "displayName") ??
    readString(parsedSummary, "displayName") ??
    request.toolName;
  const command = readString(input, "command");
  const filePath = readString(input, "file_path") ?? readString(input, "path");
  const content =
    readString(input, "content") ?? readString(input, "new_string");
  const oldString = readString(input, "old_string");
  const suppliedDescription =
    readString(input, "description") ??
    readString(parsedReason, "description") ??
    readString(parsedSummary, "description");
  const policyDescription =
    readString(parsedReason, "automaticReview") ??
    describePolicyDecision(
      readString(parsedReason, "decision") ??
        readString(parsedReason, "decisionReason"),
    );

  if (request.toolName === "Write" && filePath) {
    return {
      title: "允许 Marloues 写入文件？",
      description:
        policyDescription ??
        suppliedDescription ??
        STRINGS.system.permission.fileWriteDescription,
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
        policyDescription ??
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
        policyDescription ??
        suppliedDescription ??
        "此命令将在当前工作区执行。请确认后继续任务。",
      summary: { kind: "command", value: command },
    };
  }

  if (command) {
    return {
      title: `允许 Marloues 运行 ${displayName}？`,
      description:
        policyDescription ??
        suppliedDescription ??
        "此工具将在当前任务中运行。请确认后继续。",
      summary: { kind: "command", value: command },
    };
  }

  return {
    title: `允许 Marloues 使用 ${displayName}？`,
    description:
      policyDescription ??
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

function describePolicyDecision(
  reason: string | undefined,
): string | undefined {
  if (!reason) return undefined;
  if (
    /outside (?:the )?(?:current )?workspace|destination access outside|escapes? (?:the )?workspace/i.test(
      reason,
    )
  ) {
    return "此操作需要临时访问工作区之外的文件，请确认目标路径可信。";
  }
  if (/network access|network-capable/i.test(reason)) {
    return "此操作需要临时联网，请确认访问目标和发送的数据。";
  }
  if (/read-only/i.test(reason)) {
    return "当前沙箱为只读模式，不能执行写入操作。";
  }
  if (/sensitive tool/i.test(reason)) {
    return "此工具可能修改文件、运行命令或访问外部资源。";
  }
  return undefined;
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
