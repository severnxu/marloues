import {
  expect,
  test,
  _electron as electron,
  type Page,
} from "@playwright/test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";

const repoRoot = join(__dirname, "..", "..");
const mainEntry = join(repoRoot, "client", "out", "main", "index.js");

async function completeOnboarding(window: Page): Promise<void> {
  await expect(
    window.locator(".onboarding-view, .app-shell").first(),
  ).toBeVisible();
  const overlay = window.getByRole("dialog", { name: "marloues 初次设置" });
  if (!(await overlay.isVisible().catch(() => false))) return;
  await overlay.getByRole("button", { name: "开始使用" }).click();
  await expect(overlay).toBeHidden();
}

test("directory, ZIP and dragged SKILL.md imports work through the desktop UI", async () => {
  const testHome = mkdtempSync(join(tmpdir(), "marloues-skill-import-e2e-"));
  const workspaceDir = join(testHome, "workspace");
  const sourceSkillDir = join(testHome, "fixtures", "local-import-e2e");
  const zipSkillPath = join(testHome, "fixtures", "zip-import-e2e.zip");
  const manifestSkillDir = join(testHome, "fixtures", "manifest-import-e2e");
  const manifestSkillPath = join(manifestSkillDir, "SKILL.md");
  const importedSkillDir = join(
    testHome,
    "runtime-config",
    "skills",
    "local-import-e2e",
  );
  mkdirSync(join(testHome, "config"), { recursive: true });
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(join(sourceSkillDir, "references"), { recursive: true });
  const skillMarkdown = [
    "---",
    "name: local-import-e2e",
    "description: Imported through the real desktop flow",
    "version: 1.2.3",
    "---",
    "",
    "# Local import E2E",
    "",
  ].join("\n");
  writeFileSync(join(sourceSkillDir, "SKILL.md"), skillMarkdown, "utf8");
  writeFileSync(
    join(sourceSkillDir, "references", "proof.txt"),
    "copied with the Skill directory",
    "utf8",
  );
  writeFileSync(
    zipSkillPath,
    Buffer.from(
      zipSync({
        "zip-import-e2e/SKILL.md": strToU8(
          skillMarkdown.replaceAll("local-import-e2e", "zip-import-e2e"),
        ),
        "zip-import-e2e/scripts/proof.sh": strToU8("echo zip-imported\n"),
      }),
    ),
  );
  mkdirSync(manifestSkillDir, { recursive: true });
  writeFileSync(
    manifestSkillPath,
    skillMarkdown.replaceAll("local-import-e2e", "manifest-import-e2e"),
    "utf8",
  );
  writeFileSync(
    join(testHome, "config", "workspaces.json"),
    JSON.stringify({
      currentWorkspaceId: "skill-import-workspace",
      workspaces: [
        {
          id: "skill-import-workspace",
          name: "skill-import-project",
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
        activeRuntimeId: "self-built",
        disabledSkills: [],
        skillDirectories: [],
        mcpServers: [],
        skillMarketplaceEndpoint: {
          baseUrl: "https://clawhub.ai",
          enabled: false,
        },
      },
    }),
    "utf8",
  );

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
  const rendererErrors: string[] = [];
  window.on("pageerror", (error) =>
    rendererErrors.push(error.stack ?? error.message),
  );
  window.on("crash", () => rendererErrors.push("renderer crashed"));

  try {
    await window.setViewportSize({ width: 1440, height: 960 });
    await completeOnboarding(window);
    await app.evaluate(
      ({ dialog }, selectedPaths) => {
        // Preserve the real renderer -> preload -> IPC import path. Only make
        // the native folder picker deterministic for the automated desktop run.
        Object.defineProperty(dialog, "showOpenDialog", {
          configurable: true,
          value: async (options: { properties?: string[] }) => ({
            canceled: false,
            filePaths: [
              options.properties?.includes("openDirectory")
                ? selectedPaths.directory
                : selectedPaths.file,
            ],
          }),
        });
      },
      { directory: sourceSkillDir, file: zipSkillPath },
    );

    await window.locator('[data-quick-access="plugins"]').click();
    const skillPanel = window.locator("#plugin-skills-panel");
    await skillPanel.getByRole("button", { name: "本地导入" }).click();

    const importDialog = window.getByRole("dialog", {
      name: "导入本地 Skill",
    });
    await expect(importDialog).toBeVisible();
    await importDialog.getByRole("button", { name: "选择文件夹" }).click();
    await expect(importDialog).toContainText(sourceSkillDir);
    await expect(importDialog).toContainText("local-import-e2e");
    await expect(importDialog).toContainText("1.2.3");
    await expect(importDialog).toContainText("Skill 文件夹 · 2 个文件");
    await importDialog
      .getByRole("button", { name: "导入", exact: true })
      .click();
    await expect(importDialog).toBeHidden();

    const detailDialog = window.getByRole("dialog", {
      name: "local-import-e2e 详情",
    });
    await expect(detailDialog).toBeVisible();
    await expect(detailDialog).toContainText("v1.2.3");
    await expect(
      detailDialog.getByRole("button", { name: "去使用" }),
    ).toHaveCount(0);
    await detailDialog.getByTitle("关闭").click();

    expect(existsSync(join(importedSkillDir, "SKILL.md"))).toBe(true);
    expect(readFileSync(join(importedSkillDir, "SKILL.md"), "utf8")).toBe(
      skillMarkdown,
    );
    expect(
      readFileSync(join(importedSkillDir, "references", "proof.txt"), "utf8"),
    ).toBe("copied with the Skill directory");

    // File picker path: import a ZIP with its nested script intact.
    await skillPanel.getByRole("button", { name: "本地导入" }).click();
    await importDialog
      .getByRole("button", { name: "选择文件", exact: true })
      .click();
    await expect(importDialog).toContainText("zip-import-e2e");
    await expect(importDialog).toContainText("ZIP 压缩包 · 2 个文件");
    await importDialog
      .getByRole("button", { name: "导入", exact: true })
      .click();
    await expect(importDialog).toBeHidden();
    await window
      .getByRole("dialog", { name: "zip-import-e2e 详情" })
      .getByTitle("关闭")
      .click();
    expect(
      readFileSync(
        join(
          testHome,
          "runtime-config",
          "skills",
          "zip-import-e2e",
          "scripts",
          "proof.sh",
        ),
        "utf8",
      ),
    ).toBe("echo zip-imported\n");

    // Real Chromium drag payload path: drop a standalone SKILL.md. Electron's
    // webUtils resolves the OS path before the real inspect/import IPC calls.
    await skillPanel.getByRole("button", { name: "本地导入" }).click();
    const dropzone = importDialog.locator(".plugin-import-dropzone");
    const box = await dropzone.boundingBox();
    if (!box) throw new Error("Skill import dropzone is not visible");
    const cdp = await window.context().newCDPSession(window);
    const dragData = {
      items: [],
      files: [manifestSkillPath],
      dragOperationsMask: 1,
    };
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await cdp.send("Input.dispatchDragEvent", {
      type: "dragEnter",
      x,
      y,
      data: dragData,
    });
    await cdp.send("Input.dispatchDragEvent", {
      type: "drop",
      x,
      y,
      data: dragData,
    });
    await expect(importDialog).toContainText("manifest-import-e2e");
    await expect(importDialog).toContainText("单个 SKILL.md · 1 个文件");
    const dialogScreenshotPath = test
      .info()
      .outputPath("local-skill-import-dialog.png");
    await importDialog.screenshot({ path: dialogScreenshotPath });
    await test.info().attach("local Skill import dialog", {
      path: dialogScreenshotPath,
      contentType: "image/png",
    });
    await importDialog
      .getByRole("button", { name: "导入", exact: true })
      .click();
    await expect(importDialog).toBeHidden();
    await window
      .getByRole("dialog", { name: "manifest-import-e2e 详情" })
      .getByTitle("关闭")
      .click();
    expect(
      readFileSync(
        join(
          testHome,
          "runtime-config",
          "skills",
          "manifest-import-e2e",
          "SKILL.md",
        ),
        "utf8",
      ),
    ).toContain("name: manifest-import-e2e");

    const inventories = await window.evaluate(async () => {
      const installed = await globalThis.marloues.skill.list();
      const effective = await globalThis.marloues.workspace.listSkills(
        "skill-import-workspace",
      );
      return {
        installed: installed.map((skill) => ({
          name: skill.name,
          version: skill.version,
          enabled: skill.enabled,
        })),
        effective: effective.map((skill) => ({
          name: skill.name,
          enabled: skill.enabled,
        })),
      };
    });
    expect(inventories.installed).toContainEqual({
      name: "local-import-e2e",
      version: "1.2.3",
      enabled: true,
    });
    expect(inventories.effective).toContainEqual({
      name: "local-import-e2e",
      enabled: true,
    });
    expect(inventories.installed.map((skill) => skill.name)).toEqual([
      "local-import-e2e",
      "manifest-import-e2e",
      "zip-import-e2e",
    ]);

    // The composer stays mounted behind the plugin page. Import must notify it
    // to refresh immediately; requiring an app restart would make import only
    // superficially successful.
    await window.locator('[data-quick-access="new-conversation"]').click();
    const textarea = window.locator(".composer textarea");
    await textarea.click();
    await textarea.pressSequentially("$local-import");
    const option = window
      .getByRole("option")
      .filter({ hasText: "$local-import-e2e" });
    await expect(option).toHaveCount(1);
    await option.click();
    await expect(window.locator(".composer-skill-token")).toHaveText(
      "local-import-e2e",
    );
    expect(rendererErrors).toEqual([]);

    const screenshotPath = test.info().outputPath("local-skill-import.png");
    await window.screenshot({ path: screenshotPath });
    await test.info().attach("local Skill import", {
      path: screenshotPath,
      contentType: "image/png",
    });
  } finally {
    await app.close();
  }
});
