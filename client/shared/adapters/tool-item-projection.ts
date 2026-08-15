import type { WorkflowTurnItem } from "../workflow-read-thread-contract";

/**
 * Tool-item projection: transforms raw mcpToolCall items into semantic
 * item types (commandExecution / fileChange) based on the tool name.
 *
 * Extracted from ReadThreadTurnList.tsx so the serializer can apply the
 * same projection at the snapshot boundary, giving all consumers
 * (composer summary, turn list, IM adapter) consistent item types without
 * each needing its own normalization pass.
 */

export function projectToolItem(
  item: WorkflowTurnItem,
): WorkflowTurnItem | null {
  if (isPassiveRuntimeStatus(item)) return null;
  if (item.type !== "mcpToolCall" && item.type !== "dynamicToolCall")
    return item;

  const name = toolName(item);
  if (isShellToolName(name)) {
    return {
      type: "commandExecution",
      id: item.id,
      command: commandFromToolArguments(item.arguments),
      status: item.status,
      output: item.output,
    };
  }

  if (isPatchToolName(name)) {
    const patch = patchTextFromTool(item.arguments, item.output?.text);
    const changes = patchChanges(patch);
    const argumentChanges = fileChangesFromToolArguments(
      name,
      item.arguments,
      patch,
    );
    const nextChanges = changes.length ? changes : argumentChanges;
    if (nextChanges.length) {
      return {
        type: "fileChange",
        id: item.id,
        status: item.status,
        changes: nextChanges,
      };
    }
  }

  return item;
}

function toolName(
  item: Extract<WorkflowTurnItem, { type: "mcpToolCall" | "dynamicToolCall" }>,
): string {
  return item.type === "mcpToolCall"
    ? [item.server, item.tool].filter(Boolean).join(".").toLowerCase() ||
        item.tool.toLowerCase()
    : item.tool.toLowerCase();
}

function isShellToolName(name: string): boolean {
  return (
    name === "exec_command" ||
    name.endsWith(".exec_command") ||
    name === "bash" ||
    name.endsWith(".bash") ||
    name === "shell" ||
    name === "shell_command" ||
    name.includes("shell") ||
    name.includes("run_command")
  );
}

function isPatchToolName(name: string): boolean {
  return (
    name === "apply_patch" ||
    name.endsWith(".apply_patch") ||
    name.includes("patch") ||
    name === "edit" ||
    name.endsWith(".edit") ||
    name === "multiedit" ||
    name.endsWith(".multiedit") ||
    name === "write" ||
    name.endsWith(".write") ||
    name === "write_file" ||
    name.endsWith(".write_file") ||
    name === "notebookedit" ||
    name.endsWith(".notebookedit")
  );
}

function isPassiveRuntimeStatus(item: WorkflowTurnItem): boolean {
  if (item.type !== "unknown") return false;
  const raw = recordValue(item.raw);
  const label = stringValue(raw?.label).toLowerCase();
  const rawType = item.rawType?.toLowerCase();
  return (
    rawType === "runtime-status" ||
    label === "sdk requesting" ||
    label === "sdk compacting" ||
    label === "sdk status"
  );
}

function commandFromToolArguments(value: unknown): string {
  const record = recordValue(value);
  if (record) {
    return (
      stringValue(record.cmd) ||
      stringValue(record.command) ||
      stringValue(record.script) ||
      JSON.stringify(value)
    );
  }
  return typeof value === "string" ? value : "";
}

function patchTextFromTool(argumentsValue: unknown, output = ""): string {
  if (typeof argumentsValue === "string") return argumentsValue;
  const record = recordValue(argumentsValue);
  return stringValue(record?.patch) || stringValue(record?.input) || output;
}

function patchChanges(patch: string): Array<{
  path: string;
  kind: string;
  diff?: { text: string; truncated?: boolean };
}> {
  const changes: Array<{
    path: string;
    kind: string;
    diff?: { text: string; truncated?: boolean };
  }> = [];
  const seen = new Set<string>();
  for (const line of patch.replace(/\r/g, "").split("\n")) {
    const applyPatchMatch = line.match(
      /^\*\*\* (Add|Update|Delete) File: (.+)$/,
    );
    if (applyPatchMatch) {
      const path = applyPatchMatch[2].trim();
      if (!path || seen.has(path)) continue;
      seen.add(path);
      changes.push({
        path,
        kind: patchKind(applyPatchMatch[1]),
        diff: { text: patch, truncated: false },
      });
      continue;
    }

    const gitDiffMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (gitDiffMatch) {
      const path = gitDiffMatch[2].trim();
      if (!path || seen.has(path)) continue;
      seen.add(path);
      changes.push({
        path,
        kind: "edit",
        diff: { text: patch, truncated: false },
      });
    }
  }
  return changes;
}

function fileChangesFromToolArguments(
  name: string,
  value: unknown,
  patch: string,
): Array<{
  path: string;
  kind: string;
  diff?: { text: string; truncated?: boolean };
}> {
  const record = recordValue(value);
  if (!record) return [];
  const path =
    stringValue(record.file_path) ||
    stringValue(record.filePath) ||
    stringValue(record.path) ||
    stringValue(record.filename);
  if (!path) return [];
  const kind = name.includes("write") ? "create" : "edit";
  const oldText =
    stringValue(record.old_string) || stringValue(record.oldString);
  const newText =
    stringValue(record.new_string) ||
    stringValue(record.newString) ||
    stringValue(record.content);
  const diff = patch || simplePseudoDiff(path, oldText, newText);
  return [
    { path, kind, diff: diff ? { text: diff, truncated: false } : undefined },
  ];
}

function simplePseudoDiff(
  path: string,
  oldText: string,
  newText: string,
): string {
  if (!oldText && !newText) return "";
  const lines = [`*** Update File: ${path}`];
  if (oldText)
    lines.push(
      ...oldText
        .split(/\r?\n/)
        .slice(0, 80)
        .map((line) => `-${line}`),
    );
  if (newText)
    lines.push(
      ...newText
        .split(/\r?\n/)
        .slice(0, 80)
        .map((line) => `+${line}`),
    );
  return lines.join("\n");
}

function patchKind(value: string): string {
  if (value === "Add") return "create";
  if (value === "Delete") return "delete";
  return "edit";
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}
