import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(__dirname, "..", "..");
const mainEntry = join(repoRoot, "client", "out", "main", "index.js");

let testHome: string;

test.beforeAll(() => {
  // 隔离的 MARLOUES_HOME：保证首次启动进入 onboarding 流程，且不污染真实配置
  testHome = mkdtempSync(join(tmpdir(), "marloues-e2e-"));
});

test.afterAll(() => {
  rmSync(testHome, { recursive: true, force: true });
});

async function launchApp() {
  const executablePath = process.env.MARLOUES_E2E_EXECUTABLE;
  const app = await electron.launch({
    ...(executablePath ? { executablePath, args: [] } : { args: [mainEntry] }),
    cwd: repoRoot,
    env: { ...process.env, NODE_ENV: "test", MARLOUES_HOME: testHome },
  });
  const window = await app.firstWindow();
  return { app, window };
}

async function dismissOnboarding(window: Awaited<ReturnType<typeof launchApp>>["window"]): Promise<void> {
  const overlay = window.locator(".onboarding-overlay");
  if (!(await overlay.isVisible().catch(() => false))) return;
  await overlay.getByRole("button", { name: "开始使用" }).click();
  await expect(overlay).toBeHidden();
}

test("critical smoke: app boots and renders the shell", async () => {
  const { app, window } = await launchApp();
  try {
    await expect(window).toHaveTitle(/Marloues/);
    await expect(window.locator("#root")).not.toBeEmpty();
    await expect(window.locator(".app-shell")).toBeVisible();
  } finally {
    await app.close();
  }
});

test("settings page opens from sidebar user menu", async () => {
  const { app, window } = await launchApp();
  try {
    await expect(window.locator(".app-shell")).toBeVisible();
    await dismissOnboarding(window);
    await window.getByTitle("用户信息").click();
    await window.getByRole("dialog", { name: "用户信息" }).getByRole("button", { name: "设置" }).click();
    await expect(window.locator(".settings-sidebar")).toBeVisible();
  } finally {
    await app.close();
  }
});
