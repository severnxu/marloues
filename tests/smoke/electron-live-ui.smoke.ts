import {
  _electron as electron,
  expect,
} from "../../client/node_modules/@playwright/test";
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

const repoRoot = join(__dirname, "..", "..");
const mainEntry = join(repoRoot, "client", "out", "main", "index.js");
const binaryMode = process.argv.includes("--binary");
const artifactsDir = join(
  repoRoot,
  "test-artifacts",
  binaryMode ? "electron-binary-live-ui" : "electron-live-ui",
);

interface ClaudeSettingsFile {
  env?: Record<string, unknown>;
}

type ElectronPage = Awaited<
  ReturnType<typeof electron.launch>
>["windows"][number];

async function main(): Promise<void> {
  if (!existsSync(mainEntry)) {
    throw new Error(
      "Electron main bundle is missing. Run npm run build first.",
    );
  }

  const { apiKey, baseUrl, model } = loadCcSwitchClaudeSettings();
  const liveHome = mkdtempSync(join(tmpdir(), "marloues-electron-live-"));
  const workspace = join(liveHome, "workspace");
  const configDir = join(liveHome, "config");
  mkdirSync(workspace, { recursive: true });
  mkdirSync(configDir, { recursive: true });
  mkdirSync(artifactsDir, { recursive: true });

  writeLiveSettings(configDir, {
    baseUrl,
    model,
    activeRuntimeId: binaryMode ? "binary" : "sdk",
  });
  writeWorkspaceSettings(configDir, workspace);

  process.env.CCSWITCH_LIVE_API_KEY = apiKey;

  console.info(
    `=== Marloues Electron ${binaryMode ? "Binary" : "SDK"} live UI smoke ===`,
  );
  console.info(`Home:     ${liveHome}`);
  console.info("Provider: cc-switch Claude");
  console.info(`Model:    ${model}`);

  const app = await electron.launch({
    args: [mainEntry],
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      MARLOUES_HOME: liveHome,
      CCSWITCH_LIVE_API_KEY: apiKey,
    },
  });

  try {
    const window = await app.firstWindow();
    await window.setViewportSize({ width: 1440, height: 980 });
    await expect(window).toHaveTitle(/Marloues/);
    await completeOnboarding(window);
    await expect(window.locator(".app-shell")).toBeVisible();
    await window.screenshot({
      path: join(artifactsDir, "01-shell-ready.png"),
      fullPage: true,
    });
    await verifyIndependentControls(window);
    console.info("UI controls: permission/sandbox independence ok");
    if (binaryMode) {
      await verifyBinarySecurityLifecycle(window, workspace);
      console.info("Binary approvals: deny/once/session/reuse ok");
      console.info("Binary sandbox UI: workspace/danger boundaries ok");
    } else {
      await verifyPermissionApprovalLifecycle(window, workspace);
      console.info("Approvals: deny/once/task/reuse ok");
      await startNewSession(window);
      await setAccessMode(window, "免审批", "bypassPermissions");
      await verifySandboxLifecycle(window, workspace);
      console.info("Sandbox UI: workspace/read-only/danger boundaries ok");
    }
    console.info("electron live UI smoke ok");
    console.info(`Evidence: ${artifactsDir}`);
  } catch (error) {
    const [window] = app.windows();
    if (window) {
      await window
        .screenshot({
          path: join(artifactsDir, "99-failure.png"),
          fullPage: true,
        })
        .catch(() => undefined);
    }
    throw error;
  } finally {
    await app.close();
  }
}

