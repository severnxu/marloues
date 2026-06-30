export interface TokenEconomyOptions {
  maxModelChars?: number;
  maxLineChars?: number;
}

export interface TokenEconomyMeta {
  compressed: boolean;
  originalChars: number;
  modelChars: number;
  strategy: string[];
  preserved: {
    codeBlocks: number;
    paths: number;
    urls: number;
    stackLines: number;
    errorLines: number;
  };
  omittedChars: number;
}

export interface TokenEconomyResult {
  rawText: string;
  modelText: string;
  meta: TokenEconomyMeta;
}

interface LineRecord {
  text: string;
  protected: boolean;
  kind?: keyof TokenEconomyMeta["preserved"];
}

const DEFAULT_MAX_MODEL_CHARS = 12_000;
const DEFAULT_MAX_LINE_CHARS = 1_200;
const HEAD_LINE_BUDGET = 80;
const TAIL_LINE_BUDGET = 80;

export function compressToolResult(output: unknown, options: TokenEconomyOptions = {}): TokenEconomyResult {
  const rawText = normalizeOutput(output);
  const maxModelChars = options.maxModelChars ?? DEFAULT_MAX_MODEL_CHARS;
  const maxLineChars = options.maxLineChars ?? DEFAULT_MAX_LINE_CHARS;
  const preserved = emptyPreserved();
  const strategy = new Set<string>();

  if (rawText.length <= maxModelChars) {
    return {
      rawText,
      modelText: rawText,
      meta: {
        compressed: false,
        originalChars: rawText.length,
        modelChars: rawText.length,
        strategy: [],
        preserved,
        omittedChars: 0,
      },
    };
  }

  const protectedLines = markProtectedLines(rawText, preserved);
  const dedupedLines = dedupeRepeatedLines(protectedLines, strategy);
  const trimmedLines = trimLongUnprotectedLines(dedupedLines, maxLineChars, strategy);
  const modelText = fitLinesToBudget(trimmedLines, maxModelChars, strategy);

  return {
    rawText,
    modelText,
    meta: {
      compressed: modelText.length < rawText.length,
      originalChars: rawText.length,
      modelChars: modelText.length,
      strategy: Array.from(strategy),
      preserved,
      omittedChars: Math.max(0, rawText.length - modelText.length),
    },
  };
}

export function compressToolDescription(description: string, maxChars = 600): string {
  const normalized = normalizeOutput(description);
  if (normalized.length <= maxChars) return normalized;
  const sentences = normalized.split(/(?<=[.!?。！？])\s+/).filter(Boolean);
  let output = "";
  for (const sentence of sentences) {
    if ((output + " " + sentence).trim().length > maxChars) break;
    output = (output + " " + sentence).trim();
  }
  return output || `${normalized.slice(0, Math.max(0, maxChars - 24)).trimEnd()}\n[description truncated]`;
}

function normalizeOutput(output: unknown): string {
  if (output == null) return "";
  const text = typeof output === "string" ? output : JSON.stringify(output, null, 2);
  return stripAnsi(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

function markProtectedLines(text: string, preserved: TokenEconomyMeta["preserved"]): LineRecord[] {
  const lines = text.split("\n");
  let inFence = false;
  return lines.map((line) => {
    const fenceLine = /^\s*```/.test(line);
    if (fenceLine) inFence = !inFence;
    const kind = protectedKind(line, inFence || fenceLine);
    if (kind) preserved[kind] += 1;
    return {
      text: line,
      protected: Boolean(kind),
      kind,
    };
  });
}

function protectedKind(line: string, inFence: boolean): keyof TokenEconomyMeta["preserved"] | undefined {
  if (inFence) return "codeBlocks";
  if (/\bhttps?:\/\/[^\s]+/i.test(line)) return "urls";
  if (/(^|\s)([A-Za-z]:[\\/][^\s"'<>|]+|\/[\w.-]+(?:\/[\w .@()[\]-]+)+)/.test(line)) return "paths";
  if (/^\s+at\s+\S+/.test(line) || /^\s*File ".*", line \d+/.test(line) || /^\s*Caused by:/.test(line)) return "stackLines";
  if (/\b(error|exception|traceback|failed|fatal)\b/i.test(line)) return "errorLines";
  return undefined;
}

function dedupeRepeatedLines(lines: LineRecord[], strategy: Set<string>): LineRecord[] {
  const seen = new Set<string>();
  const output: LineRecord[] = [];
  let removed = 0;
  for (const line of lines) {
    const key = line.text.trim();
    if (!line.protected && key.length > 24) {
      if (seen.has(key)) {
        removed += 1;
        continue;
      }
      seen.add(key);
    }
    output.push(line);
  }
  if (removed > 0) strategy.add(`deduped ${removed} repeated log/file lines`);
  return output;
}

function trimLongUnprotectedLines(lines: LineRecord[], maxLineChars: number, strategy: Set<string>): LineRecord[] {
  let trimmed = 0;
  const output = lines.map((line) => {
    if (line.protected || line.text.length <= maxLineChars) return line;
    trimmed += line.text.length - maxLineChars;
    const head = Math.floor(maxLineChars * 0.65);
    const tail = Math.max(0, maxLineChars - head - 40);
    return {
      ...line,
      text: `${line.text.slice(0, head)}\n[long line omitted ${line.text.length - maxLineChars} chars]\n${line.text.slice(-tail)}`,
    };
  });
  if (trimmed > 0) strategy.add(`trimmed long unprotected lines`);
  return output;
}

function fitLinesToBudget(lines: LineRecord[], maxChars: number, strategy: Set<string>): string {
  const all = lines.map((line) => line.text).join("\n");
  if (all.length <= maxChars) return all;

  const protectedLines = lines.filter((line) => line.protected);
  const head = lines.slice(0, HEAD_LINE_BUDGET);
  const tail = lines.slice(-TAIL_LINE_BUDGET);
  const selected = uniqueLineRecords([...head, ...protectedLines, ...tail]);
  let output = selected.map((line) => line.text).join("\n");

  if (output.length > maxChars) {
    const protectedText = protectedLines.map((line) => line.text).join("\n");
    const budgetForEdges = Math.max(0, maxChars - protectedText.length - 140);
    const headChars = Math.floor(budgetForEdges * 0.55);
    const tailChars = budgetForEdges - headChars;
    output = [
      all.slice(0, headChars).trimEnd(),
      `[middle omitted ${Math.max(0, all.length - headChars - tailChars)} chars; protected code/path/url/error lines retained when budget allowed]`,
      protectedText,
      all.slice(-tailChars).trimStart(),
    ].filter(Boolean).join("\n");
  }

  if (output.length > maxChars) {
    output = `${output.slice(0, Math.max(0, maxChars - 80)).trimEnd()}\n[compressed output clipped to budget]`;
  }

  strategy.add("kept head/tail and protected lines");
  return output;
}

function uniqueLineRecords(lines: LineRecord[]): LineRecord[] {
  const seen = new Set<LineRecord>();
  const output: LineRecord[] = [];
  for (const line of lines) {
    if (seen.has(line)) continue;
    seen.add(line);
    output.push(line);
  }
  return output;
}

function emptyPreserved(): TokenEconomyMeta["preserved"] {
  return {
    codeBlocks: 0,
    paths: 0,
    urls: 0,
    stackLines: 0,
    errorLines: 0,
  };
}
