import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentRuntime,
  RuntimeEvent,
} from "../../client/shared/agent-runtime";
import type {
  AgentSettings,
  ModelProviderConfig,
} from "../../client/shared/types";

const liveHome = mkdtempSync(join(tmpdir(), "marloues-binary-live-"));
process.env.MARLOUES_HOME = liveHome;

async function main(): Promise<void> {
  const ccSwitch = loadCcSwitchProvider();
  process.env.CCSWITCH_BINARY_LIVE_API_KEY = ccSwitch.apiKey;

  const { getAgentSettings, saveAgentSettings } =
    await import("../../client/main/services/config-service");
  const { closeStateDbForTests } =
    await import("../../client/main/core/storage/state-db");
  const { stopGateway } = await import("../../client/main/gateway");
  const { destroyRuntime, getRuntime, initRuntime } =
    await import("../../client/main/core/runtime/manager");
  const workspace = mkdtempSync(join(tmpdir(), "marloues-binary-workspace-"));
  const stamp = Date.now();
  const insidePath = join(workspace, `inside-${stamp}.txt`);
  const outsideDeniedPath = join(
    homedir(),
    `marloues-binary-outside-denied-${stamp}.txt`,
  );
  const protectedDir = join(workspace, ".git");
  const protectedPath = join(protectedDir, `binary-protected-${stamp}.txt`);
  const approvalDeniedPath = join(
    homedir(),
    `marloues-binary-approval-denied-${stamp}.txt`,
  );
  const approvalOncePath = join(
    homedir(),
    `marloues-binary-approval-once-${stamp}.txt`,
  );
  const approvalSessionPath = join(
    homedir(),
    `marloues-binary-approval-session-${stamp}.txt`,
  );
  const dangerPath = join(homedir(), `marloues-binary-danger-${stamp}.txt`);
  const settings = binarySettings(getAgentSettings(), ccSwitch.provider);
  saveAgentSettings(settings);
  mkdirSync(protectedDir, { recursive: true });

  console.info("=== Marloues Codex binary live smoke ===");
  console.info(`Home:     ${liveHome}`);
  console.info("Provider: cc-switch via Marloues gateway");
  console.info(`Model:    ${ccSwitch.provider.models[0].id}`);

  try {
    await initRuntime();
    const runtime = getRuntime();
    if (runtime.name !== "Binary") {
      throw new Error(`Expected Binary runtime, got ${runtime.name}`);
    }

    await runExactCommand(
      runtime,
      workspace,
      powershellWrite(insidePath, "BINARY_WORKSPACE_OK"),
      "binary-workspace-write",
    );
    assert(
      existsSync(insidePath) &&
        readFileSync(insidePath, "utf-8") === "BINARY_WORKSPACE_OK",
      "Codex binary did not write inside the workspace",
    );

    await runExactCommand(
      runtime,
      workspace,
      powershellWrite(outsideDeniedPath, "MUST_NOT_EXIST"),
      "binary-outside-denied",
    );
    assert(
      !existsSync(outsideDeniedPath),
      "Codex binary escaped the workspace-write sandbox",
    );

    await runExactCommand(
      runtime,
      workspace,
      powershellWrite(protectedPath, "MUST_NOT_EXIST"),
      "binary-protected-state-denied",
    );
    assert(
      !existsSync(protectedPath),
      "Codex binary wrote into protected .git state",
    );

    await runtime.setPermissionMode("default");
    const denied = await runApprovalCommand({
      runtime,
      cwd: workspace,
      command: powershellWrite(approvalDeniedPath, "MUST_NOT_EXIST"),
      title: "binary-approval-deny",
      approved: false,
      scope: "once",
    });
    assert(
      denied.approvalCount === 1,
      "Binary deny case did not request approval",
    );
    assert(
      !existsSync(approvalDeniedPath),
      "Denied Binary approval wrote the file",
    );

    const approvedOnce = await runApprovalCommand({
      runtime,
      cwd: workspace,
      command: powershellWrite(approvalOncePath, "BINARY_APPROVAL_ONCE_OK"),
      title: "binary-approval-once",
      approved: true,
      scope: "once",
    });
    assert(
      approvedOnce.approvalCount === 1,
      "Binary approve-once case did not request approval",
    );
    assert(
      existsSync(approvalOncePath) &&
        readFileSync(approvalOncePath, "utf-8") === "BINARY_APPROVAL_ONCE_OK",
      "Approved Binary once request did not write the file",
    );

    writeFileSync(approvalSessionPath, "BINARY_APPROVAL_SESSION_SEED");
    const sessionCommand = powershellWrite(
      approvalSessionPath,
      "BINARY_APPROVAL_SESSION_OK",
    );
    const approvedSession = await runSessionPermissionGrant({
      runtime,
      cwd: workspace,
      command: sessionCommand,
      writablePath: approvalSessionPath,
      title: "binary-approval-session",
    });
    assert(
      approvedSession.approvalCount === 1 && approvedSession.allowSession,
      "Binary session approval was not offered and accepted",
    );
    assert(
      existsSync(approvalSessionPath) &&
        readFileSync(approvalSessionPath, "utf-8") ===
          "BINARY_APPROVAL_SESSION_OK",
      "Approved Binary session request did not write the file",
    );
    const sessionReuseCommand = powershellWrite(
      approvalSessionPath,
      "BINARY_APPROVAL_SESSION_REUSED",
    );
    const sessionReuse = await runExactCommand(
      runtime,
      workspace,
      sessionReuseCommand,
      "binary-approval-session-reuse",
      approvedSession.threadId,
    );
    assert(
      !sessionReuse.some((event) => event.kind === "approval-request") &&
        readFileSync(approvalSessionPath, "utf-8") ===
          "BINARY_APPROVAL_SESSION_REUSED",
      "Binary session approval was not reused on the same native session",
    );

    await runtime.setPermissionMode("bypass");
    const currentSettings = getAgentSettings();
    saveAgentSettings({
      ...currentSettings,
      sandboxEnabled: false,
      sandboxMode: "danger-full-access",
    });
    await runExactCommand(
      runtime,
      workspace,
      powershellWrite(dangerPath, "BINARY_DANGER_OK"),
      "binary-danger-write",
    );
    assert(
      existsSync(dangerPath) &&
        readFileSync(dangerPath, "utf-8") === "BINARY_DANGER_OK",
      "Codex binary danger-full-access command did not run directly",
    );
    console.info("Binary model conversation: ok");
    console.info(
      "Binary workspace boundary: allowed inside / denied outside and .git",
    );
    console.info(
      "Binary danger boundary: outside write allowed after explicit disable",
    );
    console.info("Binary approvals: deny / once / session reuse all verified");
    console.info("binary live smoke ok");
  } finally {
    removeFileIfPresent(outsideDeniedPath);
    removeFileIfPresent(approvalDeniedPath);
    removeFileIfPresent(approvalOncePath);
    removeFileIfPresent(approvalSessionPath);
    removeFileIfPresent(dangerPath);
    await destroyRuntime().catch(() => undefined);
    await stopGateway().catch(() => undefined);
    closeStateDbForTests();
  }
}

