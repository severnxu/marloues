import {
  _electron as electron,
  chromium,
  expect,
} from "../../client/node_modules/@playwright/test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = join(__dirname, "..", "..");
const mainEntry = join(repoRoot, "client", "out", "main", "index.js");
const artifactsDir = join(repoRoot, "test-artifacts", "terminal-browser-smoke");

type ElectronPage = Awaited<
  ReturnType<typeof electron.launch>
>["windows"][number];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Poll an async function until predicate returns true or timeout. */
async function poll<T>(
  fn: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 15_000,
  intervalMs = 250,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T;
  while (Date.now() < deadline) {
    last = await fn();
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `poll timed out after ${timeoutMs}ms — last value: ${JSON.stringify(last)}`,
  );
}

/** Get the text content of all .xterm-rows in the visible terminal panel. */
async function getTerminalText(window: ElectronPage): Promise<string> {
  return window
    .locator("section.auxiliary-view-panel:not([hidden]) .xterm-rows")
    .first()
    .innerText();
}

/** Get all terminal sessions via IPC. */
async function listTerminals(
  window: ElectronPage,
): Promise<{ sessionId: string; pid: number; cwd: string }[]> {
  return window.evaluate(() => window.marloues.terminal.list());
}

/** Get terminal history buffer via IPC. */
async function getTerminalHistory(
  window: ElectronPage,
  sessionId: string,
): Promise<string> {
  return window.evaluate(
    (sid) => window.marloues.terminal.history(sid),
    sessionId,
  );
}

/** Get all browser pages via IPC. */
async function listBrowserPages(
  window: ElectronPage,
): Promise<{ pageId: string; url: string; title: string }[]> {
  return window.evaluate(() => window.marloues.browser.listPages());
}

/** Click the "+" add-view button and select a view type from the picker. */
async function addView(window: ElectronPage, label: string): Promise<void> {
  await window
    .locator("#auxiliary-add-view")
    .evaluate((el: HTMLElement) => el.click());
  const picker = window.locator("#auxiliary-view-picker");
  await expect(picker).toBeVisible();
  await picker
    .getByRole("menuitem", { name: label })
    .evaluate((el: HTMLElement) => el.click());
  await expect(picker).toBeHidden();
}

/** Switch to the Nth tab in the auxiliary header (0-based). */
async function switchToTab(window: ElectronPage, index: number): Promise<void> {
  const tabs = window.locator(".inspector-tab-main");
  await tabs.nth(index).evaluate((el: HTMLElement) => el.click());
}

/** Open the auxiliary sidebar if it is not already open. */
async function openAuxiliarySidebar(window: ElectronPage): Promise<void> {
  const toggle = window.locator(".thread-inspector-toggle");
  const aria = await toggle.getAttribute("aria-label");
  if (aria === "展开侧栏") {
    await toggle.evaluate((el: HTMLElement) => el.click());
  }
  await expect(window.locator(".auxiliary-header")).toBeVisible({
    timeout: 10_000,
  });
}

