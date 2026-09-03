import {
  expect,
  test,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(__dirname, "..", "..");
const mainEntry = join(repoRoot, "client", "out", "main", "index.js");

let testHome: string;
let workspaceDir: string;

test.beforeAll(() => {
  testHome = mkdtempSync(join(tmpdir(), "marloues-im-sidebar-e2e-"));
  workspaceDir = join(testHome, "workspace");
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(join(testHome, "config"), { recursive: true });
  writeFileSync(
    join(testHome, "config", "workspaces.json"),
    JSON.stringify({
      currentWorkspaceId: "im-sidebar-workspace",
      workspaces: [
        {
          id: "im-sidebar-workspace",
          name: "im-sidebar",
          path: workspaceDir,
          lastOpenedAt: Date.now(),
        },
      ],
    }),
    "utf-8",
  );
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

async function completeOnboarding(window: Page): Promise<void> {
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

async function mockFeishuImSession(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow, ipcMain }, cwd) => {
    for (const channel of [
      "im:list-sessions",
      "chat:list-sessions",
      "chat:list-all-sessions",
      "chat:read-thread",
    ]) {
      ipcMain.removeHandler(channel);
    }

    const now = Date.now();
    const session = {
      id: "thread-feishu-sidebar",
      title: "[IM] 发布群助手",
      workspacePath: cwd,
      workspaceName: "im-sidebar",
      createdAt: now,
      updatedAt: now,
      isPinned: false,
      messages: [],
    };

    ipcMain.handle("im:list-sessions", async () => ({
      sessions: [
        {
          channel: "feishu",
          chatId: "oc_mock_feishu_chat",
          threadId: session.id,
          title: session.title,
          workspacePath: cwd,
          lastTurnId: "turn-feishu-sidebar",
          updatedAt: now,
        },
      ],
    }));
    ipcMain.handle("chat:list-sessions", async () => []);
    ipcMain.handle("chat:list-all-sessions", async () => [session]);
    ipcMain.handle("chat:read-thread", async () => ({
      schemaVersion: 2,
      thread: {
        id: session.id,
        title: session.title,
        preview: "来自飞书的测试消息",
        status: { type: "idle" },
        cwd,
        createdAt: now,
        updatedAt: now,
      },
      page: {
        order: "newest_first",
        limit: 100,
        nextCursor: null,
        hasMore: false,
      },
      turns: [],
    }));

    BrowserWindow.getAllWindows()[0]?.webContents.send("im:session-updated");
  }, workspaceDir);
}

async function mockFeishuImSessionHistory(
  app: ElectronApplication,
): Promise<void> {
  await app.evaluate(({ BrowserWindow, ipcMain }, cwd) => {
    for (const channel of [
      "im:list-sessions",
      "chat:list-sessions",
      "chat:list-all-sessions",
      "chat:read-thread",
    ]) {
      ipcMain.removeHandler(channel);
    }

    const now = Date.now();
    const oldSession = {
      id: "thread-feishu-old",
      title: "上一轮需求",
      workspacePath: cwd,
      workspaceName: "im-sidebar",
      createdAt: now - 2_000,
      updatedAt: now - 1_000,
      isPinned: false,
      messages: [],
    };
    const newSession = {
      id: "thread-feishu-new",
      title: "下一轮需求",
      workspacePath: cwd,
      workspaceName: "im-sidebar",
      createdAt: now,
      updatedAt: now,
      isPinned: false,
      messages: [],
    };

    ipcMain.handle("im:list-sessions", async () => ({
      sessions: [
        {
          channel: "feishu",
          chatId: "oc_mock_feishu_chat",
          threadId: newSession.id,
          title: newSession.title,
          workspacePath: cwd,
          updatedAt: now,
        },
        {
          channel: "feishu",
          chatId: "oc_mock_feishu_chat",
          threadId: oldSession.id,
          title: oldSession.title,
          workspacePath: cwd,
          lastTurnId: "turn-feishu-old",
          updatedAt: now - 1_000,
        },
      ],
    }));
    ipcMain.handle("chat:list-sessions", async () => []);
    ipcMain.handle("chat:list-all-sessions", async () => [
      newSession,
      oldSession,
    ]);
    ipcMain.handle("chat:read-thread", async (_event, threadId: string) => ({
      schemaVersion: 2,
      thread: {
        id: threadId,
        title: threadId === oldSession.id ? oldSession.title : newSession.title,
        preview: "",
        status: { type: "idle" },
        cwd,
        createdAt: now,
        updatedAt: now,
      },
      page: {
        order: "newest_first",
        limit: 100,
        nextCursor: null,
        hasMore: false,
      },
      turns: [],
    }));

    BrowserWindow.getAllWindows()[0]?.webContents.send("im:session-updated");
  }, workspaceDir);
}

test("IM sessions appear under the Feishu work area after the registry updates", async () => {
  const { app, window } = await launchApp();
  try {
    await completeOnboarding(window);
    await expect(window.locator(".app-shell")).toBeVisible();

    await mockFeishuImSession(app);

    const sidebar = window.getByLabel("工作区与会话列表");
    const feishuArea = sidebar.locator('[data-work-area="feishu"]');
    await expect(feishuArea).toBeVisible();
    await expect(feishuArea.getByText("飞书区")).toBeVisible();
    await expect(feishuArea.getByText("im-sidebar")).toBeVisible();
    await expect(feishuArea.getByText("发布群助手")).toBeVisible();
    await expect(sidebar.getByText("发布群助手")).toHaveCount(1);
  } finally {
    await app.close();
  }
});

test("Feishu work area keeps earlier threads when /new creates a new session", async () => {
  const { app, window } = await launchApp();
  try {
    await completeOnboarding(window);
    await expect(window.locator(".app-shell")).toBeVisible();

    await mockFeishuImSessionHistory(app);

    const sidebar = window.getByLabel("工作区与会话列表");
    const feishuArea = sidebar.locator('[data-work-area="feishu"]');
    await expect(feishuArea).toBeVisible();
    await expect(feishuArea.getByText("飞书区")).toBeVisible();
    await expect(feishuArea.getByText("上一轮需求")).toBeVisible();
    await expect(feishuArea.getByText("下一轮需求")).toBeVisible();
    await expect(sidebar.getByText("上一轮需求")).toHaveCount(1);
    await expect(sidebar.getByText("下一轮需求")).toHaveCount(1);
  } finally {
    await app.close();
  }
});