async function runSessionPermissionGrant(input: {
  runtime: AgentRuntime;
  cwd: string;
  command: string;
  writablePath: string;
  title: string;
}): Promise<{
  events: RuntimeEvent[];
  threadId: string;
  approvalCount: number;
  allowSession: boolean;
}> {
  const threadId = (await input.runtime.createThread(input.title)).id;
  const writablePath = input.writablePath.replace(/\\/g, "/");
  const stream = await input.runtime.sendMessage({
    threadId,
    turnId: `${input.title}-${Date.now()}`,
    cwd: input.cwd,
    content:
      "严格按两步执行。第一步只调用 request_permissions，请求 file_system.write 数组中唯一的绝对路径：" +
      writablePath +
      "。reason 简短说明测试会话级写权限。获得授权后，第二步只调用 exec_command 一次，" +
      "不要设置 sandbox_permissions，cmd 必须逐字等于下一行：\n" +
      input.command +
      "\n等待命令完成并报告真实结果。",
  });
  const events: RuntimeEvent[] = [];
  let approvalCount = 0;
  let allowSession = false;
  for await (const event of stream) {
    events.push(event);
    if (event.kind !== "approval-request") continue;
    approvalCount += 1;
    allowSession ||= Boolean(event.payload.allowSession);
    assert(
      event.payload.toolName === "Permissions",
      `Expected Permissions approval, got ${event.payload.toolName}`,
    );
    input.runtime.respondApproval(event.payload.requestId, true, "session");
  }
  assertSuccessfulTurn(input.title, events);
  return { events, threadId, approvalCount, allowSession };
}

async function runApprovalCommand(input: {
  runtime: AgentRuntime;
  cwd: string;
  command: string;
  title: string;
  approved: boolean;
  scope: "once" | "session";
  threadId?: string;
  failOnApproval?: boolean;
  prefixRule?: string[];
}): Promise<{
  events: RuntimeEvent[];
  threadId: string;
  approvalCount: number;
  allowSession: boolean;
}> {
  const threadId =
    input.threadId ?? (await input.runtime.createThread(input.title)).id;
  const stream = await input.runtime.sendMessage({
    threadId,
    turnId: `${input.title}-${Date.now()}`,
    cwd: input.cwd,
    content:
      "必须调用 exec_command 一次，cmd 必须逐字等于下一行，不得改写，也不得使用其他工具。" +
      "该路径位于工作区外，必须设置 sandbox_permissions=require_escalated，并提供简短 justification：\n" +
      input.command +
      (input.prefixRule
        ? `\nprefix_rule 必须逐项等于：${JSON.stringify(input.prefixRule)}`
        : "") +
      "\n等待工具完成，然后简短报告真实退出结果。",
  });
  const events: RuntimeEvent[] = [];
  let approvalCount = 0;
  let allowSession = false;
  for await (const event of stream) {
    events.push(event);
    if (event.kind !== "approval-request") continue;
    approvalCount += 1;
    allowSession ||= Boolean(event.payload.allowSession);
    if (input.failOnApproval) {
      input.runtime.respondApproval(event.payload.requestId, false, "once");
      throw new Error(`${input.title} unexpectedly requested another approval`);
    }
    input.runtime.respondApproval(
      event.payload.requestId,
      input.approved,
      input.scope,
      input.approved ? undefined : "live smoke denial",
    );
  }
  assertSuccessfulTurn(input.title, events);
  return { events, threadId, approvalCount, allowSession };
}