/** Complete the onboarding overlay if present. */
async function completeOnboarding(window: ElectronPage): Promise<void> {
  await expect(
    window.locator(".onboarding-view, .app-shell").first(),
  ).toBeVisible({ timeout: 30_000 });
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

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

/** Test 1: Terminal — execute command, verify output in xterm + history. */
async function testTerminalExecute(window: ElectronPage): Promise<string> {
  // Click "终端" in empty launcher
  const launcher = window.locator(".inspector-empty-cards");
  await expect(launcher).toBeVisible();
  await launcher
    .getByRole("button", { name: "终端" })
    .evaluate((el: HTMLElement) => el.click());

  // Wait for xterm to initialize
  await expect(window.locator(".terminal-panel-container")).toBeVisible({
    timeout: 10_000,
  });
  await expect(window.locator(".xterm").first()).toBeVisible({
    timeout: 10_000,
  });

  // Get the session
  const sessions = await poll(
    () => listTerminals(window),
    (s) => s.length >= 1,
  );
  const sessionId = sessions[0]!.sessionId;

  // Write a command and verify output
  await window.evaluate(
    ({ sid, cmd }) => window.marloues.terminal.write(sid, cmd),
    { sid: sessionId, cmd: "echo SMOKE_HELLO_001\r" },
  );

  // Verify output appears in xterm DOM
  await poll(
    () => getTerminalText(window),
    (text) => text.includes("SMOKE_HELLO_001"),
    15_000,
  );

  // Verify output in history buffer
  const history = await getTerminalHistory(window, sessionId);
  expect(history).toContain("SMOKE_HELLO_001");

  await window.screenshot({
    path: join(artifactsDir, "02-terminal-execute.png"),
    fullPage: true,
  });
  console.info("Test 1: terminal execute — ok");
  return sessionId;
}

/** Test 2: Terminal multi-tab — two independent terminals. */
async function testTerminalMultiTab(
  window: ElectronPage,
  firstSessionId: string,
): Promise<string> {
  // Add a second terminal tab
  await addView(window, "终端");

  // Wait for second terminal panel
  await expect(window.locator(".terminal-panel-container")).toHaveCount(2, {
    timeout: 10_000,
  });

  // Get the new session (should be different from the first)
  const sessions = await poll(
    () => listTerminals(window),
    (s) => s.length >= 2,
  );
  const secondSession = sessions.find((s) => s.sessionId !== firstSessionId);
  expect(secondSession).toBeDefined();
  const secondSessionId = secondSession!.sessionId;

  // Write a different command to the second terminal
  await window.evaluate(
    ({ sid, cmd }) => window.marloues.terminal.write(sid, cmd),
    { sid: secondSessionId, cmd: "echo SMOKE_HELLO_002\r" },
  );
  await poll(
    () => getTerminalText(window),
    (text) => text.includes("SMOKE_HELLO_002"),
    15_000,
  );

  // Switch back to first tab and verify output persists
  await switchToTab(window, 0);
  await window.waitForTimeout(500);
  const firstText = await getTerminalText(window);
  expect(firstText).toContain("SMOKE_HELLO_001");
  expect(firstText).not.toContain("SMOKE_HELLO_002");

  // Switch to second tab and verify output persists
  await switchToTab(window, 1);
  await window.waitForTimeout(500);
  const secondText = await getTerminalText(window);
  expect(secondText).toContain("SMOKE_HELLO_002");

  await window.screenshot({
    path: join(artifactsDir, "03-terminal-multi-tab.png"),
    fullPage: true,
  });
  console.info("Test 2: terminal multi-tab — ok");
  return secondSessionId;
}

/** Test 3: Terminal reload recovery — tabs restored from terminal.list(). */
async function testTerminalReloadRecovery(window: ElectronPage): Promise<void> {
  // Reload the renderer
  await window.reload();

  // Wait for app shell to reappear
  await expect(window.locator(".app-shell")).toBeVisible({
    timeout: 30_000,
  });

  // Open auxiliary sidebar
  await openAuxiliarySidebar(window);

  // Wait for terminal tabs to be restored
  await poll(
    () => window.locator(".inspector-tab-main").count(),
    (count) => count >= 2,
    15_000,
  );

  // Wait for xterm to re-initialize and replay history
  await expect(
    window.locator("section.auxiliary-view-panel:not([hidden]) .xterm").first(),
  ).toBeVisible({ timeout: 15_000 });

  // Verify history was replayed — at least one marker should be visible
  await poll(
    () => getTerminalText(window),
    (text) =>
      text.includes("SMOKE_HELLO_001") || text.includes("SMOKE_HELLO_002"),
    15_000,
  );

  await window.screenshot({
    path: join(artifactsDir, "04-terminal-reload-recovery.png"),
    fullPage: true,
  });
  console.info("Test 3: terminal reload recovery — ok");
}

/** Test 4: Browser multi-tab — two independent browser views. */
async function testBrowserMultiTab(
  window: ElectronPage,
  page1Url: string,
  page2Url: string,
): Promise<void> {
  // Click "浏览器" in empty launcher
  const launcher = window.locator(".inspector-empty-cards");
  if (await launcher.isVisible().catch(() => false)) {
    await launcher
      .getByRole("button", { name: "浏览器" })
      .evaluate((el: HTMLElement) => el.click());
  } else {
    await addView(window, "浏览器");
  }

  // Wait for browser panel to appear
  await expect(window.locator(".browser-panel")).toBeVisible({
    timeout: 10_000,
  });

  // Get the first page
  const pages = await poll(
    () => listBrowserPages(window),
    (p) => p.length >= 1,
  );
  const firstPageId = pages[0]!.pageId;

  // Navigate first browser to page1
  await window.evaluate(
    ({ pid, url }) => window.marloues.browser.viewNavigate(pid, url),
    { pid: firstPageId, url: page1Url },
  );

  // Wait for URL bar to sync
  await poll(
    () =>
      window
        .locator(
          "section.auxiliary-view-panel:not([hidden]) .browser-panel-url-input",
        )
        .first()
        .inputValue(),
    (val) => val.includes("page1.html"),
    15_000,
  );

  // Add a second browser tab
  await addView(window, "浏览器");

  // Wait for second browser panel
  await expect(window.locator(".browser-panel")).toHaveCount(2, {
    timeout: 10_000,
  });

  // Get the second page
  const pagesAfter = await poll(
    () => listBrowserPages(window),
    (p) => p.length >= 2,
  );
  const secondPage = pagesAfter.find((p) => p.pageId !== firstPageId);
  expect(secondPage).toBeDefined();
  const secondPageId = secondPage!.pageId;

  // Navigate second browser to page2
  await window.evaluate(
    ({ pid, url }) => window.marloues.browser.viewNavigate(pid, url),
    { pid: secondPageId, url: page2Url },
  );

  // Wait for URL bar to sync on the active (second) tab
  await poll(
    () =>
      window
        .locator(
          "section.auxiliary-view-panel:not([hidden]) .browser-panel-url-input",
        )
        .first()
        .inputValue(),
    (val) => val.includes("page2.html"),
    15_000,
  );

  // Switch to first browser tab and verify URL bar shows page1
  // Tab index: 0=terminal1, 1=terminal2, 2=browser1, 3=browser2
  await switchToTab(window, 2);
  await window.waitForTimeout(500);
  const firstUrl = await window
    .locator(
      "section.auxiliary-view-panel:not([hidden]) .browser-panel-url-input",
    )
    .first()
    .inputValue();
  expect(firstUrl).toContain("page1.html");

  // Switch to second browser tab and verify URL bar shows page2
  await switchToTab(window, 3);
  await window.waitForTimeout(500);
  const secondUrl = await window
    .locator(
      "section.auxiliary-view-panel:not([hidden]) .browser-panel-url-input",
    )
    .first()
    .inputValue();
  expect(secondUrl).toContain("page2.html");

  await window.screenshot({
    path: join(artifactsDir, "05-browser-multi-tab.png"),
    fullPage: true,
  });
  console.info("Test 4: browser multi-tab — ok");
}

/** Test 5: Browser navigate + screenshot + url-changed sync. */
async function testBrowserNavigate(
  window: ElectronPage,
  page1Url: string,
): Promise<void> {
  // Switch to first browser tab (index 2)
  await switchToTab(window, 2);
  await window.waitForTimeout(300);

  // Get the active page
  const pages = await listBrowserPages(window);
  const activePage = pages[0];
  expect(activePage).toBeDefined();

  // Navigate via URL bar input
  const urlInput = window
    .locator(
      "section.auxiliary-view-panel:not([hidden]) .browser-panel-url-input",
    )
    .first();
  await urlInput.fill(page1Url);
  await urlInput.press("Enter");

  // Wait for URL sync
  await poll(
    () => urlInput.inputValue(),
    (val) => val.includes("page1.html"),
    15_000,
  );

  // Take a screenshot via IPC
  const screenshot = await window.evaluate(() =>
    window.marloues.browser.screenshot(),
  );
  expect(typeof screenshot).toBe("string");
  expect(screenshot.length).toBeGreaterThan(0);

  await window.screenshot({
    path: join(artifactsDir, "06-browser-navigate.png"),
    fullPage: true,
  });
  console.info("Test 5: browser navigate + screenshot — ok");
}

/** Test 6: Browser resize — view-bounds push via ResizeObserver. */
async function testBrowserResize(window: ElectronPage): Promise<void> {
  // Ensure we're on a browser tab
  await switchToTab(window, 2);
  await window.waitForTimeout(300);

  // Get the current container bounds
  const containerBounds = await window.evaluate(() => {
    const el = document.querySelector(
      "section.auxiliary-view-panel:not([hidden]) .browser-panel-container",
    ) as HTMLElement | null;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    };
  });
  expect(containerBounds).not.toBeNull();
  expect(containerBounds!.width).toBeGreaterThan(0);
  expect(containerBounds!.height).toBeGreaterThan(0);

  // Resize the window smaller
  await window.setViewportSize({ width: 1000, height: 700 });
  await window.waitForTimeout(500);

  // Get the new container bounds after resize
  const newBounds = await window.evaluate(() => {
    const el = document.querySelector(
      "section.auxiliary-view-panel:not([hidden]) .browser-panel-container",
    ) as HTMLElement | null;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    };
  });
  expect(newBounds).not.toBeNull();
  // The bounds should have changed after resize (height changes even though sidebar width is fixed)
  const boundsDelta =
    Math.abs(newBounds!.width - containerBounds!.width) +
    Math.abs(newBounds!.height - containerBounds!.height);
  expect(boundsDelta).toBeGreaterThan(0);

  // Restore window size
  await window.setViewportSize({ width: 1440, height: 980 });
  await window.waitForTimeout(300);

  await window.screenshot({
    path: join(artifactsDir, "07-browser-resize.png"),
    fullPage: true,
  });
  console.info("Test 6: browser resize — ok");
}