async function verifyBinarySecurityLifecycle(
  window: ElectronPage,
  _workspace: string,
): Promise<void> {
  const stamp = `${Date.now()}`;
  const deniedPath = join(homedir(), `marloues-ui-binary-denied-${stamp}.txt`);
  const oncePath = join(homedir(), `marloues-ui-binary-once-${stamp}.txt`);
  const sessionPath = join(
    homedir(),
    `marloues-ui-binary-session-${stamp}.txt`,
  );
  const workspaceDeniedPath = join(
    homedir(),
    `marloues-ui-binary-sandbox-denied-${stamp}.txt`,
  );
  const dangerPath = join(homedir(), `marloues-ui-binary-danger-${stamp}.txt`);

  try {
    await setAccessMode(window, "默认权限", "default");
    await setSandboxMode(window, "工作区沙箱", "workspace-write");

    await sendBinaryApprovalCommand(
      window,
      setContentCommand(deniedPath, "MUST_NOT_EXIST"),
    );
    let approval = permissionPanel(window);
    await expect(approval).toBeVisible({ timeout: 120_000 });
    await expect(approval).toContainText("Set-Content");
    await window.screenshot({
      path: join(artifactsDir, "04-binary-approval-deny-request.png"),
      fullPage: true,
    });
    await approval.getByRole("button", { name: "拒绝" }).click();
    await waitForIdle(window);
    expect(existsSync(deniedPath)).toBe(false);

    await sendBinaryApprovalCommand(
      window,
      setContentCommand(oncePath, "BINARY_UI_APPROVAL_ONCE_OK"),
    );
    approval = permissionPanel(window);
    await expect(approval).toBeVisible({ timeout: 120_000 });
    await approval.getByRole("button", { name: "允许一次" }).click();
    await expect
      .poll(() => existsSync(oncePath), { timeout: 120_000 })
      .toBe(true);
    await waitForIdle(window);
    expect(readFileSync(oncePath, "utf-8")).toBe("BINARY_UI_APPROVAL_ONCE_OK");
    await window.screenshot({
      path: join(artifactsDir, "05-binary-approval-once-result.png"),
      fullPage: true,
    });

    writeFileSync(sessionPath, "BINARY_UI_SESSION_SEED", "utf-8");
    await sendBinarySessionGrant(
      window,
      sessionPath,
      setContentCommand(sessionPath, "BINARY_UI_SESSION_OK"),
    );
    approval = permissionPanel(window);
    await expect(approval).toBeVisible({ timeout: 120_000 });
    await expect(approval).toContainText("Permissions");
    await approval.getByRole("button", { name: "允许此任务" }).click();
    await expect
      .poll(() => readFileSync(sessionPath, "utf-8"), { timeout: 120_000 })
      .toBe("BINARY_UI_SESSION_OK");
    await waitForIdle(window);

    await sendBinaryExactCommand(
      window,
      setContentCommand(sessionPath, "BINARY_UI_SESSION_REUSED"),
    );
    await expect
      .poll(() => readFileSync(sessionPath, "utf-8"), { timeout: 120_000 })
      .toBe("BINARY_UI_SESSION_REUSED");
    await waitForIdle(window);
    await expect(permissionPanel(window)).toBeHidden();
    await window.screenshot({
      path: join(artifactsDir, "06-binary-session-grant-reused.png"),
      fullPage: true,
    });

    await startNewSession(window);
    await setAccessMode(window, "免审批", "bypassPermissions");
    await expectSetting(window, "sandboxMode", "workspace-write");
    await sendBinaryExactCommand(
      window,
      setContentCommand(workspaceDeniedPath, "MUST_NOT_EXIST"),
    );
    await waitForIdle(window);
    expect(existsSync(workspaceDeniedPath)).toBe(false);
    await window.screenshot({
      path: join(artifactsDir, "07-binary-workspace-outside-denied.png"),
      fullPage: true,
    });

    await openSandboxMenu(window);
    await window.getByRole("menuitemradio", { name: "关闭沙箱" }).click();
    const confirmation = window.locator(".sandbox-gate-prompt");
    await expect(confirmation).toBeVisible();
    await window.screenshot({
      path: join(artifactsDir, "08-binary-danger-confirmation.png"),
      fullPage: true,
    });
    await confirmation.getByRole("button", { name: "确认关闭" }).click();
    await expectSetting(window, "sandboxMode", "danger-full-access");
    await expectSetting(window, "permissionMode", "bypassPermissions");
    await sendBinaryExactCommand(
      window,
      setContentCommand(dangerPath, "BINARY_UI_DANGER_OK"),
    );
    await expect
      .poll(() => existsSync(dangerPath), { timeout: 120_000 })
      .toBe(true);
    await waitForIdle(window);
    expect(readFileSync(dangerPath, "utf-8")).toBe("BINARY_UI_DANGER_OK");
    expect(existsSync(workspaceDeniedPath)).toBe(false);
    await window.screenshot({
      path: join(artifactsDir, "09-binary-danger-write-allowed.png"),
      fullPage: true,
    });
  } finally {
    removeFileIfPresent(deniedPath);
    removeFileIfPresent(oncePath);
    removeFileIfPresent(sessionPath);
    removeFileIfPresent(workspaceDeniedPath);
    removeFileIfPresent(dangerPath);
  }
}