async function runExactCommand(
  runtime: AgentRuntime,
  cwd: string,
  command: string,
  title: string,
  threadId?: string,
): Promise<RuntimeEvent[]> {
  const activeThreadId = threadId ?? (await runtime.createThread(title)).id;
  const stream = await runtime.sendMessage({
    threadId: activeThreadId,
    turnId: `${title}-${Date.now()}`,
    cwd,
    content:
      "必须调用 shell 工具一次，command 必须逐字等于下一行，不得改写，也不得使用其他工具：\n" +
      command +
      "\n等待工具完成，然后简短报告真实退出结果。",
  });
  const events: RuntimeEvent[] = [];
  for await (const event of stream) {
    events.push(event);
    if (event.kind === "approval-request") {
      runtime.respondApproval(event.payload.requestId, false, "once");
      throw new Error("bypassPermissions unexpectedly requested approval");
    }
  }
  assertSuccessfulTurn(title, events);
  return events;
}

function assertSuccessfulTurn(title: string, events: RuntimeEvent[]): void {
  const completed = events.find((event) => event.kind === "turn-complete");
  if (
    completed?.kind !== "turn-complete" ||
    completed.payload.result !== "success"
  ) {
    console.error(`${title} event summary:`, summarizeEvents(events));
  }
  assert(
    completed?.kind === "turn-complete" &&
      completed.payload.result === "success",
    `${title} did not complete successfully`,
  );
}

function removeFileIfPresent(path: string): void {
  if (existsSync(path)) unlinkSync(path);
}

function summarizeEvents(events: RuntimeEvent[]): string {
  return events
    .map((event) => {
      if (event.kind === "error") {
        return `error:${event.payload.code}:${event.payload.message.slice(0, 300)}`;
      }
      if (event.kind === "turn-complete") {
        return `turn-complete:${event.payload.result}:${event.payload.error ?? ""}`;
      }
      if (event.kind === "approval-request") {
        return `approval-request:${event.payload.toolName}`;
      }
      if (event.kind === "tool-start") {
        return `tool-start:${event.payload.toolName}`;
      }
      if (event.kind === "tool-complete") {
        return `tool-complete:${event.payload.isError ? "error" : "ok"}`;
      }
      return event.kind;
    })
    .join(" | ");
}

function binarySettings(
  settings: AgentSettings,
  provider: ModelProviderConfig,
): AgentSettings {
  return {
    ...settings,
    activeRuntimeId: "binary",
    providers: [provider],
    defaultModel: {
      providerId: provider.id,
      modelId: provider.models[0].id,
    },
    workMode: "execute",
    permissionMode: "bypassPermissions",
    sandboxEnabled: true,
    sandboxMode: "workspace-write",
  };
}

function loadCcSwitchProvider(): {
  apiKey: string;
  provider: ModelProviderConfig;
} {
  const path = join(homedir(), ".claude", "settings.json");
  const parsed = JSON.parse(readFileSync(path, "utf-8")) as {
    env?: Record<string, unknown>;
  };
  const env = parsed.env ?? {};
  const apiKey =
    stringValue(env.ANTHROPIC_AUTH_TOKEN) ?? stringValue(env.ANTHROPIC_API_KEY);
  const baseUrl = stringValue(env.ANTHROPIC_BASE_URL);
  const model =
    stringValue(env.ANTHROPIC_MODEL) ??
    stringValue(env.ANTHROPIC_DEFAULT_SONNET_MODEL) ??
    stringValue(env.ANTHROPIC_DEFAULT_HAIKU_MODEL) ??
    stringValue(env.ANTHROPIC_DEFAULT_OPUS_MODEL);
  if (!apiKey || !baseUrl || !model) {
    throw new Error("cc-switch Claude provider is incomplete");
  }
  return {
    apiKey,
    provider: {
      id: "cc-switch-binary-live",
      name: "cc-switch Binary Live",
      type: "anthropic",
      enabled: true,
      baseUrl,
      apiKeyEnv: "CCSWITCH_BINARY_LIVE_API_KEY",
      purpose: "test",
      models: [{ id: model, label: model, enabled: true }],
    },
  };
}

function powershellWrite(path: string, content: string): string {
  const target = path.replace(/\\/g, "/").replace(/'/g, "''");
  return `Set-Content -LiteralPath '${target}' -Value '${content}' -NoNewline`;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
