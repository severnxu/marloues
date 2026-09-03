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

async function completeOnboarding(window: Page): Promise<void> {
  await expect(
    window.locator(".onboarding-view, .app-shell").first(),
  ).toBeVisible();
  const overlay = window.getByRole("dialog", { name: "marloues 初次设置" });
  if (!(await overlay.isVisible().catch(() => false))) return;
  await overlay.getByRole("button", { name: "开始使用" }).click();
  await expect(overlay).toBeHidden();
}

test("project Skill selection sends and renders exactly one user message", async () => {
  const testHome = mkdtempSync(join(tmpdir(), "marloues-skill-chat-e2e-"));
  const workspaceDir = join(testHome, "workspace");
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
  mkdirSync(join(testHome, "config"), { recursive: true });
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
    join(testHome, "config", "workspaces.json"),
    JSON.stringify({
      currentWorkspaceId: "skill-chat-workspace",
      workspaces: [
        {
          id: "skill-chat-workspace",
          name: "skill-chat-e2e",
          path: workspaceDir,
          lastOpenedAt: Date.now(),
          skillPolicy: {
            mode: "custom",
            enabledSkillIds: [],
            includeProjectSkills: true,
          },
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
    await window.setViewportSize({ width: 1280, height: 900 });
    await completeOnboarding(window);

    const textarea = window.locator(".composer textarea");
    await expect(textarea).toBeVisible();
    await expect
      .poll(() =>
        window.evaluate(async () =>
          (
            await globalThis.marloues.workspace.listSkills(
              "skill-chat-workspace",
            )
          )
            .filter((skill) => skill.enabled)
            .map((skill) => skill.name),
        ),
      )
      .toEqual(["project-e2e"]);
    await window.waitForTimeout(750);
    await textarea.click();
    await textarea.pressSequentially("$project");

    const projectOption = window
      .getByRole("option")
      .filter({ hasText: "$project-e2e" });
    await expect(projectOption).toHaveCount(1);
    await expect(
      window.getByRole("option").filter({ hasText: "$global-e2e" }),
    ).toHaveCount(0);
    await projectOption.click();
    await expect(window.locator(".composer-skill-token")).toHaveText(
      "project-e2e",
    );

    await window.getByRole("button", { name: "发送消息" }).click();
    const userMessages = window.locator(".workflow-user-message");
    await expect(userMessages).toHaveCount(1);
    await expect(
      userMessages.locator(".workflow-user-attachment-pill"),
    ).toContainText("project-e2e");

    // readThread refreshes asynchronously just after the send. The regression
    // used to add a second seed turn during that window, so assert again after
    // the snapshot has had time to settle.
    await window.waitForTimeout(1_000);
    await expect(userMessages).toHaveCount(1);
    const messageCounts = await window.evaluate(
      async (expectedWorkspacePath) => {
        const sessions = await globalThis.marloues.chat.listAllSessions();
        const session = sessions
          .filter((item) => item.workspacePath === expectedWorkspacePath)
          .sort((left, right) => right.updatedAt - left.updatedAt)[0];
        if (!session) throw new Error("Skill E2E session was not persisted");
        const snapshot = await globalThis.marloues.chat.readThread(session.id);
        return {
          persistedUsers: session.messages.filter(
            (message) => message.role === "user",
          ).length,
          workflowUsers:
            snapshot?.turns.reduce(
              (count, turn) =>
                count +
                turn.items.filter((item) => item.type === "userMessage").length,
              0,
            ) ?? 0,
        };
      },
      workspaceDir,
    );
    expect(messageCounts).toEqual({ persistedUsers: 1, workflowUsers: 1 });
    expect(rendererErrors).toEqual([]);

    const screenshotPath = test.info().outputPath("skill-single-message.png");
    await window.screenshot({ path: screenshotPath });
    await test.info().attach("single Skill message", {
      path: screenshotPath,
      contentType: "image/png",
    });
  } finally {
    await app.close();
  }
});
