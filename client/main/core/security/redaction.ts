import type { RedactionRule } from "@shared/types";

/**
 * Enterprise redaction rules injected from config-service.
 * Sourced exclusively from `marloues.enterprise.json` policy.redactionRules;
 * the local UI is read-only for these (PRD 4.2.C intranet model).
 */
let enterpriseRedactionRules: RedactionRule[] = [];
let lastRulesSignature = "";

/**
 * Inject enterprise redaction rules. Idempotent: skips the update when the
 * rule set has not changed (cheap shallow signature compare), so callers that
 * run on every `getAgentSettings()` do no redundant work.
 */
export function setRedactionRules(rules: RedactionRule[] | undefined): void {
  const next = Array.isArray(rules) ? rules.filter(isValidRedactionRule) : [];
  const signature = next.map((rule) => `${rule.id}|${rule.enabled ? 1 : 0}|${rule.pattern}|${rule.replacement}`).join("\n");
  if (signature === lastRulesSignature) return;
  enterpriseRedactionRules = next;
  lastRulesSignature = signature;
}

function isValidRedactionRule(rule: unknown): rule is RedactionRule {
  if (!rule || typeof rule !== "object") return false;
  const candidate = rule as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.pattern === "string" &&
    typeof candidate.replacement === "string" &&
    typeof candidate.enabled === "boolean"
  );
}

export function redactSensitiveValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitiveValue);
  if (typeof value === "string") return redactSensitiveText(value);
  if (!value || typeof value !== "object") return value;

  const redacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isSensitiveKey(key)) {
      redacted[key] = "[redacted]";
      continue;
    }
    redacted[key] = redactSensitiveValue(entry);
  }
  return redacted;
}

export function redactSensitiveText(value: string): string {
  let redacted = value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(
      /(["']?)(api[_-]?key|token|secret|password|authorization|cookie|session)(["']?)\s*[:=]\s*(["'])[^"']*(["'])/gi,
      "$1$2$3: $4[redacted]$5",
    )
    .replace(
      /(["']?)(api[_-]?key|token|secret|password|authorization|cookie|session)(["']?)\s*[:=]\s*[^"',\s}]+/gi,
      "$1$2$3=[redacted]",
    )
    .replace(/enc:(safe|fallback):v1:[A-Za-z0-9+/=]+/g, "enc:$1:v1:[redacted]");

  for (const rule of enterpriseRedactionRules) {
    if (!rule.enabled) continue;
    // A malformed enterprise pattern must never break redaction or the host app.
    let pattern: RegExp;
    try {
      pattern = new RegExp(rule.pattern, "gi");
    } catch {
      continue;
    }
    redacted = redacted.replace(pattern, rule.replacement);
  }
  return redacted;
}

function isSensitiveKey(key: string): boolean {
  // Only match standalone sensitive tokens, not benign ID fields
  if (/sessionId|turnId|chatSessionId|kernelSessionId/i.test(key)) return false;
  return /api[_-]?key|token|secret|password|authorization|cookie|session/i.test(key);
}
