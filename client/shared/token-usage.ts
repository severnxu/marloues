import type { ApiUsageCounters, ContextUsageRecord, TokenUsage } from "./types";

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function normalizeApiUsageCounters(
  value: unknown,
): ApiUsageCounters | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const usage: ApiUsageCounters = {
    inputTokens:
      readFiniteNumber(record.input_tokens) ??
      readFiniteNumber(record.inputTokens),
    outputTokens:
      readFiniteNumber(record.output_tokens) ??
      readFiniteNumber(record.outputTokens),
    cacheCreationInputTokens:
      readFiniteNumber(record.cache_creation_input_tokens) ??
      readFiniteNumber(record.cacheCreationInputTokens),
    cacheReadInputTokens:
      readFiniteNumber(record.cache_read_input_tokens) ??
      readFiniteNumber(record.cacheReadInputTokens),
  };
  return Object.values(usage).some((item) => item !== undefined)
    ? usage
    : undefined;
}

/** Reads new normalized snapshots and snapshots persisted before apiUsage was typed. */
export function readContextApiUsage(
  context: ContextUsageRecord | undefined,
): ApiUsageCounters | undefined {
  if (!context) return undefined;
  if (context.apiUsage) return context.apiUsage;
  if (!context.raw || typeof context.raw !== "object") return undefined;
  return normalizeApiUsageCounters(
    (context.raw as Record<string, unknown>).apiUsage,
  );
}

function counterDelta(
  current: number | undefined,
  previous: number | undefined,
): number | undefined {
  if (current === undefined) return undefined;
  if (previous === undefined || current < previous) return current;
  return current - previous;
}

/** Converts two session-cumulative SDK snapshots into one turn's usage. */
export function diffContextApiUsage(
  current: ContextUsageRecord | undefined,
  previous: ContextUsageRecord | undefined,
): TokenUsage | undefined {
  const currentUsage = readContextApiUsage(current);
  if (!currentUsage) return undefined;
  const previousUsage = readContextApiUsage(previous);
  const usage: TokenUsage = {
    inputTokens: counterDelta(
      currentUsage.inputTokens,
      previousUsage?.inputTokens,
    ),
    outputTokens: counterDelta(
      currentUsage.outputTokens,
      previousUsage?.outputTokens,
    ),
    cacheCreationInputTokens: counterDelta(
      currentUsage.cacheCreationInputTokens,
      previousUsage?.cacheCreationInputTokens,
    ),
    cacheReadInputTokens: counterDelta(
      currentUsage.cacheReadInputTokens,
      previousUsage?.cacheReadInputTokens,
    ),
    modelContextWindowTokens: current?.maxTokens,
  };
  const counters = [
    usage.inputTokens,
    usage.outputTokens,
    usage.cacheCreationInputTokens,
    usage.cacheReadInputTokens,
  ];
  if (counters.every((item) => item === undefined)) return undefined;
  usage.totalTokens = counters.reduce<number>(
    (sum, item) => sum + (item ?? 0),
    0,
  );
  return usage;
}