async function sendBinaryApprovalCommand(
  window: ElectronPage,
  command: string,
): Promise<void> {
  await sendPrompt(
    window,
    "必须调用 exec_command 一次，cmd 必须逐字等于下一行，不得改写，也不得使用其他工具。" +
      "该路径位于工作区外，必须设置 sandbox_permissions=require_escalated，并提供简短 justification：\n" +
      command +
      "\n等待工具完成，然后简短报告真实退出结果。",
  );
}

async function sendBinarySessionGrant(
  window: ElectronPage,
  writablePath: string,
  command: string,
): Promise<void> {
  await sendPrompt(
    window,
    "严格按两步执行。第一步只调用 request_permissions，请求 file_system.write 数组中唯一的绝对路径：" +
      writablePath.replaceAll("\\", "/") +
      "。reason 简短说明测试会话级写权限。获得授权后，第二步只调用 exec_command 一次，" +
      "不要设置 sandbox_permissions，cmd 必须逐字等于下一行：\n" +
      command +
      "\n等待命令完成并报告真实结果。",
  );
}

async function sendBinaryExactCommand(
  window: ElectronPage,
  command: string,
): Promise<void> {
  await sendPrompt(
    window,
    "必须调用 shell 工具一次，command 必须逐字等于下一行，不得改写，也不得使用其他工具：\n" +
      command +
      "\n等待工具完成，然后简短报告真实退出结果。",
  );
}

async function verifyIndependentControls(window: ElectronPage): Promise<void> {
  await setAccessMode(window, "自动审查", "acceptEdits");
  await expectSetting(window, "sandboxMode", "workspace-write");

  await setAccessMode(window, "免审批", "bypassPermissions");
  await expectSetting(window, "sandboxMode", "workspace-write");

  await setSandboxMode(window, "只读沙箱", "read-only");
  await expectSetting(window, "permissionMode", "bypassPermissions");
  await setSandboxMode(window, "工作区沙箱", "workspace-write");

  await openSandboxMenu(window);
  await window.getByRole("menuitemradio", { name: "关闭沙箱" }).click();
  const confirmation = window.locator(".sandbox-gate-prompt");
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText("工作区外");
  await window.screenshot({
    path: join(artifactsDir, "02-sandbox-disable-confirmation.png"),
    fullPage: true,
  });
  await confirmation.getByRole("button", { name: "取消" }).click();
  await expectSetting(window, "sandboxMode", "workspace-write");
  await expectSetting(window, "permissionMode", "bypassPermissions");

  await setAccessMode(window, "默认权限", "default");
  await window.screenshot({
    path: join(artifactsDir, "03-independent-controls.png"),
    fullPage: true,
  });
}

