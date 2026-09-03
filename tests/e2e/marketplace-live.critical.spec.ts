import {
  expect,
  test,
  _electron as electron,
  type Locator,
  type Page,
} from "@playwright/test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(__dirname, "..", "..");
const mainEntry = join(repoRoot, "client", "out", "main", "index.js");
const testHome = mkdtempSync(join(tmpdir(), "marloues-marketplace-e2e-"));
const workspaceDir = join(testHome, "workspace");

function findInstalledSkillMarkdown(): string | null {
  const skillsRoot = join(testHome, "runtime-config", "skills");
  if (!existsSync(skillsRoot)) return null;
  for (const entry of readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillMarkdown = join(skillsRoot, entry.name, "SKILL.md");
    if (existsSync(skillMarkdown)) return skillMarkdown;
  }
  return null;
}

async function expectListColumnsAligned(
  panel: Locator,
  minimumRows: number,
): Promise<void> {
  const cards = panel.locator(".plugin-card.is-list");
  await expect(cards.nth(minimumRows - 1)).toBeVisible({ timeout: 30_000 });
  const metrics = await cards.evaluateAll(
    (nodes, requestedRows) =>
      nodes.slice(0, requestedRows).map((node) => {
        const card = node as HTMLElement;
        const box = (selector: string) =>
          (card.querySelector(selector) as HTMLElement).getBoundingClientRect();
        return {
          identityX: box(".plugin-card-identity").x,
          statusX: box(".plugin-install-status").x,
          descriptionX: box(":scope > p").x,
          footerX: box(":scope > footer").x,
        };
      }),
    minimumRows,
  );
  for (const key of ["statusX", "descriptionX", "footerX"] as const) {
    const positions = metrics.map((row) => row[key]);
    expect(Math.max(...positions) - Math.min(...positions)).toBeLessThanOrEqual(
      1,
    );
  }
  expect(metrics[0].statusX).toBeGreaterThan(metrics[0].identityX);
  expect(metrics[0].descriptionX).toBeGreaterThan(metrics[0].statusX);
  expect(metrics[0].footerX).toBeGreaterThan(metrics[0].descriptionX);
}