/** Test 7: Tab switching — non-active browser view hidden. */
async function testTabSwitching(window: ElectronPage): Promise<void> {
  // Switch to first browser tab (index 2)
  await switchToTab(window, 2);
  await window.waitForTimeout(500);

  // Find all auxiliary view panels
  const panels = window.locator(".auxiliary-view-panel");
  const panelCount = await panels.count();
  expect(panelCount).toBeGreaterThanOrEqual(4);

  // The active panel (index 2) should not have [hidden]
  const activePanel = panels.nth(2);
  await expect(activePanel).not.toHaveAttribute("hidden");

  // The non-active browser panel (index 3) should be hidden
  const inactiveBrowserPanel = panels.nth(3);
  await expect(inactiveBrowserPanel).toHaveAttribute("hidden");

  // Switch to second browser tab (index 3)
  await switchToTab(window, 3);
  await window.waitForTimeout(500);

  // Now the formerly active panel should be hidden
  await expect(activePanel).toHaveAttribute("hidden");
  // And the formerly hidden panel should be visible
  await expect(inactiveBrowserPanel).not.toHaveAttribute("hidden");

  await window.screenshot({
    path: join(artifactsDir, "08-tab-switching.png"),
    fullPage: true,
  });
  console.info("Test 7: tab switching — ok");
}