async function verifyPermissionApprovalLifecycle(
  window: ElectronPage,
  workspace: string,
): Promise<void> {
  const filePath = join(workspace, "approval-marker.txt");
  const deniedMarker = `READ_DENIED_SECRET_${Date.now()}`;
  writeFileSync(filePath, deniedMarker, "utf-8");
  await sendReadPrompt(window, filePath, "DENIED_ACK");

  let permissionDialog = permissionPanel(window);
  await expect(permissionDialog).toBeVisible({ timeout: 120_000 });
  await expect(permissionDialog).toContainText("Read");
  await window.screenshot({
    path: join(artifactsDir, "04-approval-deny-request.png"),
    fullPage: true,
  });
  await permissionDialog.getByRole("button", { name: "拒绝" }).click();
  await expect(window.getByLabel("会话内容")).toContainText("DENIED_ACK", {
    timeout: 120_000,
  });
  await waitForIdle(window);
  expect(await window.getByLabel("会话内容").innerText()).not.toContain(
    deniedMarker,
  );

  const onceMarker = `READ_ALLOW_ONCE_${Date.now()}`;
  writeFileSync(filePath, onceMarker, "utf-8");
  await sendReadPrompt(window, filePath);
  permissionDialog = permissionPanel(window);
  await expect(permissionDialog).toBeVisible({ timeout: 120_000 });
  await permissionDialog.getByRole("button", { name: "允许一次" }).click();
  await expect(window.getByLabel("会话内容")).toContainText(onceMarker, {
    timeout: 120_000,
  });
  await waitForIdle(window);
  await window.screenshot({
    path: join(artifactsDir, "05-approval-once-result.png"),
    fullPage: true,
  });

  const sessionMarker = `READ_ALLOW_TASK_${Date.now()}`;
  writeFileSync(filePath, sessionMarker, "utf-8");
  await sendReadPrompt(window, filePath);
  permissionDialog = permissionPanel(window);
  await expect(permissionDialog).toBeVisible({ timeout: 120_000 });
  await permissionDialog.getByRole("button", { name: "允许此任务" }).click();
  await expect(window.getByLabel("会话内容")).toContainText(sessionMarker, {
    timeout: 120_000,
  });
  await waitForIdle(window);

  const reusedMarker = `READ_TASK_GRANT_REUSED_${Date.now()}`;
  writeFileSync(filePath, reusedMarker, "utf-8");
  await sendReadPrompt(window, filePath);
  await expect(window.getByLabel("会话内容")).toContainText(reusedMarker, {
    timeout: 120_000,
  });
  await waitForIdle(window);
  await expect(permissionPanel(window)).toBeHidden();
  await window.screenshot({
    path: join(artifactsDir, "06-approval-task-grant-reused.png"),
    fullPage: true,
  });
}

async function verifySandboxLifecycle(
  window: ElectronPage,
  workspace: string,
): Promise<void> {
  const stamp = `${Date.now()}`;
  const insidePath = join(workspace, `sandbox-inside-${stamp}.txt`);
  const outsideDeniedPath = join(
    homedir(),
    `marloues-ui-sandbox-denied-${stamp}.txt`,
  );
  const readOnlyPath = join(workspace, `sandbox-read-only-${stamp}.txt`);
  const dangerPath = join(homedir(), `marloues-ui-danger-${stamp}.txt`);

  await setSandboxMode(window, "工作区沙箱", "workspace-write");
  await sendSandboxCommand(
    window,
    setContentCommand(insidePath, "WORKSPACE_WRITE_OK"),
  );
  await expect.poll(() => existsSync(insidePath)).toBe(true);
  expect(readFileSync(insidePath, "utf-8")).toBe("WORKSPACE_WRITE_OK");
  await window.screenshot({
    path: join(artifactsDir, "07-workspace-write-allowed.png"),
    fullPage: true,
  });

  await sendSandboxCommand(
    window,
    opaqueWriteCommand(outsideDeniedPath, "MUST_NOT_EXIST"),
  );
  expect(existsSync(outsideDeniedPath)).toBe(false);
  await window.screenshot({
    path: join(artifactsDir, "08-workspace-outside-denied.png"),
    fullPage: true,
  });

  await setSandboxMode(window, "只读沙箱", "read-only");
  await sendSandboxCommand(
    window,
    opaqueWriteCommand(readOnlyPath, "MUST_NOT_EXIST"),
  );
  expect(existsSync(readOnlyPath)).toBe(false);
  await window.screenshot({
    path: join(artifactsDir, "09-read-only-write-denied.png"),
    fullPage: true,
  });

  await openSandboxMenu(window);
  await window.getByRole("menuitemradio", { name: "关闭沙箱" }).click();
  const confirmation = window.locator(".sandbox-gate-prompt");
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "确认关闭" }).click();
  await expectSetting(window, "sandboxMode", "danger-full-access");
  await expectSetting(window, "permissionMode", "bypassPermissions");
  await sendSandboxCommand(
    window,
    opaqueWriteCommand(dangerPath, "DANGER_WRITE_OK"),
  );
  await expect.poll(() => existsSync(dangerPath)).toBe(true);
  expect(readFileSync(dangerPath, "utf-8")).toBe("DANGER_WRITE_OK");
  await window.screenshot({
    path: join(artifactsDir, "10-danger-write-allowed.png"),
    fullPage: true,
  });
  unlinkSync(dangerPath);
}

