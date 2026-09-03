import { test, expect, _electron as electron } from "@playwright/test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(__dirname, "..", "..");
const mainEntry = join(repoRoot, "client", "out", "main", "index.js");

let testHome: string;

test.beforeAll(() => {
  // 隔离的 MARLOUES_HOME：保证首次启动进入 onboarding 流程，且不污染真实配置
  testHome = mkdtempSync(join(tmpdir(), "marloues-e2e-"));
  // 新版 onboarding 强制先选择工作区（原生目录选择器无法在无头环境驱动）。
  // 预置一个真实存在的工作区并设为 current，「开始使用」即解锁，
  // 测试通过真实点击完成 onboarding，随后进入主界面。
  const workspaceDir = join(testHome, "workspace");
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(join(testHome, "config"), { recursive: true });
  writeFileSync(
    join(testHome, "config", "workspaces.json"),
    JSON.stringify({
      currentWorkspaceId: "e2e-workspace",
      workspaces: [
        {
          id: "e2e-workspace",
          name: "e2e",
          path: workspaceDir,
          lastOpenedAt: Date.now(),
        },
      ],
    }),
    "utf-8",
  );
});

test.afterAll(() => {
  rmSync(testHome, { recursive: true, force: true });
});

async function launchApp() {
  const executablePath = process.env.MARLOUES_E2E_EXECUTABLE;
  const app = await electron.launch({
    ...(executablePath ? { executablePath, args: [] } : { args: [mainEntry] }),
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      MARLOUES_HOME: testHome,
      MARLOUES_REMOTE_DEBUGGING_PORT: "0",
    },
  });
  const window = await app.firstWindow();
  return { app, window };
}

async function completeOnboarding(
  window: Awaited<ReturnType<typeof launchApp>>["window"],
): Promise<void> {
  // 首屏二选一：未完成时是「marloues 初次设置」对话框，已完成（localStorage 持久化）时直接是 shell
  await expect(
    window.locator(".onboarding-view, .app-shell").first(),
  ).toBeVisible();
  const overlay = window.getByRole("dialog", { name: "marloues 初次设置" });
  if (!(await overlay.isVisible().catch(() => false))) return;
  const start = overlay.getByRole("button", { name: "开始使用" });
  await expect(start).toBeEnabled();
  await start.click();
  await expect(overlay).toBeHidden();
}

test("critical smoke: app boots and renders the shell", async () => {
  const { app, window } = await launchApp();
  try {
    await expect(window).toHaveTitle(/Marloues/);
    await expect(window.locator("#root")).not.toBeEmpty();
    await completeOnboarding(window);
    await expect(window.locator(".app-shell")).toBeVisible();
  } finally {
    await app.close();
  }
});

test("settings page opens from sidebar user menu", async () => {
  const { app, window } = await launchApp();
  try {
    await completeOnboarding(window);
    await expect(window.locator(".app-shell")).toBeVisible();
    await window.getByTitle("用户信息").click();
    await window
      .getByRole("dialog", { name: "用户信息" })
      .getByRole("button", { name: "设置" })
      .click();
    const settings = window.getByRole("dialog", { name: "设置" });
    await expect(
      settings.getByRole("navigation", { name: "设置分组" }),
    ).toBeVisible();
    await settings
      .getByRole("navigation", { name: "设置分组" })
      .getByRole("button", { name: "更新" })
      .click();
    await expect(window.locator(".update-settings")).toBeVisible();
    // 重建后的热更新管理页：版本信息 / 更新状态 / 更新通道 / 自动化 / 签名信任
    await expect(window.locator(".update-settings .settings-card")).toHaveCount(
      5,
    );
    await expect(
      window.locator(".update-settings .settings-switch"),
    ).toHaveCount(3);
    await expect(
      window.locator(".update-settings .settings-segmented-options"),
    ).toBeVisible();
    await expect(
      window.locator(".update-settings .settings-chip"),
    ).toBeVisible();
  } finally {
    await app.close();
  }
});
