import { describe, it, expect } from "vitest";
import {
  evaluateToolPermission,
  matchesRule,
  type ToolPermissionInput,
} from "../../client/main/core/permissions/tool-permission-engine";
import type { ToolPermissionPolicy } from "@shared/types";

function withRules(rules: ToolPermissionPolicy["rules"]): ToolPermissionPolicy {
  return { rules } as ToolPermissionPolicy;
}

describe("tool-permission-engine", () => {
  it("allows non-sensitive tools by default", () => {
    const decision = evaluateToolPermission({ toolName: "Glob", input: {} });
    expect(decision.action).toBe("allow");
  });

  it("asks for sensitive tools by default", () => {
    const decision = evaluateToolPermission({ toolName: "Bash", input: { command: "rm -rf /" } });
    expect(decision.action).toBe("ask");
    expect(decision.reason).toContain("Sensitive");
  });

  it("deny rule wins over allow rule", () => {
    const decision = evaluateToolPermission({
      toolName: "Bash",
      policy: withRules([
        { pattern: "Bash", action: "deny" },
        { pattern: "Bash", action: "allow" },
      ]),
    });
    expect(decision.action).toBe("deny");
  });

  it("session-allowed tools bypass sensitivity", () => {
    const decision = evaluateToolPermission({
      toolName: "Bash",
      sessionAllowedTools: new Set(["Bash"]),
    });
    expect(decision.action).toBe("allow");
  });

  it("ask rule is checked before allow rule", () => {
    const decision = evaluateToolPermission({
      toolName: "Bash",
      input: { command: "rm -rf /" },
      policy: withRules([
        { pattern: "Bash", action: "allow" },
        { pattern: "Bash(*rm*)", action: "ask" },
      ]),
    });
    expect(decision.action).toBe("ask");
  });

  it("bypass mode allows everything", () => {
    const decision = evaluateToolPermission({ toolName: "Bash", permissionMode: "bypass" });
    expect(decision.action).toBe("allow");
  });

  it("plan mode denies tool execution", () => {
    const decision = evaluateToolPermission({ toolName: "Bash", permissionMode: "plan" });
    expect(decision.action).toBe("deny");
  });

  it("acceptEdits allows edit tools", () => {
    const decision = evaluateToolPermission({ toolName: "Edit", permissionMode: "acceptEdits" });
    expect(decision.action).toBe("allow");
  });

  it("disallowedTools are denied", () => {
    const decision = evaluateToolPermission({ toolName: "Bash", policy: { disallowedTools: ["Bash"] } });
    expect(decision.action).toBe("deny");
  });

  it("allowedTools permit matching tools", () => {
    const decision = evaluateToolPermission({ toolName: "WebSearch", policy: { allowedTools: ["WebSearch"] } });
    expect(decision.action).toBe("allow");
  });

  it("mcp tools are treated as sensitive", () => {
    const decision = evaluateToolPermission({ toolName: "mcp__github" });
    expect(decision.action).toBe("ask");
  });

  it("requireConfirmationForSensitiveTools=false allows sensitive tools", () => {
    const decision = evaluateToolPermission({
      toolName: "Bash",
      policy: { requireConfirmationForSensitiveTools: false },
    });
    expect(decision.action).toBe("allow");
  });

  it("matchesRule matches tool names", () => {
    expect(matchesRule("Bash", "Bash")).toBe(true);
    expect(matchesRule("Bash*", "BashHistory")).toBe(true);
    expect(matchesRule("Read", "Bash")).toBe(false);
  });

  it("matchesRule matches file_path arguments for edit tools", () => {
    expect(matchesRule("Edit(**/*.md)", "Edit", { file_path: "src/a.md" })).toBe(true);
    expect(matchesRule("Edit(**/*.md)", "Edit", { file_path: "src/a.ts" })).toBe(false);
  });
});
