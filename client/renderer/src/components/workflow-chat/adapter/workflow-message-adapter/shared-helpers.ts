import type {
  WorkflowTextOutput,
  WorkflowUserMessageContent,
} from "../../../../../../shared/workflow-read-thread-contract";

type TextOutput = WorkflowTextOutput;

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

export function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value.filter(
    (entry): entry is string =>
      typeof entry === "string" && Boolean(entry.trim()),
  );
  return values.length ? values : undefined;
}

export function stripThinkTags(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<think>[\s\S]*$/g, "")
    .replace(/<\/think>/g, "")
    .replace(/<think>/g, "")
    .trim();
}

export function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "string") return value;
  const text = extractTextContent(value);
  if (text) return text;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function extractTextContent(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value))
    return value.map(extractTextContent).filter(Boolean).join("\n\n");

  const record = asRecord(value);
  if (!record) return "";

  const direct =
    stringValue(record.text) ||
    stringValue(record.content) ||
    stringValue(record.output_text) ||
    stringValue(record.input_text) ||
    stringValue(record.message);
  if (direct) return direct;

  for (const key of ["content", "output", "message", "result", "parts"]) {
    const nested = extractTextContent(record[key]);
    if (nested) return nested;
  }

  return "";
}

export function shellFromRaw(
  item: Record<string, unknown>,
): string | undefined {
  const args =
    asRecord(item.arguments) ?? asRecord(item.args) ?? asRecord(item.input);
  return (
    stringValue(item.shell) ||
    stringValue(item.shellName) ||
    stringValue(item.shell_name) ||
    stringValue(item.shellType) ||
    stringValue(item.shell_type) ||
    stringValue(item.executor) ||
    stringValue(args?.shell) ||
    stringValue(args?.shellName) ||
    stringValue(args?.shell_name) ||
    stringValue(args?.shellType) ||
    stringValue(args?.shell_type) ||
    undefined
  );
}

export function normalizeChanges(
  value: unknown,
): { path: string; kind: string }[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((change) => {
      const record = asRecord(change);
      return {
        path:
          stringValue(record?.path) ||
          stringValue(record?.file) ||
          stringValue(record?.name),
        kind:
          stringValue(record?.kind) ||
          stringValue(record?.type) ||
          stringValue(record?.status) ||
          "modified",
      };
    })
    .filter((change) => change.path);
}

export function textOutput(text: string): TextOutput | undefined {
  return text ? { text } : undefined;
}

export function textUserContent(text: string): WorkflowUserMessageContent[] {
  return text ? [{ type: "text", text }] : [];
}
