/**
 * Verifies enterprise redactionRules are honored by redactSensitiveText.
 *
 * Covers PRD 4.2.C intranet redaction: rules come exclusively from
 * marloues.enterprise.json policy.redactionRules; the local Security tab is
 * read-only. This test confirms:
 *   1. setRedactionRules injects rules and redactSensitiveText applies them
 *   2. disabled rules are skipped
 *   3. malformed patterns never break redaction
 *   4. setRedactionRules is idempotent on unchanged input
 *   5. getAgentSettings() injects rules from a real enterprise config file
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RedactionRule } from "../shared/types";

let exitCode = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    console.error(`  ✗ ${message}`);
    exitCode = 1;
  } else {
    console.log(`  ✓ ${message}`);
  }
}

async function main(): Promise<void> {
  console.log("redaction rules — module layer");
  {
    const { setRedactionRules, redactSensitiveText, redactSensitiveValue } = await import(
      "../main/core/security/redaction"
    );

    // Start from a clean state.
    setRedactionRules(undefined);

    const phoneRule: RedactionRule = {
      id: "phone",
      name: "手机号",
      pattern: "1\\d{10}",
      replacement: "[phone]",
      enabled: true,
    };
    const disabledRule: RedactionRule = {
      id: "disabled",
      name: "禁用规则",
      pattern: "should-not-match",
      replacement: "x",
      enabled: false,
    };
    const brokenRule: RedactionRule = {
      id: "broken",
      name: "坏正则",
      pattern: "(unclosed",
      replacement: "y",
      enabled: true,
    };

    setRedactionRules([phoneRule, disabledRule, brokenRule]);

    assert(
      redactSensitiveText("联系我 13912345678 谢谢") === "联系我 [phone] 谢谢",
      "enabled enterprise rule replaces matching text",
    );

    assert(
      redactSensitiveText("should-not-match stays") === "should-not-match stays",
      "disabled rule is skipped",
    );

    // Malformed pattern must not throw and must leave text intact.
    let didThrow = false;
    try {
      redactSensitiveText("(unclosed group text");
    } catch {
      didThrow = true;
    }
    assert(!didThrow, "malformed pattern does not throw");

    // Built-in hardcoded rules still apply alongside enterprise rules.
    assert(
      redactSensitiveText("Bearer abc.def.ghi-token").includes("[redacted]"),
      "built-in Bearer redaction still applies with enterprise rules active",
    );

    // Idempotency: calling again with the same rules is a no-op (functional
    // equivalence — same output, no throw).
    setRedactionRules([phoneRule, disabledRule, brokenRule]);
    assert(
      redactSensitiveText("13912345678") === "[phone]",
      "setRedactionRules is idempotent on unchanged input",
    );

    // Clearing rules removes their effect.
    setRedactionRules(undefined);
    assert(
      redactSensitiveText("13912345678") === "13912345678",
      "clearing rules stops enterprise redaction",
    );

    // Value form recurses and applies rules to nested strings.
    setRedactionRules([phoneRule]);
    const redactedValue = redactSensitiveValue({
      api_key: "sk-secret",
      note: "call 13912345678",
      nested: { deep: "again 13800000000" },
    }) as Record<string, unknown>;
    assert(redactedValue.api_key === "[redacted]", "sensitive key still redacted by built-in rule");
    assert(redactedValue.note === "call [phone]", "enterprise rule applies at top-level string");
    const nested = redactedValue.nested as Record<string, unknown>;
    assert(nested.deep === "again [phone]", "enterprise rule applies to nested strings");
    setRedactionRules(undefined);
  }

  console.log("redaction rules — enterprise config injection");
  {
    const home = mkdtempSync(join(tmpdir(), "marloues-redaction-"));
    process.env.MARLOUES_HOME = home;
    mkdirSync(home, { recursive: true });

    const enterpriseConfig = {
      policy: {
        redactionRules: [
          {
            id: "id-card",
            name: "身份证",
            pattern: "\\d{17}[0-9Xx]",
            replacement: "[id]",
            enabled: true,
          },
        ],
      },
    };
    // Enterprise file lives at MARLOUES_HOME/config/marloues.enterprise.json
    // (see app-paths.getEnterpriseConfigPath / getConfigDir).
    mkdirSync(join(home, "config"), { recursive: true });
    writeFileSync(
      join(home, "config", "marloues.enterprise.json"),
      JSON.stringify(enterpriseConfig, null, 2),
      "utf-8",
    );

    // Dynamic import after env is set so app-paths resolves to the temp home.
    const { getAgentSettings } = await import("./main/services/config-service");
    const { redactSensitiveText } = await import("../main/core/security/redaction");

    // Reading settings triggers applyEnterprisePolicy, which injects the rules.
    const settings = getAgentSettings();
    const rules = settings.enterprisePolicy?.redactionRules ?? [];
    assert(rules.length === 1, "enterprise redactionRules surfaced via getAgentSettings");
    assert(rules[0]?.id === "id-card", "enterprise rule id propagated");

    assert(
      redactSensitiveText("证件号 110101199003071234 已记录") === "证件号 [id] 已记录",
      "enterprise rule from config file is applied by redactSensitiveText",
    );

    rmSync(home, { recursive: true, force: true });
    delete process.env.MARLOUES_HOME;
  }

  if (exitCode === 0) {
    console.log("\nredaction rules: all checks passed");
  } else {
    console.log("\nredaction rules: FAILED");
  }
  process.exit(exitCode);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
