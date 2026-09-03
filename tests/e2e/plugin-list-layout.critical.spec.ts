import {
  expect,
  test,
  _electron as electron,
  type Locator,
  type Page,
} from "@playwright/test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(__dirname, "..", "..");
const mainEntry = join(repoRoot, "client", "out", "main", "index.js");
const testHome = mkdtempSync(join(tmpdir(), "marloues-plugin-layout-e2e-"));
const workspaceDir = join(testHome, "workspace");

async function completeOnboarding(window: Page): Promise<void> {
  await expect(
    window.locator(".onboarding-view, .app-shell").first(),
  ).toBeVisible();
  const overlay = window.getByRole("dialog", { name: "marloues 初次设置" });
  if (!(await overlay.isVisible().catch(() => false))) return;
  await overlay.getByRole("button", { name: "开始使用" }).click();
  await expect(overlay).toBeHidden();
}

async function expectAlignedColumns(
  panel: Locator,
  rows: number,
  actionWidth: number,
): Promise<void> {
  const cards = panel.locator(".plugin-card.is-list");
  await expect(cards.nth(rows - 1)).toBeVisible();
  const metrics = await cards.evaluateAll(
    (nodes, requestedRows) =>
      nodes.slice(0, requestedRows).map((node) => {
        const card = node as HTMLElement;
        const rect = (selector: string) =>
          (card.querySelector(selector) as HTMLElement).getBoundingClientRect();
        return {
          status: rect(".plugin-install-status").x,
          description: rect(":scope > p").x,
          footer: rect(":scope > footer").x,
          footerWidth: rect(":scope > footer").width,
        };
      }),
    rows,
  );
  for (const key of ["status", "description", "footer"] as const) {
    const positions = metrics.map((row) => row[key]);
    expect(Math.max(...positions) - Math.min(...positions)).toBeLessThanOrEqual(
      1,
    );
  }
  expect(metrics[0].footerWidth).toBeCloseTo(actionWidth, 5);
  expect(metrics[0].description).toBeGreaterThan(metrics[0].status);
  expect(metrics[0].footer).toBeGreaterThan(metrics[0].description);
}

test.beforeAll(() => {
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(join(testHome, "config"), { recursive: true });
  const skillsRoot = join(testHome, "runtime-config", "skills");
  for (const [directory, name, description] of [
    ["marketplace-layout-short", "短标题 Skill", "短描述用于验证列表布局。"],
    [
      "marketplace-layout-long",
      "这是一个不会挤压状态列的超长 Skill 标题",
      "这是一段很长的描述，用于验证文本截断之后右侧操作按钮仍然保持在同一条垂线上。",
    ],
    [
      "marketplace-layout-medium",
      "Medium Skill",
      "A medium length description for deterministic layout verification.",
    ],
  ]) {
    const skillDir = join(skillsRoot, directory);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${description}\nversion: 1.0.0\n---\n\n# ${name}\n`,
      "utf8",
    );
  }
  writeFileSync(
    join(testHome, "config", "workspaces.json"),
    JSON.stringify({
      currentWorkspaceId: "plugin-layout-workspace",
      workspaces: [
        {
          id: "plugin-layout-workspace",
          name: "plugin-layout",
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
          enabled: false,
        },
        mcpMarketplaceEndpoint: {
          baseUrl: "https://registry.modelcontextprotocol.io",
          enabled: false,
        },
        mcpServers: [
          {
            id: "layout-http",
            name: "inference.sh",
            enabled: true,
            config: { type: "http", url: "https://example.test/mcp" },
            lastStatus: "untested",
            tools: [],
          },
          {
            id: "layout-stdio",
            name: "A much longer local MCP service name",
            enabled: false,
            config: { type: "stdio", command: "node", args: ["server.js"] },
            lastStatus: "error",
            lastError: "连接失败，但错误内容不能挤压右侧检测、开关和删除操作。",
            tools: ["layout.read", "layout.write"],
          },
        ],
      },
    }),
    "utf8",
  );
  console.log(`plugin layout e2e home: ${testHome}`);
});

test("Skills and MCP list columns remain aligned", async () => {
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
    await window.setViewportSize({ width: 1980, height: 1200 });
    await completeOnboarding(window);
    await window.locator('[data-quick-access="plugins"]').click();
    await expect(window.getByTestId("plugins-page")).toBeVisible();

    const skillPanel = window.locator("#plugin-skills-panel");
    await skillPanel.getByRole("tab", { name: "已安装", exact: true }).click();
    await skillPanel.getByLabel("列表视图").click();
    await expectAlignedColumns(skillPanel, 3, 76);
    await window.screenshot({ path: join(testHome, "skills-list-layout.png") });

    await window.getByRole("tab", { name: "MCP", exact: true }).click();
    const mcpPanel = window.locator("#plugin-mcp-panel");
    await mcpPanel.getByRole("tab", { name: "已安装", exact: true }).click();
    await mcpPanel.getByLabel("列表视图").click();
    await expectAlignedColumns(mcpPanel, 2, 116);
    await window.screenshot({ path: join(testHome, "mcp-list-layout.png") });
  } finally {
    await app.close();
  }
});