test.beforeAll(() => {
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(join(testHome, "config"), { recursive: true });
  writeFileSync(
    join(testHome, "config", "workspaces.json"),
    JSON.stringify({
      currentWorkspaceId: "marketplace-e2e-workspace",
      workspaces: [
        {
          id: "marketplace-e2e-workspace",
          name: "marketplace-e2e",
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
          baseUrl: "https://clawhub.ai",
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
  console.log(`marketplace e2e home: ${testHome}`);
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

test("live marketplaces support discovery, review and safe installation", async () => {
  test.setTimeout(270_000);
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
    await window.locator('[data-quick-access="plugins"]').click();
    await expect(window.getByTestId("plugins-page")).toBeVisible();

    const skillPanel = window.locator("#plugin-skills-panel");
    await skillPanel.getByLabel("列表视图").click();
    const skillCard = skillPanel
      .locator(".plugin-card:has(.plugin-install-button)")
      .first();
    await expect(skillCard).toBeVisible({ timeout: 30_000 });
    await expectListColumnsAligned(skillPanel, 3);
    await window.screenshot({ path: join(testHome, "skills-list-layout.png") });
    const skillName = (
      (await skillCard.locator(".plugin-card-identity strong").textContent()) ??
      ""
    ).trim();
    expect(skillName).not.toBe("");
    await skillCard.getByRole("button", { name: "安装" }).click();

    const installingButton = skillCard.getByRole("button", {
      name: "安装中",
    });
    await expect(installingButton).toBeVisible();
    await expect(installingButton).toHaveAttribute("aria-busy", "true");
    const installingButtonLayout = await installingButton.evaluate(
      (element) => {
        const button = element as HTMLButtonElement;
        const style = getComputedStyle(button);
        return {
          clientWidth: button.clientWidth,
          scrollWidth: button.scrollWidth,
          height: button.getBoundingClientRect().height,
          whiteSpace: style.whiteSpace,
        };
      },
    );
    expect(installingButtonLayout.whiteSpace).toBe("nowrap");
    expect(installingButtonLayout.scrollWidth).toBeLessThanOrEqual(
      installingButtonLayout.clientWidth,
    );
    expect(installingButtonLayout.height).toBeCloseTo(26, 1);

    const skillDialog = window.locator(".skill-detail-modal");
    await expect(skillDialog).toHaveCount(0);
    const installedSkillCard = skillPanel.getByRole("button", {
      name: `${skillName} 已安装`,
      exact: true,
    });
    await expect(installedSkillCard).toBeVisible({ timeout: 90_000 });
    await expect
      .poll(findInstalledSkillMarkdown, { timeout: 20_000 })
      .not.toBeNull();
    const installedSkill = findInstalledSkillMarkdown();
    expect(installedSkill).not.toBeNull();
    expect(readFileSync(installedSkill!, "utf8").trim().length).toBeGreaterThan(
      20,
    );

    await installedSkillCard.locator("header").click();
    await expect(skillDialog).toBeVisible();
    await expect(skillDialog).toContainText(skillName);
    await expect(
      skillDialog.locator(".skill-detail-versionbar strong"),
    ).toHaveText(/^(?:最新版|v\S+) · 当前$/);
    await expect
      .poll(
        async () =>
          ((await skillDialog.locator("pre").textContent()) ?? "").trim()
            .length,
        { timeout: 30_000 },
      )
      .toBeGreaterThan(20);

    await skillDialog.getByRole("tab", { name: /文件/ }).click();
    const fileTree = skillDialog.getByRole("navigation", {
      name: "Skill 文件",
    });
    await expect(fileTree).toBeVisible({ timeout: 30_000 });
    await expect(fileTree).toContainText("SKILL.md");
    expect(await fileTree.getByRole("button").count()).toBeGreaterThan(1);

    await skillDialog.getByRole("tab", { name: /历史版本/ }).click();
    const versions = skillDialog.locator(".sd-version-item");
    await expect(versions.first()).toBeVisible({ timeout: 20_000 });
    expect(await versions.count()).toBeGreaterThan(1);
    const previousVersion = versions.nth(1);
    const previousVersionName = (
      (await previousVersion.locator(".sd-version-top b").textContent()) ?? ""
    ).trim();
    await previousVersion.getByRole("button", { name: "切换" }).click();
    await expect(skillDialog.locator(".sd-version-note")).toContainText(
      `${previousVersionName} 的真实快照`,
      { timeout: 20_000 },
    );
    await expect(skillDialog.locator(".sd-version-note")).toContainText(
      "其它页签将在打开时按需读取",
      { timeout: 20_000 },
    );
    await expect(
      skillDialog.locator(".skill-detail-versionbar strong"),
    ).toContainText(previousVersionName);

    await skillDialog.getByRole("tab", { name: "安全检测" }).click();
    await expect(skillDialog).toContainText("安装时逐文件校验", {
      timeout: 20_000,
    });
    await skillDialog.getByTitle("关闭").click();

    await window.getByRole("tab", { name: "MCP", exact: true }).click();
    const mcpPanel = window.locator("#plugin-mcp-panel");
    await mcpPanel.getByPlaceholder("搜索 MCP 市场").fill("filesystem");
    await mcpPanel.getByLabel("列表视图").click();
    const mcpCard = mcpPanel
      .locator(".plugin-card")
      .filter({ hasText: "com.pulsemcp/remote-filesystem" })
      .first();
    await expect(mcpCard).toBeVisible({ timeout: 20_000 });
    await expectListColumnsAligned(mcpPanel, 1);
    await mcpCard.getByRole("button", { name: "安装" }).click();

    const installDialog = window.getByRole("alertdialog");
    await expect(installDialog).toContainText("GCS_BUCKET", {
      timeout: 20_000,
    });
    await installDialog.getByRole("button", { name: "确认安装" }).click();

    const settingsPath = join(testHome, "config", "settings.json");
    await expect
      .poll(() => {
        const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
        return settings.agentSettings?.mcpServers?.find(
          (server: { marketplaceId?: string }) =>
            server.marketplaceId === "com.pulsemcp/remote-filesystem",
        );
      })
      .toMatchObject({
        enabled: false,
        lastStatus: "disconnected",
        config: {
          type: "stdio",
          command: "npx",
          args: ["-y", expect.stringMatching(/^remote-filesystem-mcp-server@/)],
          env: { GCS_BUCKET: "" },
        },
      });
    await mcpPanel.getByRole("tab", { name: "已安装", exact: true }).click();
    await expect(mcpPanel.locator(".plugin-card.is-list").first()).toBeVisible({
      timeout: 20_000,
    });
    await expectListColumnsAligned(mcpPanel, 1);
    await window.screenshot({ path: join(testHome, "mcp-list-layout.png") });
  } finally {
    await app.close();
  }
});
