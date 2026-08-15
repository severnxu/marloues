import type { TimelineItem } from "@shared/types";
import type { FileChange } from "./types";

export function buildFileChanges(timeline: TimelineItem[]): FileChange[] {
  const changes: FileChange[] = [];
  const seen = new Set<string>();

  for (const item of timeline) {
    const name = (item.toolName || item.label || "").toLowerCase();
    const input = item.toolInput as Record<string, unknown> | undefined;

    let op: FileChange["operation"] = "other";
    let opLabel = name;

    if (/^(read|read_file)$/i.test(name)) {
      op = "read";
      opLabel = "读取";
    } else if (/^(write|write_to_file)$/i.test(name)) {
      op = "write";
      opLabel = "写入";
    } else if (/^(edit|replace|search_replace)$/i.test(name)) {
      op = "edit";
      opLabel = "编辑";
    } else if (/^(grep|glob|search)$/i.test(name)) {
      op = "search";
      opLabel = "搜索";
    } else if (!input) continue;

    const filePath =
      (typeof input?.file_path === "string" && input.file_path) ||
      (typeof input?.path === "string" && input.path) ||
      "";

    if (!filePath) continue;

    const key = `${filePath}-${op}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const rawDiff = readTimelineDiff(input, item.toolOutput);
    const { insertions, deletions } = countDiffLines(rawDiff);
    changes.push({
      path: filePath,
      operation: op,
      operationLabel: opLabel,
      insertions,
      deletions,
      rawDiff: rawDiff || undefined,
    });
  }

  return changes.slice(-20);
}

function readTimelineDiff(
  input: Record<string, unknown> | undefined,
  output: unknown,
): string {
  for (const value of [input?.diff, input?.patch, readObjectText(output)]) {
    if (typeof value === "string" && value.trim()) return value;
  }

  const oldText = typeof input?.old_string === "string" ? input.old_string : "";
  const newText = typeof input?.new_string === "string" ? input.new_string : "";
  if (!oldText && !newText) return "";
  return [
    ...oldText.split("\n").map((line) => `-${line}`),
    ...newText.split("\n").map((line) => `+${line}`),
  ].join("\n");
}

function readObjectText(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return record.diff ?? record.patch ?? record.text;
}

function countDiffLines(rawDiff: string): {
  insertions: number;
  deletions: number;
} {
  let insertions = 0;
  let deletions = 0;
  for (const line of rawDiff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++ ")) insertions += 1;
    if (line.startsWith("-") && !line.startsWith("--- ")) deletions += 1;
  }
  return { insertions, deletions };
}
