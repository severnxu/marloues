import type { ProcessItem, WorkflowActivitySummary } from "./types";

export function emptyActivitySummary(): WorkflowActivitySummary {
  return {
    commandCount: 0,
    imageCount: 0,
    exploredFileCount: 0,
    fileCreateCount: 0,
    fileEditCount: 0,
    fileDeleteCount: 0,
    listCount: 0,
    searchCount: 0,
    toolCount: 0,
    webSearchCount: 0,
    waitingPermissionRequestCount: 0,
    approvedPermissionRequestCount: 0,
    deniedPermissionRequestCount: 0,
    runningCount: 0,
    runningCommandCount: 0,
    runningExploredFileCount: 0,
    runningFileCreateCount: 0,
    runningFileEditCount: 0,
    runningFileDeleteCount: 0,
    runningFolderCreateCount: 0,
    runningListCount: 0,
    runningSearchCount: 0,
    runningToolCount: 0,
    runningWebSearchCount: 0,
    runningWrittenLineCount: 0,
    addedLineCount: 0,
    removedLineCount: 0,
    runningAddedLineCount: 0,
    runningRemovedLineCount: 0,
  };
}

export function completedCount(
  total: number,
  running: number,
  onlyCompletedCounts: boolean,
): number {
  return Math.max(0, onlyCompletedCounts ? total - running : total);
}

export function fileChangeKind(kind: string): "create" | "edit" | "delete" {
  const normalized = kind.toLowerCase();
  if (
    normalized.includes("create") ||
    normalized.includes("add") ||
    normalized.includes("new")
  )
    return "create";
  if (
    normalized.includes("delete") ||
    normalized.includes("remove") ||
    normalized.includes("unlink")
  )
    return "delete";
  return "edit";
}

export function patchLineStats(diff: string): {
  added: number;
  removed: number;
} {
  if (!diff.trim()) return { added: 0, removed: 0 };
  return diff
    .replace(/\r/g, "")
    .split("\n")
    .reduce(
      (stats, line) => {
        if (
          line.startsWith("+") &&
          !line.startsWith("+++") &&
          line !== "*** Begin Patch" &&
          line !== "*** End Patch"
        )
          stats.added += 1;
        else if (line.startsWith("-") && !line.startsWith("---"))
          stats.removed += 1;
        return stats;
      },
      { added: 0, removed: 0 },
    );
}

export function commandLines(
  item: Extract<ProcessItem, { type: "commandExecution" }>,
): string[] {
  const commands = item.command
    .split(/\n\n+/)
    .map((command) => command.trim())
    .filter(Boolean);
  return commands.length ? commands : [""];
}

export function commandSummaryKind(
  command: string,
): "command" | "folder" | "list" | "read" | "search" | "web" {
  const firstLine = command.trim().split(/\r?\n/)[0] ?? "";
  if (/^(Get-Content|gc|cat)\b/i.test(firstLine)) return "read";
  if (
    /^(New-Item|mkdir|md)\b/i.test(firstLine) &&
    /(\s-ItemType\s+Directory\b|\smkdir\b|\smd\b|^mkdir\b|^md\b)/i.test(
      firstLine,
    )
  )
    return "folder";
  if (
    /^(Get-ChildItem|ls|dir)\b/i.test(firstLine) ||
    firstLine.startsWith("rg --files")
  )
    return "list";
  if (/^(Select-String)\b/i.test(firstLine) || /^rg\s+/i.test(firstLine))
    return "search";
  if (/^(Invoke-WebRequest|Invoke-RestMethod|curl|wget)\b/i.test(firstLine))
    return "web";
  return "command";
}

export function isReadToolName(name: string): boolean {
  return (
    name === "read" ||
    name.endsWith(".read") ||
    name === "read_file" ||
    name === "read_files" ||
    name.endsWith(".read_file") ||
    name.endsWith(".read_files")
  );
}

export function isListToolName(name: string): boolean {
  return (
    name === "list" ||
    name === "ls" ||
    name.endsWith(".ls") ||
    name === "list_files" ||
    name === "get_directory_tree" ||
    name.endsWith(".list_files")
  );
}

export function isSearchToolName(name: string): boolean {
  return name.includes("search") || name === "grep" || name.endsWith(".grep");
}

export function isEditToolName(name: string): boolean {
  return (
    name.includes("apply_patch") ||
    name.includes("patch") ||
    name.includes("edit")
  );
}

export function toolTargetCount(input: string): number {
  if (!input.trim()) return 0;
  try {
    const value = JSON.parse(input) as unknown;
    if (Array.isArray(value)) return value.length;
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      for (const key of ["paths", "files", "filePaths", "file_paths"]) {
        const entry = record[key];
        if (Array.isArray(entry)) return entry.length;
      }
    }
  } catch {
    // Plain text inputs are common for tool arguments.
  }
  return (
    input
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean).length || 1
  );
}
