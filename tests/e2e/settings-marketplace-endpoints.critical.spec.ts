import {
  expect,
  test,
  _electron as electron,
  type Page,
} from "@playwright/test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(__dirname, "..", "..");
const mainEntry = join(repoRoot, "client", "out", "main", "index.js");
const testHome = mkdtempSync(
  join(tmpdir(), "marloues-settings-endpoints-e2e-"),
);
const workspaceDir = join(testHome, "workspace");

test.beforeAll(() => {
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(join(testHome, "config"), { recursive: true });
  writeFileSync(
    join(testHome, "config", "workspaces.json"),
    JSON.stringify({
      currentWorkspaceId: "settings-endpoints-e2e-workspace",
      workspaces: [
        {
          id: "settings-endpoints-e2e-workspace",
          name: "settings-endpoints-e2e",
          path: workspaceDir,
          lastOpenedAt: Date.now(),
        },
      ],
    }),
    "utf8",
  );
  writeFileSync(
    join(testHome, "config", "settings.json"),
    JSON.stringify({
      agentSettings: {
        skillMarketplaceEndpoint: {
          baseUrl: "http://127.0.0.1:9",
          enabled: true,
          lastStatus: "untested",
        },
        mcpMarketplaceEndpoint: {
          baseUrl: "https://registry.modelcontextprotocol.io",
          enabled: true,
          lastStatus: "untested",
        },
      },
    }),
    "utf8",
  );
});

async function completeOnboarding(window: Page): Promise<void> {
  await expect(
    window.locator(".onboarding-view, .app-shell").first(),
  ).toBeVisible();
  const overlay = window.getByRole("dialog", { name: "marloues 初次设置" });
  if (!(await overlay.isVisible().catch(() => false))) return;
  await overlay.getByRole("button", { name: "开始使用" }).click();
  await expect(overlay).toBeHidden();
}

test("marketplace endpoint can be selected, tested, and reflected in market data", async () => {
  const app = await electron.launch({
    args: [mainEntry],
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      MARLOUES_BUILD_ENV: "dev",
      MARLOUES_HOME: testHome,
      MARLOUES_REMOTE_DEBUGGING_PORT: "0",
    },
  });
  const window = await app.firstWindow();

  try {
    await completeOnboarding(window);
    await window.getByTitle("用户信息").click();
    await window
      .getByRole("dialog", { name: "用户信息" })
      .getByRole("button", { name: "设置" })
      .click();

    const settings = window.getByRole("dialog", { name: "设置" });
    await settings
      .getByRole("navigation", { name: "设置分组" })
      .getByRole("button", { name: "运行时" })
      .click();

    const trigger = settings.getByRole("button", {
      name: "Skill 市场端点来源",
    });
    await trigger.click();

    const menu = settings.getByRole("listbox", {
      name: "Skill 市场端点来源",
    });
    await expect(menu).toBeVisible();
    const clippedBy = await menu.evaluate((element) => {
      const menuRect = element.getBoundingClientRect();
      const clippingValues = new Set(["auto", "clip", "hidden", "scroll"]);
      const result: string[] = [];
      let ancestor = element.parentElement;

      while (ancestor) {
        const style = window.getComputedStyle(ancestor);
        const clipsX = clippingValues.has(style.overflowX);
        const clipsY = clippingValues.has(style.overflowY);
        if (clipsX || clipsY) {
          const rect = ancestor.getBoundingClientRect();
          if (
            (clipsX &&
              (menuRect.left < rect.left || menuRect.right > rect.right)) ||
            (clipsY &&
              (menuRect.top < rect.top || menuRect.bottom > rect.bottom))
          ) {
            result.push(
              `${ancestor.tagName.toLowerCase()}.${Array.from(
                ancestor.classList,
              ).join(".")}`,
            );
          }
        }
        ancestor = ancestor.parentElement;
      }

      return result;
    });
    expect(clippedBy).toEqual([]);
    const testInfo = test.info();
    const screenshotPath = testInfo.outputPath("skill-endpoint-menu.png");
    await window.screenshot({ path: screenshotPath });
    await testInfo.attach("skill endpoint menu", {
      path: screenshotPath,
      contentType: "image/png",
    });
    await menu.getByRole("option", { name: "ClawHub" }).click();
    await expect(trigger).toContainText("ClawHub");

    const endpointRow = settings
      .locator(".marketplace-endpoint-row")
      .filter({ hasText: "Skill 市场端点" });
    expect(
      await window.evaluate(() => ({
        list: typeof window.marloues.skill.marketplaceList,
        detail: typeof window.marloues.skill.marketplaceDetail,
        install: typeof window.marloues.skill.marketplaceInstall,
        test: typeof window.marloues.skill.testMarketplaceEndpoint,
      })),
    ).toEqual({
      list: "function",
      detail: "function",
      install: "function",
      test: "function",
    });
    const testConnection = endpointRow.getByRole("button", {
      name: "测试连接",
    });
    await testConnection.click();
    await expect(endpointRow).toContainText("连接正常", { timeout: 20_000 });
    await expect(
      window
        .getByLabel("Notifications alt+T")
        .getByText("Skill 市场端点连接正常", { exact: true }),
    ).toBeVisible();

    await settings.getByRole("button", { name: "返回工作区" }).click();
    await window.locator('[data-quick-access="plugins"]').click();
    const skillPanel = window.locator("#plugin-skills-panel");
    await expect(skillPanel.getByText(/发现 · [1-9]\d* results/)).toBeVisible({
      timeout: 20_000,
    });
    expect(await skillPanel.locator(".plugin-card").count()).toBeGreaterThan(0);
  } finally {
    await app.close();
  }
});
