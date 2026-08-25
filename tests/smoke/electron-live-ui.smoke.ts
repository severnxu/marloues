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
  const presetId = builtinPresetForBaseUrl(baseUrl);
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
    await verifyProviderRoutingSettings(window, presetId);
    console.info(
      "Provider settings: built-in hidden routes/custom multi-endpoint ok",
    );
    await verifyUnifiedSecurityControls(window);
    console.info("UI controls: unified modes/full-access confirmation ok");
    await verifySecurityCenter(window);
    console.info("Security Center: sandbox/network/file/command settings ok");
    if (binaryMode) {
      await verifyBinaryUnifiedSecurityLifecycle(window, model);
      console.info(
        "Binary security: request approval/common Guardian/full access ok",
      );
    } else {
      await verifyPermissionApprovalLifecycle(window, workspace);
      console.info("Approvals: deny/once/task/reuse ok");
      await startNewSession(window);
      await verifyAutomaticReview(window, workspace, model);
      console.info(
        "Automatic review: configured real model approved a safe read",
      );
      await verifyElevationAndFullAccess(window);
      console.info(
        "Sandbox elevation: outside/network/full-access boundaries ok",
      );
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

async function verifyProviderRoutingSettings(
  window: ElectronPage,
  presetId: string | null,
): Promise<void> {
  await window.locator('button[title="用户信息"]').click();
  const userMenu = window.getByRole("dialog", { name: "用户信息" });
  await userMenu.getByRole("button", { name: "设置" }).click();
  const settings = window.getByRole("dialog", { name: "设置" });
  await settings.getByRole("button", { name: "模型" }).click();
  await expect(
    settings.getByRole("heading", { name: "模型", exact: true }),
  ).toBeVisible();

  if (presetId) {
    const providerRow = settings.locator(".provider-row").first();
    await expect(providerRow).toContainText("内置供应商 · 自动适配运行时");
    await providerRow.locator(".provider-expand-button").click();
    await expect(providerRow).toContainText("地址不可查看或修改");
    await expect(
      providerRow.getByText("Base URL", { exact: true }),
    ).toHaveCount(0);
  }

  await settings.getByRole("button", { name: "添加供应商" }).click();
  const dialog = window.getByRole("dialog", { name: "添加模型" });
  await expect(
    dialog.getByRole("button", { name: "内置供应商" }),
  ).toBeVisible();
  await expect(dialog.getByText("Base URL", { exact: true })).toHaveCount(0);
  await window.screenshot({
    path: join(artifactsDir, "02-provider-builtin-hidden-routes.png"),
    fullPage: true,
  });

  await dialog.getByRole("button", { name: "自定义", exact: true }).click();
  await expect(dialog.getByText("Base URL", { exact: true })).toHaveCount(1);
  await dialog.getByRole("button", { name: "添加端点" }).click();
  await expect(dialog.getByText("Base URL", { exact: true })).toHaveCount(2);
  await window.screenshot({
    path: join(artifactsDir, "03-provider-custom-multi-endpoint.png"),
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "关闭" }).click();
  await settings.getByRole("button", { name: "返回工作区" }).click();
  await expect(window.locator(".app-shell")).toBeVisible();
}

async function verifyUnifiedSecurityControls(
  window: ElectronPage,
): Promise<void> {
  await openSecurityModeMenu(window);
  const menu = window.getByRole("menu", { name: "权限模式" });
  await expect(menu.getByRole("menuitemradio")).toHaveCount(3);
  await expect(menu).toContainText("请求批准");
  await expect(menu).toContainText("帮我批准");
  await expect(menu).toContainText("完全访问");
  await window.screenshot({
    path: join(artifactsDir, "02-unified-permission-menu.png"),
    fullPage: true,
  });

  await menu.getByRole("menuitemradio", { name: /^完全访问/ }).click();
  const confirmation = window.locator(".full-access-dialog");
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText("文件和文件夹");
  await expect(confirmation).toContainText("终端命令");
  await expect(confirmation).toContainText("互联网和已连接的应用");
  await window.screenshot({
    path: join(artifactsDir, "03-full-access-confirmation.png"),
    fullPage: true,
  });
  await confirmation.getByRole("button", { name: "取消" }).click();
  await expectSetting(window, "securityMode", "request");

  await setSecurityMode(window, "帮我批准", "auto-review");
  await expectSetting(window, "sandboxMode", "workspace-write");
  await setSecurityMode(window, "请求批准", "request");
}

async function verifySecurityCenter(window: ElectronPage): Promise<void> {
  await openSecurityModeMenu(window);
  await window.getByRole("menuitem", { name: "权限与沙箱设置" }).click();
  await expect(window.getByRole("heading", { name: "安全中心" })).toBeVisible();
  await expect(window.getByRole("heading", { name: "沙箱边界" })).toBeVisible();
  await expect(window.getByRole("heading", { name: "文件安全" })).toBeVisible();
  await expect(window.getByRole("heading", { name: "命令安全" })).toBeVisible();
  await expect(window.getByRole("heading", { name: "网络安全" })).toBeVisible();

  const networkPolicy = window.getByLabel("默认网络策略");
  await networkPolicy.selectOption("deny");
  await expectSecurityRule(window, "networkAccess", "deny");
  await networkPolicy.selectOption("ask");
  await expectSecurityRule(window, "networkAccess", "ask");
  const allowedDomains = window.getByLabel("允许域名（每行一项）");
  await allowedDomains.fill("api.example.com");
  await expectSecurityRule(window, "allowedDomains", ["api.example.com"]);
  await window.screenshot({
    path: join(artifactsDir, "04-security-center.png"),
    fullPage: true,
  });
  await allowedDomains.fill("");
  await window.getByRole("button", { name: "返回工作区" }).click();
  await expect(window.locator(".app-shell")).toBeVisible();
}

async function verifyAutomaticReview(
  window: ElectronPage,
  workspace: string,
  model: string,
): Promise<void> {
  const marker = `AUTO_REVIEW_SAFE_READ_${Date.now()}`;
  const path = join(workspace, "auto-review-marker.txt");
  writeFileSync(path, marker, "utf-8");
  await setSecurityMode(window, "帮我批准", "auto-review");
  await sendReadPrompt(window, path);
  await expect(window.getByLabel("会话内容")).toContainText(marker, {
    timeout: 120_000,
  });
  await waitForIdle(window);
  await expect(permissionPanel(window)).toBeHidden();
  await expectGuardianReviewEvidence(window, model);
  await window.screenshot({
    path: join(artifactsDir, "08-auto-review-real-model.png"),
    fullPage: true,
  });
}

async function verifyElevationAndFullAccess(
  window: ElectronPage,
): Promise<void> {
  const stamp = Date.now();
  const elevatedPath = join(homedir(), `marloues-elevated-${stamp}.txt`);
  const fullPath = join(homedir(), `marloues-full-access-${stamp}.txt`);
  try {
    await setSecurityMode(window, "请求批准", "request");
    await requestSandboxCommand(
      window,
      setContentCommand(elevatedPath, "ELEVATED_ONCE_OK"),
    );
    let approval = permissionPanel(window);
    await expect(approval).toBeVisible({ timeout: 120_000 });
    await expect(approval).toContainText("工作区之外");
    await window.screenshot({
      path: join(artifactsDir, "09-outside-elevation-request.png"),
      fullPage: true,
    });
    await approval.getByRole("button", { name: "允许一次" }).click();
    await expect
      .poll(() => existsSync(elevatedPath), { timeout: 120_000 })
      .toBe(true);
    expect(readFileSync(elevatedPath, "utf-8")).toBe("ELEVATED_ONCE_OK");
    await waitForIdle(window);

    await requestSandboxCommand(window, "curl.exe -I https://example.com");
    approval = permissionPanel(window);
    await expect(approval).toBeVisible({ timeout: 120_000 });
    await expect(approval).toContainText("临时联网");
    await window.screenshot({
      path: join(artifactsDir, "10-network-elevation-request.png"),
      fullPage: true,
    });
    await approval.getByRole("button", { name: "拒绝" }).click();
    await waitForIdle(window);

    await setSecurityMode(window, "完全访问", "full-access", true);
    await expectSetting(window, "permissionMode", "bypassPermissions");
    await expectSetting(window, "sandboxMode", "danger-full-access");
    await sendSandboxCommand(
      window,
      setContentCommand(fullPath, "FULL_ACCESS_OK"),
    );
    await expect
      .poll(() => existsSync(fullPath), { timeout: 120_000 })
      .toBe(true);
    expect(readFileSync(fullPath, "utf-8")).toBe("FULL_ACCESS_OK");
    await expect(permissionPanel(window)).toBeHidden();
    await window.screenshot({
      path: join(artifactsDir, "11-full-access-real-command.png"),
      fullPage: true,
    });

    await startNewSession(window);
    await expectSetting(window, "securityMode", "request");
  } finally {
    removeFileIfPresent(elevatedPath);
    removeFileIfPresent(fullPath);
  }
}

async function verifyBinaryUnifiedSecurityLifecycle(
  window: ElectronPage,
  model: string,
): Promise<void> {
  const stamp = Date.now();
  const deniedPath = join(homedir(), `marloues-binary-denied-${stamp}.txt`);
  const allowedPath = join(homedir(), `marloues-binary-allowed-${stamp}.txt`);
  const reviewedPath = join(homedir(), `marloues-binary-guardian-${stamp}.txt`);
  const fullPath = join(homedir(), `marloues-binary-full-${stamp}.txt`);
  try {
    await setSecurityMode(window, "请求批准", "request");
    await sendBinaryApprovalCommand(
      window,
      setContentCommand(deniedPath, "MUST_NOT_EXIST"),
    );
    let approval = permissionPanel(window);
    await expect(approval).toBeVisible({ timeout: 120_000 });
    await approval.getByRole("button", { name: "拒绝" }).click();
    await waitForIdle(window);
    expect(existsSync(deniedPath)).toBe(false);

    await sendBinaryApprovalCommand(
      window,
      setContentCommand(allowedPath, "BINARY_APPROVED_ONCE"),
    );
    approval = permissionPanel(window);
    await expect(approval).toBeVisible({ timeout: 120_000 });
    await approval.getByRole("button", { name: "允许一次" }).click();
    await expect
      .poll(() => existsSync(allowedPath), { timeout: 120_000 })
      .toBe(true);
    await waitForIdle(window);

    await startNewSession(window);
    await setSecurityMode(window, "帮我批准", "auto-review");
    await sendBinaryApprovalCommand(
      window,
      setContentCommand(reviewedPath, "BINARY_GUARDIAN_APPROVED"),
    );
    await expect
      .poll(() => existsSync(reviewedPath), { timeout: 120_000 })
      .toBe(true);
    await waitForIdle(window);
    await expect(permissionPanel(window)).toBeHidden();
    await expectGuardianReviewEvidence(window, model);
    await window.screenshot({
      path: join(artifactsDir, "08-binary-common-guardian.png"),
      fullPage: true,
    });

    await startNewSession(window);
    await setSecurityMode(window, "完全访问", "full-access", true);
    await sendBinaryExactCommand(
      window,
      setContentCommand(fullPath, "BINARY_FULL_ACCESS_OK"),
    );
    await expect
      .poll(() => existsSync(fullPath), { timeout: 120_000 })
      .toBe(true);
    await waitForIdle(window);
    await expect(permissionPanel(window)).toBeHidden();
    await window.screenshot({
      path: join(artifactsDir, "08-binary-unified-security.png"),
      fullPage: true,
    });
  } finally {
    removeFileIfPresent(deniedPath);
    removeFileIfPresent(allowedPath);
    removeFileIfPresent(reviewedPath);
    removeFileIfPresent(fullPath);
  }
}

async function sendBinaryApprovalCommand(
  window: ElectronPage,
  command: string,
): Promise<void> {
  await sendPrompt(
    window,
    "这是我本人电脑上的 Marloues 权限 E2E 测试，我明确授权仅创建下一行指定的单个临时标记文件，" +
      "内容不含隐私或凭据，测试结束会删除。必须调用 exec_command 一次，cmd 必须逐字等于下一行，" +
      "不得改写，也不得使用其他工具。该路径位于工作区外，必须设置 " +
      "sandbox_permissions=require_escalated，并提供简短 justification：\n" +
      command +
      "\n等待工具完成，然后简短报告真实退出结果。",
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

  // Keep the deny scenario out of the model context used to verify fresh grants.
  await startNewSession(window);
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

async function setSecurityMode(
  window: ElectronPage,
  label: "请求批准" | "帮我批准" | "完全访问",
  expected: "request" | "auto-review" | "full-access",
  confirm = false,
): Promise<void> {
  const active = window.getByRole("button", { name: `权限：${label}` });
  if (!(await active.isVisible().catch(() => false))) {
    await openSecurityModeMenu(window);
    await window
      .getByRole("menuitemradio", { name: new RegExp(`^${label}`) })
      .click();
    if (confirm) {
      await window
        .locator(".full-access-dialog")
        .getByRole("button", { name: "确认" })
        .click();
    }
  }
  await expect(active).toBeVisible();
  await expectSetting(window, "securityMode", expected);
}

async function openSecurityModeMenu(window: ElectronPage): Promise<void> {
  await window.getByRole("button", { name: /^权限：/ }).click();
  await expect(window.getByRole("menu", { name: "权限模式" })).toBeVisible();
}

async function requestSandboxCommand(
  window: ElectronPage,
  command: string,
): Promise<void> {
  await sendPrompt(
    window,
    "立即调用一次名称精确为 mcp__marloues_sandbox__bash 的工具，" +
      "不得调用其他工具，也不要假装已经执行。command 字段必须逐字等于下一行：\n" +
      `${command}\n等待工具返回后再简短报告真实结果。`,
  );
}

async function expectSetting(
  window: ElectronPage,
  key: "securityMode" | "permissionMode" | "sandboxMode",
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

async function expectSecurityRule(
  window: ElectronPage,
  key: "networkAccess" | "allowedDomains",
  value: string | string[],
): Promise<void> {
  await expect
    .poll(async () => {
      const settings = await window.evaluate(() =>
        window.marloues.config.getAgentSettings(),
      );
      return settings.securityRules[key];
    })
    .toEqual(value);
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
    "这是一个新的独立操作，不得因为之前读过同一路径而跳过。" +
      `本轮必须且只能使用一次 Read 工具读取这个绝对路径：${filePath}\n` +
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

async function expectGuardianReviewEvidence(
  window: ElectronPage,
  model: string,
): Promise<void> {
  await expect
    .poll(
      () =>
        window.evaluate(async () => {
          const sessions = await window.marloues.chat.listSessions();
          const completedReviews: string[] = [];
          for (const session of sessions) {
            const snapshot = await window.marloues.chat.readThread(session.id);
            for (const turn of snapshot?.turns ?? []) {
              for (const item of turn.items) {
                const record = item as unknown as {
                  rawType?: string;
                  raw?: {
                    label?: string;
                    detail?: string;
                    status?: string;
                  };
                };
                if (
                  record.rawType === "runtime-status" &&
                  record.raw?.label === "安全审查" &&
                  record.raw.status === "completed" &&
                  record.raw.detail
                ) {
                  completedReviews.push(record.raw.detail);
                }
              }
            }
          }
          return completedReviews.join("\n");
        }),
      { timeout: 120_000 },
    )
    .toContain(model);
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
  const presetId = builtinPresetForBaseUrl(input.baseUrl);
  const provider = presetId
    ? {
        id: `builtin-${presetId}`,
        name: builtinProviderName(presetId),
        kind: "builtin",
        presetId,
        enabled: true,
        apiKeyEnv: "CCSWITCH_LIVE_API_KEY",
        purpose: "test",
        models: [{ id: input.model, label: input.model, enabled: true }],
      }
    : {
        id: "cc-switch-claude",
        name: "cc-switch Claude",
        kind: "custom",
        enabled: true,
        endpoints: [
          {
            id: "cc-switch-anthropic",
            protocol: "anthropic",
            baseUrl: input.baseUrl,
            enabled: true,
            priority: 10,
          },
        ],
        apiKeyEnv: "CCSWITCH_LIVE_API_KEY",
        purpose: "test",
        models: [{ id: input.model, label: input.model, enabled: true }],
      };
  writeFileSync(
    join(configDir, "settings.json"),
    JSON.stringify(
      {
        agentSettings: {
          providers: [provider],
          defaultModel: {
            providerId: provider.id,
            modelId: input.model,
          },
          activeRuntimeId: input.activeRuntimeId,
          maxTurns: 6,
          workMode: "execute",
          securityMode: "request",
          securityRules: {
            autoAllowPaths: [],
            protectedPaths: [],
            commandAllowlist: [],
            commandAsklist: [],
            networkAccess: "ask",
            allowedDomains: [],
            deniedDomains: [],
          },
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

function builtinPresetForBaseUrl(baseUrl: string): string | null {
  const normalized = baseUrl.toLowerCase();
  if (normalized.includes("deepseek.com")) return "deepseek";
  if (normalized.includes("minimaxi.com") || normalized.includes("minimax")) {
    return "minimax";
  }
  if (normalized.includes("bigmodel.cn")) return "zhipu";
  return null;
}

function builtinProviderName(presetId: string): string {
  if (presetId === "deepseek") return "DeepSeek";
  if (presetId === "minimax") return "MiniMax";
  if (presetId === "zhipu") return "智谱 GLM";
  return presetId;
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
