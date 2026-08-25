import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentSettings } from "../../client/shared/types";
import { createRuntimeSecurityHost } from "../../client/main/core/security/security-host";
import { createSecurityOperation } from "../../client/main/core/security/operation-factory";
import { issuePermit } from "../../client/main/core/security/sandbox-broker";
import { CodexProcessSandboxRunner } from "../../client/main/core/security/process-sandbox-runner";

function settings(
  sandboxMode: NonNullable<AgentSettings["sandboxMode"]>,
): AgentSettings {
  return {
    providers: [],
    defaultModel: { providerId: "smoke", modelId: "smoke" },
    maxTurns: 2,
    workMode: "execute",
    permissionMode: "bypassPermissions",
    permissionApprovalTimeoutMs: 30_000,
    desktopNotificationsEnabled: false,
    autoMemoryEnabled: false,
    thinkingEnabled: false,
    maxThinkingTokens: 0,
    activeToolProfileId: "default",
    toolProfiles: [],
    mcpServers: [],
    disabledSkills: [],
    sandboxEnabled: sandboxMode !== "danger-full-access",
    sandboxMode,
  };
}

function opaqueWriteCommand(filePath: string, value: string): string {
  const normalized = filePath.replaceAll("\\", "/");
  return `$target='${normalized}'; Set-Content -LiteralPath $target -Value '${value}' -NoNewline`;
}

function directWriteCommand(filePath: string, value: string): string {
  const normalized = filePath.replaceAll("\\", "/");
  return `Set-Content -LiteralPath '${normalized}' -Value '${value}' -NoNewline`;
}

async function runCase(input: {
  workspace: string;
  command: string;
  profile: NonNullable<AgentSettings["sandboxMode"]>;
  runner: CodexProcessSandboxRunner;
  runnerOnly?: boolean;
}) {
  const permit = input.runnerOnly
    ? issuePermit({
        operation: createSecurityOperation({
          runtimeId: "sdk",
          threadId: "process-sandbox-smoke",
          turnId: crypto.randomUUID(),
          toolName: "Bash",
          input: { command: input.command },
          workspaceRoot: input.workspace,
        }),
        sandboxProfile: input.profile,
        sandboxOwnership: { kind: "managed", backend: "codex-cli" },
      })
    : evaluatePermit(input);
  return input.runner.run({
    command: input.command,
    cwd: input.workspace,
    permit,
    timeoutMs: 30_000,
  });
}

function evaluatePermit(input: {
  workspace: string;
  command: string;
  profile: NonNullable<AgentSettings["sandboxMode"]>;
}) {
  const securityHost = createRuntimeSecurityHost("sdk");
  const decision = securityHost.evaluate({
    threadId: "process-sandbox-smoke",
    turnId: crypto.randomUUID(),
    toolName: "Bash",
    input: { command: input.command },
    workspaceRoot: input.workspace,
    permissionMode: "bypassPermissions",
    settings: settings(input.profile),
  });
  if (decision.action !== "allow" || !decision.permit) {
    throw new Error(`SecurityHost did not issue a permit: ${decision.reason}`);
  }
  return decision.permit;
}

async function main(): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error(
      "This smoke test currently targets the Codex Windows sandbox.",
    );
  }

  const stamp = `${Date.now()}-${process.pid}`;
  const workspace = resolve("test-artifacts", `process-sandbox-${stamp}`);
  const insideFile = join(workspace, "workspace-write.txt");
  const readOnlyFile = join(workspace, "read-only-denied.txt");
  const protectedDir = join(workspace, ".git");
  const protectedFile = join(protectedDir, "sandbox-denied.txt");
  const outsideFile = join(homedir(), `marloues-sandbox-denied-${stamp}.txt`);
  mkdirSync(workspace, { recursive: true });
  mkdirSync(protectedDir, { recursive: true });

  const runner = new CodexProcessSandboxRunner();
  if (!runner.isAvailable()) {
    throw new Error("Bundled @openai/codex native binary was not resolved.");
  }

  const inside = await runCase({
    workspace,
    command: directWriteCommand(insideFile, "workspace-ok"),
    profile: "workspace-write",
    runner,
  });
  if (
    inside.exitCode !== 0 ||
    readFileSync(insideFile, "utf-8") !== "workspace-ok"
  ) {
    throw new Error(
      `Workspace write failed (exit=${inside.exitCode}, timedOut=${inside.timedOut}): ${inside.stderr || inside.stdout}`,
    );
  }

  const outside = await runCase({
    workspace,
    command: opaqueWriteCommand(outsideFile, "must-not-exist"),
    profile: "workspace-write",
    runner,
  });
  if (outside.exitCode === 0 || existsSync(outsideFile)) {
    throw new Error("Workspace sandbox allowed a write outside the workspace.");
  }

  const readOnly = await runCase({
    workspace,
    command: opaqueWriteCommand(readOnlyFile, "must-not-exist"),
    profile: "read-only",
    runner,
    runnerOnly: true,
  });
  if (readOnly.exitCode === 0 || existsSync(readOnlyFile)) {
    throw new Error("Read-only sandbox allowed a workspace write.");
  }

  const protectedWrite = await runCase({
    workspace,
    command: opaqueWriteCommand(protectedFile, "must-not-exist"),
    profile: "workspace-write",
    runner,
  });
  if (protectedWrite.exitCode === 0 || existsSync(protectedFile)) {
    throw new Error(
      "Workspace sandbox allowed a write into protected .git state.",
    );
  }

  const networkCommand =
    'curl.exe --silent --show-error --output NUL --write-out "%{http_code}" http://example.com';
  const networkDenied = await runCase({
    workspace,
    command: networkCommand,
    profile: "workspace-write",
    runner,
    runnerOnly: true,
  });
  if (networkDenied.exitCode === 0 && /[1-5]\d\d/.test(networkDenied.stdout)) {
    throw new Error("Workspace sandbox allowed public network access.");
  }

  const networkAllowed = await runCase({
    workspace,
    command: networkCommand,
    profile: "workspace-write-network",
    runner,
  });
  if (
    networkAllowed.exitCode !== 0 ||
    !/[1-5]\d\d/.test(networkAllowed.stdout)
  ) {
    throw new Error(
      `Network profile did not reach the public probe: ${networkAllowed.stderr || networkAllowed.stdout}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        backend: inside.backend,
        workspace,
        checks: {
          workspaceWriteAllowed: true,
          outsideWriteDenied: true,
          readOnlyWriteDenied: true,
          protectedWorkspaceStateDenied: true,
          workspaceNetworkDenied: true,
          networkProfileAllowed: true,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