async function setAccessMode(
  window: ElectronPage,
  label: "默认权限" | "自动审查" | "免审批",
  expected: "default" | "acceptEdits" | "bypassPermissions",
): Promise<void> {
  const active = window.getByRole("button", { name: `权限：${label}` });
  if (!(await active.isVisible().catch(() => false))) {
    await window.getByRole("button", { name: /^权限：/ }).click();
    await window.getByRole("menuitemradio", { name: label }).click();
  }
  await expect(active).toBeVisible();
  await expectSetting(window, "permissionMode", expected);
}

async function setSandboxMode(
  window: ElectronPage,
  label: "只读沙箱" | "工作区沙箱" | "工作区 + 网络",
  expected: "read-only" | "workspace-write" | "workspace-write-network",
): Promise<void> {
  const active = window.getByRole("button", { name: `沙箱：${label}` });
  if (!(await active.isVisible().catch(() => false))) {
    await openSandboxMenu(window);
    await window.getByRole("menuitemradio", { name: label }).click();
  }
  await expect(active).toBeVisible();
  await expectSetting(window, "sandboxMode", expected);
}

async function openSandboxMenu(window: ElectronPage): Promise<void> {
  await window.getByRole("button", { name: /^沙箱：/ }).click();
  await expect(window.getByRole("menu", { name: "沙箱模式" })).toBeVisible();
}

async function expectSetting(
  window: ElectronPage,
  key: "permissionMode" | "sandboxMode",
  value: string,
): Promise<void> {
  await expect
    .poll(async () => {
      const settings = await window.evaluate(() =>
        window.marloues.config.getAgentSettings(),
      );
      return settings[key];
    })
    .toBe(value);
}

function permissionPanel(window: ElectronPage) {
  return window
    .locator(".permission-request-panel")
    .filter({ hasText: "权限确认" });
}

async function sendReadPrompt(
  window: ElectronPage,
  filePath: string,
  deniedReply?: string,
): Promise<void> {
  const denialInstruction = deniedReply
    ? `如果权限被拒绝，不要重试，只回复 ${deniedReply}。`
    : "批准后只回复文件内容本身，不要解释，不要添加标点。";
  await sendPrompt(
    window,
    `必须且只能使用一次 Read 工具读取这个绝对路径：${filePath}\n` +
      `不要使用其他工具。${denialInstruction}`,
  );
}

async function sendSandboxCommand(
  window: ElectronPage,
  command: string,
): Promise<void> {
  const previousToolCallCount = await sandboxToolCallCount(window);
  await sendPrompt(
    window,
    "立即调用一次名称精确为 mcp__marloues_sandbox__bash 的工具，" +
      "不得调用其他工具，也不要假装已经执行。command 字段必须逐字等于下一行：\n" +
      `${command}\n等待工具返回后再简短报告真实结果。`,
  );
  await expect
    .poll(() => sandboxToolCallCount(window), { timeout: 120_000 })
    .toBeGreaterThan(previousToolCallCount);
  await waitForIdle(window);
}

async function sandboxToolCallCount(window: ElectronPage): Promise<number> {
  return window.evaluate(async () => {
    const sessions = await window.marloues.chat.listSessions();
    let count = 0;
    for (const session of sessions) {
      const snapshot = await window.marloues.chat.readThread(session.id);
      for (const turn of snapshot?.turns ?? []) {
        count += turn.items.filter(
          (item) =>
            item.type === "mcpToolCall" &&
            /marloues_sandbox|mcp__marloues_sandbox__bash/i.test(item.tool),
        ).length;
      }
    }
    return count;
  });
}

async function startNewSession(window: ElectronPage): Promise<void> {
  await window.getByRole("button", { name: /新建会话/ }).click();
  await expect(window.locator(".empty-composer-prompt")).toBeVisible({
    timeout: 30_000,
  });
  await waitForIdle(window);
}

async function sendPrompt(window: ElectronPage, prompt: string): Promise<void> {
  await waitForIdle(window);
  const textarea = window.locator(".composer textarea");
  await expect(textarea).toBeVisible();
  await textarea.fill(prompt);
  await window.getByRole("button", { name: "发送消息" }).click();
}

