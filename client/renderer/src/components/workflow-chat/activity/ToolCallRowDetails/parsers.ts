import type {
  ImageGenerationDetailData,
  PlanStep,
  ToolSearchDetailData,
  UsageDetailData,
  WebSearchDetailData,
} from "./types";

export function parsePlanSteps(input: string): PlanStep[] {
  if (!input.trim()) return [];

  try {
    const parsed = JSON.parse(input) as { plan?: unknown };
    if (!Array.isArray(parsed.plan)) return [];
    return parsed.plan
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const record = entry as Record<string, unknown>;
        const step = typeof record.step === "string" ? record.step.trim() : "";
        const status =
          typeof record.status === "string" ? record.status : "pending";
        return step ? { step, status } : null;
      })
      .filter((step): step is PlanStep => Boolean(step));
  } catch {
    return [];
  }
}

export function parseToolSearchDetail(
  input: string,
  output: string,
): ToolSearchDetailData | null {
  let query: string;
  let limit: number | undefined;

  try {
    const parsed = JSON.parse(input) as { query?: unknown; limit?: unknown };
    query = typeof parsed.query === "string" ? parsed.query : input.trim();
    limit = typeof parsed.limit === "number" ? parsed.limit : undefined;
  } catch {
    query = input.trim();
  }

  const lines = output
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const tools = lines
    .filter((line) => !/^Found\s+\d+\s+tools?:/i.test(line))
    .filter((line) => /^[\w@./:-]+$/.test(line));

  if (!query && !tools.length) return null;
  return { query, limit, tools };
}

export function parseWebSearchDetail(
  input: string,
  output: string,
): WebSearchDetailData | null {
  const merged: WebSearchDetailData = {
    type: "",
    query: "",
    url: "",
    queries: [],
  };

  for (const value of [input, output]) {
    if (!value.trim()) continue;
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      if (!merged.type && typeof parsed.type === "string")
        merged.type = parsed.type;
      if (!merged.query && typeof parsed.query === "string")
        merged.query = parsed.query;
      if (!merged.url && typeof parsed.url === "string")
        merged.url = parsed.url;
      if (Array.isArray(parsed.queries)) {
        merged.queries = parsed.queries.filter(
          (query): query is string => typeof query === "string",
        );
      }
    } catch {
      if (!merged.query) merged.query = value.trim();
    }
  }

  if (!merged.type && !merged.query && !merged.url && !merged.queries.length)
    return null;
  return merged;
}

export function parseImageGenerationDetail(
  input: string,
  output: string,
): ImageGenerationDetailData | null {
  const data: ImageGenerationDetailData = {
    prompt: "",
    status: "",
    hasResult: false,
  };

  for (const value of [input, output]) {
    if (!value.trim()) continue;
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      if (!data.prompt && typeof parsed.prompt === "string")
        data.prompt = parsed.prompt;
      if (!data.status && typeof parsed.status === "string")
        data.status = parsed.status;
      if (typeof parsed.has_result === "boolean")
        data.hasResult = parsed.has_result;
      if (typeof parsed.result_bytes === "number")
        data.resultBytes = parsed.result_bytes;
    } catch {
      if (!data.prompt) data.prompt = value.trim();
    }
  }

  if (!data.prompt && !data.status && !data.hasResult) return null;
  return data;
}

export function parseUsageDetail(output: string): UsageDetailData | null {
  if (!output.trim()) return null;

  try {
    const parsed = JSON.parse(output) as Record<string, unknown>;
    return {
      totalTokens: numberFromRecord(parsed, "total_tokens"),
      lastTokens: numberFromRecord(parsed, "last_total_tokens"),
      contextWindow: numberFromRecord(parsed, "context_window"),
      primaryPercent: numberFromRecord(parsed, "rate_limit_primary_percent"),
      secondaryPercent: numberFromRecord(
        parsed,
        "rate_limit_secondary_percent",
      ),
      planType:
        typeof parsed.plan_type === "string" ? parsed.plan_type : undefined,
    };
  } catch {
    return null;
  }
}

function numberFromRecord(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
