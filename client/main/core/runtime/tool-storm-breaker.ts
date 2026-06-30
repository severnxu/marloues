export type ToolStormAction = "allow" | "warn" | "deny";

export interface ToolStormDecision {
  action: ToolStormAction;
  count: number;
  fingerprint: string;
  message?: string;
}

export interface ToolStormBreakerOptions {
  defaultWarnAt?: number;
  defaultDenyAt?: number;
  readWarnAt?: number;
  readDenyAt?: number;
  riskyWarnAt?: number;
  riskyDenyAt?: number;
}

interface ToolStormRule {
  warnAt: number;
  denyAt: number;
}

const DEFAULT_OPTIONS: Required<ToolStormBreakerOptions> = {
  defaultWarnAt: 3,
  defaultDenyAt: 4,
  readWarnAt: 5,
  readDenyAt: 7,
  riskyWarnAt: 2,
  riskyDenyAt: 3,
};

const RISKY_TOOL_PATTERN = /(bash|shell|exec|write|edit|patch|delete|remove|move|copy|upload|download|browser|playwright|mcp__)/i;
const READ_TOOL_PATTERN = /(^|[._-])(read|grep|glob|ls|list|search|find|stat)([._-]|$)/i;

export class ToolStormBreaker {
  private counts = new Map<string, Map<string, number>>();
  private readonly options: Required<ToolStormBreakerOptions>;

  constructor(options: ToolStormBreakerOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  check(turnId: string, toolName: string, input: unknown): ToolStormDecision {
    const fingerprint = toolCallFingerprint(toolName, input);
    let turnCounts = this.counts.get(turnId);
    if (!turnCounts) {
      turnCounts = new Map();
      this.counts.set(turnId, turnCounts);
    }
    const count = (turnCounts.get(fingerprint) ?? 0) + 1;
    turnCounts.set(fingerprint, count);

    const rule = this.ruleFor(toolName);
    if (count >= rule.denyAt) {
      return {
        action: "deny",
        count,
        fingerprint,
        message: `Blocked repeated tool call: ${toolName} with identical input was requested ${count} times in this turn.`,
      };
    }
    if (count >= rule.warnAt) {
      return {
        action: "warn",
        count,
        fingerprint,
        message: `Repeated tool call: ${toolName} with identical input was requested ${count} times in this turn.`,
      };
    }
    return { action: "allow", count, fingerprint };
  }

  resetTurn(turnId: string): void {
    this.counts.delete(turnId);
  }

  clear(): void {
    this.counts.clear();
  }

  private ruleFor(toolName: string): ToolStormRule {
    if (RISKY_TOOL_PATTERN.test(toolName)) {
      return { warnAt: this.options.riskyWarnAt, denyAt: this.options.riskyDenyAt };
    }
    if (READ_TOOL_PATTERN.test(toolName)) {
      return { warnAt: this.options.readWarnAt, denyAt: this.options.readDenyAt };
    }
    return { warnAt: this.options.defaultWarnAt, denyAt: this.options.defaultDenyAt };
  }
}

export function toolCallFingerprint(toolName: string, input: unknown): string {
  return `${toolName}:${stableStringify(normalizeInput(input))}`;
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

function normalizeInput(input: unknown): unknown {
  if (input == null) return {};
  if (typeof input !== "object") return input;
  if (Array.isArray(input)) return input.map(normalizeInput);
  const record = input as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "undefined") continue;
    normalized[key] = normalizeInput(value);
  }
  return normalized;
}