/**
 * Test 8: Browser annotation → editable composer → structured message.
 *
 * The interaction with the local fixture happens through Electron's exposed
 * CDP endpoint, so the element selection and popup submission run inside the
 * actual WebContentsView that the user sees.
 */
async function testBrowserAnnotationComposer(
  window: ElectronPage,
  remoteBrowser: Awaited<ReturnType<typeof chromium.connectOverCDP>>,
  annotationPageUrl: string,
): Promise<void> {
  await switchToTab(window, 2);
  await window.waitForTimeout(300);

  const browserPages = await listBrowserPages(window);
  const annotationPageId = browserPages.find((page) =>
    page.url.includes("page1.html"),
  )?.pageId;
  expect(annotationPageId).toBeDefined();

  await window.evaluate(
    ({ pageId, url }) => window.marloues.browser.viewNavigate(pageId, url),
    { pageId: annotationPageId!, url: annotationPageUrl },
  );

  const urlInput = window
    .locator(
      "section.auxiliary-view-panel:not([hidden]) .browser-panel-url-input",
    )
    .first();
  await poll(
    () => urlInput.inputValue(),
    (value) => value.includes("annotation-page.html"),
  );

  const annotationPage = (await poll(
    async () => {
      const pages = remoteBrowser
        .contexts()
        .flatMap((context) => context.pages());
      return pages.find((page) => page.url() === annotationPageUrl) ?? null;
    },
    (page) => page !== null,
    15_000,
  ))!;

  const annotationModeButton = window
    .locator("section.auxiliary-view-panel:not([hidden])")
    .getByTitle("进入标注模式");
  await expect(annotationModeButton).toBeVisible();
  await annotationModeButton.click();

  await annotationPage.locator("#annotation-target").click();
  await expect(annotationPage.locator(".ec-popup-textarea")).toBeVisible();
  await annotationPage.locator(".ec-popup-textarea").fill("第一个真实页面注释");
  await annotationPage.locator(".ec-popup-send").click();

  const composer = window.locator(".composer textarea");
  await expect(composer).toContainText("页面注释", { timeout: 15_000 });
  await expect(composer).toContainText("第一个真实页面注释");
  const firstChip = window
    .locator(".composer-skill-token")
    .filter({ hasText: "页面注释" });
  await expect(firstChip).toHaveCount(1);
  await expect(firstChip).toContainText("<button>");

  await window.screenshot({
    path: join(artifactsDir, "09-browser-annotation-composer.png"),
    fullPage: true,
  });

  // Removing the metadata chip must leave the user-editable text intact.
  await firstChip.getByRole("button", { name: "移除页面注释" }).click();
  await expect(firstChip).toHaveCount(0);
  await expect(composer).toContainText("第一个真实页面注释");

  // Add a second annotation so the message sent below retains structured
  // browser metadata after the remove-chip interaction has been verified.
  await annotationPage.locator("#annotation-target-two").click();
  await expect(annotationPage.locator(".ec-popup-textarea")).toBeVisible();
  await annotationPage.locator(".ec-popup-textarea").fill("第二个真实页面注释");
  await annotationPage.locator(".ec-popup-send").click();

  await expect(firstChip).toHaveCount(1, { timeout: 15_000 });
  const composedText = await composer.inputValue();
  await composer.fill(`${composedText}\n\n补充说明：请优先处理这个按钮。`);

  await window.getByRole("button", { name: "发送消息" }).click();

  const persisted = await poll(
    () =>
      window.evaluate(async () => {
        const session = (await window.marloues.chat.listSessions())[0];
        if (!session) return null;
        const thread = await window.marloues.chat.readThread(session.id);
        const userContent =
          thread?.turns
            .flatMap((turn) => turn.items)
            .filter((item) => item.type === "userMessage")
            .flatMap((item) => item.content) ?? [];
        return { sessionId: session.id, userContent };
      }),
    (value) =>
      Boolean(
        value?.userContent.some(
          (item) =>
            item.type === "browserComment" &&
            item.comment === "第二个真实页面注释",
        ),
      ),
    15_000,
  );

  const textItem = persisted!.userContent.find((item) => item.type === "text");
  expect(textItem?.type).toBe("text");
  if (textItem?.type === "text") {
    expect(textItem.text).toContain("第一个真实页面注释");
    expect(textItem.text).toContain("补充说明：请优先处理这个按钮。");
  }
  const browserComment = persisted!.userContent.find(
    (item) =>
      item.type === "browserComment" && item.comment === "第二个真实页面注释",
  );
  expect(browserComment?.type).toBe("browserComment");
  if (browserComment?.type === "browserComment") {
    expect(browserComment.ref).toContain("annotation-target-two");
    expect(browserComment.tagName.toLowerCase()).toBe("button");
    expect(browserComment.pageUrl).toBe(annotationPageUrl);
  }

  await expect(window.locator(".workflow-user-message").first()).toContainText(
    "第二个真实页面注释",
  );
  await window.screenshot({
    path: join(artifactsDir, "10-browser-annotation-sent.png"),
    fullPage: true,
  });
  console.info("Test 8: browser annotation composer flow — ok");
}

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------

