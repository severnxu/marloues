import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentSettings } from "../../client/shared/types";
import { SecurityHost } from "../../client/main/core/security/security-host";

function settings(): AgentSettings {
  return {
    providers: [],
    defaultModel: { providerId: "test", modelId: "test-model" },
    maxTurns: 10,
    workMode: "execute",
    permissionMode: "default",
    permissionApprovalTimeoutMs: 120_000,
    desktopNotificationsEnabled: false,
    autoMemoryEnabled: false,
    thinkingEnabled: false,
    maxThinkingTokens: 0,
    activeToolProfileId: "default",
    toolProfiles: [],
    mcpServers: [],
    disabledSkills: [],
    toolPermissionPolicy: {
      rules: [],
      allowedTools: [],
      disallowedTools: [],
      sensitiveToolAllowlist: ["Read", "Glob", "Grep", "LS", "TodoWrite"],
      requireConfirmationForSensitiveTools: true,
    },
    sandboxEnabled: true,
    sandboxMode: "workspace-write",
  };
}

function host(): SecurityHost {
  return new SecurityHost({
    runtimeId: "self-built",
    sandboxOwnership: { kind: "managed", backend: "brokered-fs" },
    sandboxProfile: "workspace-write",
  });
}

describe("SecurityHost", () => {
  it("hard-denies catastrophic commands even when bypass mode is requested", () => {
    const decision = host().evaluate({
      toolName: "Bash",
      input: { command: "rm -rf /" },
      permissionMode: "bypassPermissions",
      settings: settings(),
    });

    expect(decision.action).toBe("deny");
    expect(decision.reason).toMatch(/root|filesystem|delete/i);
  });

  it("denies file paths outside the workspace before runtime execution", () => {
    const workspace = mkdtempSync(join(tmpdir(), "marloues-security-"));
    const decision = host().evaluate({
      toolName: "self-built.fs.read",
      input: { path: "../outside.txt" },
      workspaceRoot: workspace,
      settings: settings(),
    });

    expect(decision.action).toBe("deny");
    expect(decision.reason).toMatch(/workspace|escape/i);
  });

  it("hard-denies protected credential writes", () => {
    const workspace = mkdtempSync(join(tmpdir(), "marloues-security-"));
    const decision = host().evaluate({
      toolName: "self-built.fs.patch",
      input: { path: ".env", bytes: 12 },
      workspaceRoot: workspace,
      settings: settings(),
    });

    expect(decision.action).toBe("deny");
    expect(decision.reason).toMatch(/credential|configuration|protected/i);
  });

  it("hard-denies writes to protected workspace state", () => {
    const workspace = mkdtempSync(join(tmpdir(), "marloues-security-"));
    const decision = host().evaluate({
      toolName: "self-built.fs.patch",
      input: { path: ".git/runtime-state", bytes: 12 },
      workspaceRoot: workspace,
      permissionMode: "bypassPermissions",
      settings: {
        ...settings(),
        sandboxEnabled: false,
        sandboxMode: "danger-full-access",
      },
    });

    expect(decision.action).toBe("deny");
    expect(decision.reason).toMatch(/protected workspace state/i);
  });

  it("creates scoped command grants without allowing the whole Bash tool", () => {
    const workspace = mkdtempSync(join(tmpdir(), "marloues-security-"));
    const securityHost = host();
    const first = securityHost.evaluate({
      threadId: "thread-a",
      toolName: "Bash",
      input: { command: "echo hello" },
      workspaceRoot: workspace,
      settings: settings(),
    });

    expect(first.action).toBe("ask");
    expect(first.allowSession).toBe(true);

    securityHost.createGrant({
      operation: first.operation,
      scope: "session",
      sourceRequestId: "approval-1",
    });

    const same = securityHost.evaluate({
      threadId: "thread-a",
      toolName: "Bash",
      input: { command: "echo hello" },
      workspaceRoot: workspace,
      settings: settings(),
    });
    const different = securityHost.evaluate({
      threadId: "thread-a",
      toolName: "Bash",
      input: { command: "echo goodbye" },
      workspaceRoot: workspace,
      settings: settings(),
    });
    const otherThread = securityHost.evaluate({
      threadId: "thread-b",
      toolName: "Bash",
      input: { command: "echo hello" },
      workspaceRoot: workspace,
      settings: settings(),
    });

    expect(same.action).toBe("allow");
    expect(same.permit?.sandboxOwnership.kind).toBe("managed");
    expect(different.action).toBe("ask");
    expect(otherThread.action).toBe("ask");
  });

  it("creates scoped file grants for the approved resolved path only", () => {
    const workspace = mkdtempSync(join(tmpdir(), "marloues-security-"));
    writeFileSync(join(workspace, "a.md"), "a", "utf-8");
    writeFileSync(join(workspace, "b.md"), "b", "utf-8");
    const securityHost = host();
    const first = securityHost.evaluate({
      threadId: "thread-a",
      toolName: "self-built.fs.patch",
      input: { path: "a.md", bytes: 1 },
      workspaceRoot: workspace,
      settings: settings(),
    });

    expect(first.action).toBe("ask");
    securityHost.createGrant({
      operation: first.operation,
      scope: "session",
      sourceRequestId: "approval-2",
    });

    const same = securityHost.evaluate({
      threadId: "thread-a",
      toolName: "self-built.fs.patch",
      input: { path: "a.md", bytes: 1 },
      workspaceRoot: workspace,
      settings: settings(),
    });
    const different = securityHost.evaluate({
      threadId: "thread-a",
      toolName: "self-built.fs.patch",
      input: { path: "b.md", bytes: 1 },
      workspaceRoot: workspace,
      settings: settings(),
    });

    expect(same.action).toBe("allow");
    expect(same.permit?.fs.write[0]).toContain("a.md");
    expect(different.action).toBe("ask");
  });

  it("denies move destinations outside the workspace", () => {
    const workspace = mkdtempSync(join(tmpdir(), "marloues-security-"));
    const decision = host().evaluate({
      toolName: "self-built.fs.move",
      input: { path: "a.md", destinationPath: "../outside.md" },
      workspaceRoot: workspace,
      settings: settings(),
    });

    expect(decision.action).toBe("deny");
    expect(decision.reason).toMatch(/workspace|escape/i);
  });

  it("denies sandboxed command writes outside the workspace even in bypass mode", () => {
    const workspace = mkdtempSync(join(tmpdir(), "marloues-security-"));
    const decision = host().evaluate({
      toolName: "Bash",
      input: {
        command:
          'powershell -Command "Set-Content C:\\Users\\Administrator\\outside.txt nope"',
      },
      workspaceRoot: workspace,
      permissionMode: "bypassPermissions",
      settings: settings(),
    });

    expect(decision.action).toBe("deny");
    expect(decision.reason).toMatch(/workspace|escape|sandbox/i);
  });

  it("allows sandboxed command writes inside the workspace after permission grants", () => {
    const workspace = mkdtempSync(join(tmpdir(), "marloues-security-"));
    const decision = host().evaluate({
      toolName: "Bash",
      input: { command: "touch generated.txt" },
      workspaceRoot: workspace,
      permissionMode: "bypassPermissions",
      settings: settings(),
    });

    expect(decision.action).toBe("allow");
    expect(decision.permit?.sandboxProfile).toBe("workspace-write");
  });

  it("denies network commands under workspace-write sandbox", () => {
    const workspace = mkdtempSync(join(tmpdir(), "marloues-security-"));
    const decision = host().evaluate({
      toolName: "Bash",
      input: { command: "curl https://example.com" },
      workspaceRoot: workspace,
      permissionMode: "bypassPermissions",
      settings: settings(),
    });

    expect(decision.action).toBe("deny");
    expect(decision.reason).toMatch(/network/i);
  });

  it("denies file changes in read-only mode before asking for approval", () => {
    const workspace = mkdtempSync(join(tmpdir(), "marloues-security-"));
    const readOnlySettings = {
      ...settings(),
      sandboxMode: "read-only" as const,
    };
    const decision = host().evaluate({
      toolName: "Write",
      input: { file_path: join(workspace, "blocked.txt"), content: "nope" },
      workspaceRoot: workspace,
      permissionMode: "bypassPermissions",
      settings: readOnlySettings,
    });

    expect(decision.action).toBe("deny");
    expect(decision.reason).toMatch(/read-only/i);
  });

  it("treats self-built undo as a file change and blocks it in read-only mode", () => {
    const workspace = mkdtempSync(join(tmpdir(), "marloues-security-"));
    const target = join(workspace, "generated.txt");
    const decision = host().evaluate({
      threadId: "thread-a",
      toolName: "self-built.fs.undo",
      input: { path: target },
      workspaceRoot: workspace,
      settings: { ...settings(), sandboxMode: "read-only" },
    });

    expect(decision.action).toBe("deny");
    expect(decision.operation.category).toBe("file_change");
    expect(decision.reason).toMatch(/read-only/i);
  });

  it("requires approval for self-built undo in the default permission mode", () => {
    const workspace = mkdtempSync(join(tmpdir(), "marloues-security-"));
    const decision = host().evaluate({
      threadId: "thread-a",
      toolName: "self-built.fs.undo",
      input: { path: join(workspace, "generated.txt") },
      workspaceRoot: workspace,
      settings: settings(),
    });

    expect(decision.action).toBe("ask");
    expect(decision.allowSession).toBe(true);
  });

  it("requires an explicit network sandbox profile for web tools", () => {
    const workspace = mkdtempSync(join(tmpdir(), "marloues-security-"));
    const blocked = host().evaluate({
      toolName: "WebFetch",
      input: { url: "https://example.com" },
      workspaceRoot: workspace,
      permissionMode: "bypassPermissions",
      settings: settings(),
    });
    const allowed = host().evaluate({
      toolName: "WebFetch",
      input: { url: "https://example.com" },
      workspaceRoot: workspace,
      permissionMode: "bypassPermissions",
      settings: {
        ...settings(),
        sandboxMode: "workspace-write-network",
      },
    });

    expect(blocked.action).toBe("deny");
    expect(blocked.reason).toMatch(/network/i);
    expect(allowed.action).toBe("allow");
    expect(allowed.permit?.network.mode).toBe("allow");
  });

  it("keeps permission bypass separate from danger-full-access sandbox", () => {
    const workspace = mkdtempSync(join(tmpdir(), "marloues-security-"));
    const unsafeSettings = {
      ...settings(),
      sandboxEnabled: false,
      sandboxMode: "danger-full-access" as const,
    };
    const decision = host().evaluate({
      toolName: "Bash",
      input: {
        command:
          'powershell -Command "Set-Content C:\\Users\\Administrator\\outside.txt nope"',
      },
      workspaceRoot: workspace,
      permissionMode: "bypassPermissions",
      settings: unsafeSettings,
    });

    expect(decision.action).toBe("allow");
    expect(decision.permit?.sandboxProfile).toBe("danger-full-access");
  });

  it("allows direct file access outside the workspace only when the sandbox is disabled", () => {
    const workspace = mkdtempSync(join(tmpdir(), "marloues-security-"));
    const outsidePath = join(
      tmpdir(),
      `marloues-outside-${crypto.randomUUID()}.txt`,
    );
    const decision = host().evaluate({
      toolName: "Write",
      input: { file_path: outsidePath, content: "ok" },
      workspaceRoot: workspace,
      permissionMode: "bypassPermissions",
      settings: {
        ...settings(),
        sandboxEnabled: false,
        sandboxMode: "danger-full-access",
      },
    });

    expect(decision.action).toBe("allow");
    expect(decision.operation.resolvedPath).toBe(outsidePath);
    expect(decision.permit?.fs.write).toEqual([outsidePath]);
  });
});