async function waitForIdle(window: ElectronPage): Promise<void> {
  await expect(window.getByRole("button", { name: "发送消息" })).toBeVisible({
    timeout: 120_000,
  });
  await window.waitForTimeout(500);
}

function opaqueWriteCommand(filePath: string, value: string): string {
  const normalized = filePath.replaceAll("\\", "/");
  return `[System.IO.File]::WriteAllText('${normalized}','${value}')`;
}

function setContentCommand(filePath: string, value: string): string {
  const normalized = filePath.replaceAll("\\", "/");
  return `Set-Content -LiteralPath '${normalized}' -Value '${value}' -NoNewline`;
}

async function completeOnboarding(window: ElectronPage): Promise<void> {
  await expect(
    window.locator(".onboarding-view, .app-shell").first(),
  ).toBeVisible({
    timeout: 30_000,
  });
  const overlay = window.getByRole("dialog", { name: "marloues 初次设置" });
  if (!(await overlay.isVisible().catch(() => false))) return;
  const skipModel = overlay.getByRole("button", { name: "稍后配置" });
  if (await skipModel.isVisible().catch(() => false)) {
    await skipModel.click();
  }
  const start = overlay.getByRole("button", { name: "开始使用" });
  await expect(start).toBeEnabled();
  await start.click();
  await expect(overlay).toBeHidden();
}

function loadCcSwitchClaudeSettings(): {
  apiKey: string;
  baseUrl: string;
  model: string;
} {
  const settingsPath = join(homedir(), ".claude", "settings.json");
  if (!existsSync(settingsPath)) {
    throw new Error(
      "Missing cc-switch Claude settings at ~/.claude/settings.json.",
    );
  }
  const parsed = JSON.parse(
    readFileSync(settingsPath, "utf-8"),
  ) as ClaudeSettingsFile;
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
    throw new Error("cc-switch Claude settings are missing key/baseUrl/model.");
  }
  return { apiKey, baseUrl, model };
}

function writeLiveSettings(
  configDir: string,
  input: {
    baseUrl: string;
    model: string;
    activeRuntimeId: "sdk" | "binary";
  },
): void {
  writeFileSync(
    join(configDir, "settings.json"),
    JSON.stringify(
      {
        agentSettings: {
          providers: [
            {
              id: "cc-switch-claude",
              name: "cc-switch Claude",
              type: "openai-compatible",
              enabled: true,
              baseUrl: input.baseUrl,
              apiKeyEnv: "CCSWITCH_LIVE_API_KEY",
              purpose: "test",
              models: [{ id: input.model, label: input.model, enabled: true }],
            },
          ],
          defaultModel: {
            providerId: "cc-switch-claude",
            modelId: input.model,
          },
          activeRuntimeId: input.activeRuntimeId,
          maxTurns: 6,
          workMode: "execute",
          permissionMode: "default",
          sandboxEnabled: true,
          sandboxMode: "workspace-write",
          permissionApprovalTimeoutMs: 120000,
          desktopNotificationsEnabled: false,
          friendlyTone: false,
          customInstructions: "",
          memoryMode: "workspace",
          autoMemoryEnabled: false,
          thinkingEnabled: false,
          maxThinkingTokens: 0,
          activeToolProfileId: "live-ui-smoke",
          toolPermissionPolicy: {
            rules: [
              { pattern: "Read", action: "ask" },
              { pattern: "Bash", action: "allow" },
            ],
            allowedTools: [],
            disallowedTools: ["AskUserQuestion"],
            sensitiveToolAllowlist: [],
            requireConfirmationForSensitiveTools: true,
          },
          toolProfiles: [],
          mcpServers: [],
          skillDirectories: [],
          disabledSkills: [],
        },
      },
      null,
      2,
    ),
    "utf-8",
  );
}

function writeWorkspaceSettings(configDir: string, workspace: string): void {
  writeFileSync(
    join(configDir, "workspaces.json"),
    JSON.stringify(
      {
        currentWorkspaceId: "electron-live-workspace",
        workspaces: [
          {
            id: "electron-live-workspace",
            name: "electron-live",
            path: workspace,
            lastOpenedAt: Date.now(),
          },
        ],
      },
      null,
      2,
    ),
    "utf-8",
  );
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function removeFileIfPresent(path: string): void {
  if (existsSync(path)) unlinkSync(path);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