function writeMinimalSettings(configDir: string): void {
  writeFileSync(
    join(configDir, "settings.json"),
    JSON.stringify(
      {
        agentSettings: {
          providers: [],
          activeRuntimeId: "self-built",
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
          activeToolProfileId: "",
          toolPermissionPolicy: {
            rules: [],
            allowedTools: [],
            disallowedTools: [],
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

function writeWorkspaceSettings(configDir: string, workspace: string): void {
  writeFileSync(
    join(configDir, "workspaces.json"),
    JSON.stringify(
      {
        currentWorkspaceId: "tb-smoke-workspace",
        workspaces: [
          {
            id: "tb-smoke-workspace",
            name: "tb-smoke",
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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!existsSync(mainEntry)) {
    throw new Error(
      "Electron main bundle is missing. Run npm run build first.",
    );
  }

  const liveHome = mkdtempSync(join(tmpdir(), "marloues-tb-smoke-"));
  const workspace = join(liveHome, "workspace");
  const configDir = join(liveHome, "config");
  mkdirSync(workspace, { recursive: true });
  mkdirSync(configDir, { recursive: true });
  mkdirSync(artifactsDir, { recursive: true });

  writeMinimalSettings(configDir);
  writeWorkspaceSettings(configDir, workspace);

  // Local HTML test pages for browser testing (no network dependency)
  const page1Path = join(workspace, "page1.html");
  const page2Path = join(workspace, "page2.html");
  const annotationPagePath = join(workspace, "annotation-page.html");
  writeFileSync(
    page1Path,
    "<!DOCTYPE html><html><head><title>Page One</title></head>" +
      '<body><h1 id="marker">PAGE_ONE_MARKER</h1></body></html>',
    "utf-8",
  );
  writeFileSync(
    page2Path,
    "<!DOCTYPE html><html><head><title>Page Two</title></head>" +
      '<body><h1 id="marker">PAGE_TWO_MARKER</h1></body></html>',
    "utf-8",
  );
  writeFileSync(
    annotationPagePath,
    "<!DOCTYPE html><html><head><title>Annotation Page</title></head>" +
      '<body><main><h1>ANNOTATION_PAGE_MARKER</h1><button id="annotation-target">ANNOTATION_TARGET_ONE</button><button id="annotation-target-two">ANNOTATION_TARGET_TWO</button></main></body></html>',
    "utf-8",
  );
  const page1Url = pathToFileURL(page1Path).href;
  const page2Url = pathToFileURL(page2Path).href;
  const annotationPageUrl = pathToFileURL(annotationPagePath).href;

  console.info("=== Marloues terminal-browser smoke ===");
  console.info(`Home: ${liveHome}`);

  const app = await electron.launch({
    args: [mainEntry],
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      MARLOUES_HOME: liveHome,
    },
  });
  const remoteBrowser = (await poll(
    () => chromium.connectOverCDP("http://127.0.0.1:9223").catch(() => null),
    (browser) => browser !== null,
    15_000,
  ))!;

  try {
    const window = await app.firstWindow();
    await window.setViewportSize({ width: 1440, height: 980 });
    await completeOnboarding(window);
    await expect(window.locator(".app-shell")).toBeVisible();

    // Open auxiliary sidebar
    await openAuxiliarySidebar(window);
    await window.screenshot({
      path: join(artifactsDir, "01-auxiliary-open.png"),
      fullPage: true,
    });

    // Run all 8 test cases
    const firstSessionId = await testTerminalExecute(window);
    await testTerminalMultiTab(window, firstSessionId);
    await testTerminalReloadRecovery(window);
    await testBrowserMultiTab(window, page1Url, page2Url);
    await testBrowserNavigate(window, page1Url);
    await testBrowserResize(window);
    await testTabSwitching(window);
    await testBrowserAnnotationComposer(
      window,
      remoteBrowser,
      annotationPageUrl,
    );

    console.info("terminal-browser smoke ok");
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
    await remoteBrowser.close().catch(() => undefined);
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
