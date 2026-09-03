import {
  expect,
  test,
  _electron as electron,
  type Page,
} from "@playwright/test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(__dirname, "..", "..");
const mainEntry = join(repoRoot, "client", "out", "main", "index.js");
const testHome = mkdtempSync(join(tmpdir(), "marloues-project-config-e2e-"));
const workspaceDir = join(testHome, "workspace");
const newWorkspaceDir = join(testHome, "new-workspace");
const workspaceConfigPath = join(testHome, "config", "workspaces.json");

async function completeOnboarding(window: Page): Promise<void> {
  await expect(
    window.locator(".onboarding-view, .app-shell").first(),
  ).toBeVisible();
  const overlay = window.getByRole("dialog", { name: "marloues 初次设置" });
  if (!(await overlay.isVisible().catch(() => false))) return;
  await overlay.getByRole("button", { name: "开始使用" }).click();
  await expect(overlay).toBeHidden();
}

test.beforeAll(() => {
  mkdirSync(join(testHome, "config"), { recursive: true });
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(join(newWorkspaceDir, ".agents", "skills", "new-project-e2e"), {
    recursive: true,
  });
  writeFileSync(
    join(newWorkspaceDir, ".agents", "skills", "new-project-e2e", "SKILL.md"),
    "---\nname: new-project-e2e\ndescription: New project E2E Skill\n---\n",
    "utf8",
  );
  const globalSkillDir = join(
    testHome,
    "runtime-config",
    "skills",
    "global-e2e",
  );
  const projectSkillDir = join(
    workspaceDir,
    ".agents",
    "skills",
    "project-e2e",
  );
  mkdirSync(globalSkillDir, { recursive: true });
  mkdirSync(projectSkillDir, { recursive: true });
  writeFileSync(
    join(globalSkillDir, "SKILL.md"),
    "---\nname: global-e2e\ndescription: Global E2E Skill\n---\n",
    "utf8",
  );
  writeFileSync(
    join(projectSkillDir, "SKILL.md"),
    "---\nname: project-e2e\ndescription: Project E2E Skill\n---\n",
    "utf8",
  );
  writeFileSync(
    workspaceConfigPath,
    JSON.stringify({
      currentWorkspaceId: "project-config-workspace",
      workspaces: [
        {
          id: "project-config-workspace",
          name: "project-config-e2e",
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
        disabledSkills: [],
        skillDirectories: [],
        mcpServers: [
          {
            id: "global-e2e-mcp",
            name: "global-e2e-mcp",
            enabled: true,
            config: { type: "http", url: "https://example.test/mcp" },
          },
        ],
      },
    }),
    "utf8",
  );
});

test("project Skill and MCP policies persist through the real desktop UI", async () => {
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
    await window.setViewportSize({ width: 1440, height: 960 });
    await completeOnboarding(window);
    const projectRow = window
      .locator(".work-area-project")
      .filter({ hasText: "project-config-e2e" });
    await expect(projectRow).toBeVisible();
    await projectRow.hover();
    await projectRow.getByRole("button", { name: "项目操作" }).click();
    await window.getByRole("button", { name: "项目配置" }).click();

    const dialog = window.getByTestId("project-config-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(workspaceDir);

    await dialog.getByRole("tab", { name: /Skill/ }).click();
    await expect(dialog.getByText("global-e2e", { exact: true })).toBeVisible();
    await expect(dialog).toContainText("已发现 1 个项目 Skill");
    await dialog.getByRole("button", { name: "自定义" }).click();
    await dialog.getByRole("switch", { name: "停用 global-e2e" }).click();

    await dialog.getByRole("tab", { name: /MCP/ }).click();
    await expect(
      dialog.getByText("global-e2e-mcp", { exact: true }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "自定义" }).click();
    await dialog.getByRole("switch", { name: "停用 global-e2e-mcp" }).click();
    await dialog.getByRole("button", { name: "添加服务" }).click();

    const mcpDialog = window.getByRole("dialog", { name: "添加 MCP 服务" });
    await expect(mcpDialog).toBeVisible();
    await mcpDialog.getByRole("tab", { name: /HTTP/ }).click();
    await mcpDialog.getByLabel("服务名称").fill("project-only-e2e");
    await mcpDialog
      .getByLabel(/服务 URL/)
      .fill("https://project.example.test/mcp");
    await mcpDialog.getByRole("button", { name: "添加服务" }).click();
    await expect(mcpDialog).toBeHidden();
    await expect(
      dialog.getByText("project-only-e2e", { exact: true }),
    ).toBeVisible();

    await dialog.getByRole("button", { name: "保存配置" }).click();
    await expect(dialog).toBeHidden();

    const persisted = JSON.parse(readFileSync(workspaceConfigPath, "utf8"));
    const saved = persisted.workspaces[0];
    expect(saved.skillPolicy).toMatchObject({
      mode: "custom",
      enabledSkillIds: [],
      includeProjectSkills: true,
    });
    expect(saved.mcpPolicy.mode).toBe("custom");
    expect(saved.mcpPolicy.enabledServerIds).toEqual([]);
    expect(saved.mcpPolicy.projectServers).toEqual([
      expect.objectContaining({
        name: "project-only-e2e",
        enabled: true,
        config: {
          type: "http",
          url: "https://project.example.test/mcp",
        },
      }),
    ]);

    await projectRow.hover();
    await projectRow.getByRole("button", { name: "项目操作" }).click();
    await window.getByRole("button", { name: "项目配置" }).click();
    const reopened = window.getByTestId("project-config-dialog");
    await reopened.getByRole("tab", { name: /MCP/ }).click();
    await expect(
      reopened.getByText("project-only-e2e", { exact: true }),
    ).toBeVisible();
    await expect(
      reopened.getByRole("switch", { name: "启用 global-e2e-mcp" }),
    ).toHaveAttribute("aria-checked", "false");

    const screenshotPath = test.info().outputPath("project-config.png");
    await window.screenshot({ path: screenshotPath });
    await test.info().attach("project config", {
      path: screenshotPath,
      contentType: "image/png",
    });
  } finally {
    await app.close();
  }
});

test("a project is configured before it is created through the real desktop UI", async () => {
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
    await window.setViewportSize({ width: 1440, height: 960 });
    await completeOnboarding(window);
    await app.evaluate(({ dialog }, selectedPath) => {
      // Keep the real workspace:pick-folder IPC handler in the test. Only
      // replace the native OS dialog result so the flow remains automatable.
      Object.defineProperty(dialog, "showOpenDialog", {
        configurable: true,
        value: async () => ({ canceled: false, filePaths: [selectedPath] }),
      });
    }, newWorkspaceDir);

    const initialWorkspaceCount = JSON.parse(
      readFileSync(workspaceConfigPath, "utf8"),
    ).workspaces.length;

    // Selecting a folder is a draft operation: cancel must not create it.
    await window.locator(".work-area-daily .work-area-heading").hover();
    await window.getByRole("button", { name: "添加项目" }).click();
    let dialog = window.getByTestId("project-config-dialog");
    await expect(dialog).toContainText("添加项目");
    await dialog.getByRole("button", { name: "浏览" }).click();
    await expect(dialog.getByLabel("项目目录")).toHaveValue(newWorkspaceDir);
    await dialog.getByRole("button", { name: "取消" }).click();
    expect(
      JSON.parse(readFileSync(workspaceConfigPath, "utf8")).workspaces,
    ).toHaveLength(initialWorkspaceCount);

    // Confirming submits the path and the complete initial policy once.
    await window.locator(".work-area-daily .work-area-heading").hover();
    await window.getByRole("button", { name: "添加项目" }).click();
    dialog = window.getByTestId("project-config-dialog");
    await dialog.getByRole("button", { name: "浏览" }).click();
    await dialog.getByLabel("项目名称").fill("created-with-config");
    await dialog.getByLabel("标签").fill("e2e, configured");

    await dialog.getByRole("tab", { name: /Skill/ }).click();
    await expect(dialog).toContainText("已发现 1 个项目 Skill");
    await dialog.getByRole("button", { name: "自定义" }).click();
    await dialog.getByRole("switch", { name: "停用 global-e2e" }).click();

    await dialog.getByRole("tab", { name: /MCP/ }).click();
    await dialog.getByRole("button", { name: "自定义" }).click();
    await dialog.getByRole("switch", { name: "停用 global-e2e-mcp" }).click();
    await dialog.getByRole("button", { name: "添加服务" }).click();
    const mcpDialog = window.getByRole("dialog", { name: "添加 MCP 服务" });
    await mcpDialog.getByRole("tab", { name: /HTTP/ }).click();
    await mcpDialog.getByLabel("服务名称").fill("created-project-mcp");
    await mcpDialog
      .getByLabel(/服务 URL/)
      .fill("https://created.example.test/mcp");
    await mcpDialog.getByRole("button", { name: "添加服务" }).click();
    await expect(mcpDialog).toBeHidden();
    const screenshotPath = test.info().outputPath("project-create-config.png");
    await window.screenshot({ path: screenshotPath });
    await test.info().attach("project create config", {
      path: screenshotPath,
      contentType: "image/png",
    });
    await dialog.getByRole("button", { name: "确认添加" }).click();
    await expect(dialog).toBeHidden();

    const persisted = JSON.parse(readFileSync(workspaceConfigPath, "utf8"));
    const created = persisted.workspaces.find(
      (item: { path: string }) => item.path === newWorkspaceDir,
    );
    expect(created).toMatchObject({
      name: "created-with-config",
      path: newWorkspaceDir,
      tags: ["e2e", "configured"],
      skillPolicy: {
        mode: "custom",
        enabledSkillIds: [],
        includeProjectSkills: true,
      },
      mcpPolicy: {
        mode: "custom",
        enabledServerIds: [],
        projectServers: [
          expect.objectContaining({
            name: "created-project-mcp",
            enabled: true,
            config: {
              type: "http",
              url: "https://created.example.test/mcp",
            },
          }),
        ],
      },
    });
    expect(persisted.currentWorkspaceId).toBe(created.id);
    await expect(
      window.getByText("created-with-config", { exact: true }),
    ).toBeVisible();
  } finally {
    await app.close();
  }
});
