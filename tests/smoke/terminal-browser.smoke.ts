import {
  _electron as electron,
  chromium,
  expect,
} from "../../client/node_modules/@playwright/test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = join(__dirname, "..", "..");
const mainEntry = join(repoRoot, "client", "out", "main", "index.js");
const artifactsDir = join(repoRoot, "test-artifacts", "terminal-browser-smoke");

type ElectronApplication = Awaited<ReturnType<typeof electron.launch>>;
type ElectronPage = ElectronApplication["windows"][number];

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

/** Reserve an ephemeral loopback port for the app's CDP server. */
async function getAvailableLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Unable to allocate CDP port")));
        return;
      }
      const { port } = address;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

type NativeWindowBounds = {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Captures the operating system's composited Electron window on macOS.
 * Verifies that the webview content is actually composited on screen, not just
 * present in the renderer DOM.
 */
function captureCompositedElectronWindow(
  app: ElectronApplication,
  path: string,
): NativeWindowBounds | null {
  if (process.platform !== "darwin") return null;
  const pid = app.process().pid;
  if (!pid) throw new Error("Electron process PID is unavailable");

  const script = String.raw`
import Foundation
import CoreGraphics
let targetPid = Int(CommandLine.arguments[1])!
let infos = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as! [[String: Any]]
for info in infos {
  guard (info[kCGWindowOwnerPID as String] as? Int) == targetPid,
        let id = info[kCGWindowNumber as String] as? Int,
        let bounds = info[kCGWindowBounds as String] as? [String: Any],
        let x = bounds["X"] as? Double,
        let y = bounds["Y"] as? Double,
        let width = bounds["Width"] as? Double,
        let height = bounds["Height"] as? Double,
        width > 300, height > 300 else { continue }
  print("\(id),\(x),\(y),\(width),\(height)")
  break
}
`;
  const swiftSourcePath = `${path}.swift`;
  writeFileSync(swiftSourcePath, script, "utf-8");
  const output = execFileSync(
    "/usr/bin/swift",
    [swiftSourcePath, String(pid)],
    {
      encoding: "utf-8",
    },
  ).trim();
  if (!output) {
    throw new Error(`Could not find a visible Electron window for PID ${pid}`);
  }
  const [id, x, y, width, height] = output.split(",").map(Number);
  if (![id, x, y, width, height].every(Number.isFinite)) {
    throw new Error(`Unexpected macOS window metadata: ${output}`);
  }
  try {
    execFileSync("/usr/sbin/screencapture", ["-x", `-l${id}`, path], {
      stdio: "pipe",
    });
  } catch (error) {
    // Screen Recording permission is not available in every CI/automation
    // environment. The rest of this Electron smoke remains deterministic;
    // a local run with the permission enabled performs the pixel assertion.
    console.warn(
      `Skipping OS-composited screenshot assertion: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
  return { id, x, y, width, height };
}

/** Read an RGB pixel from an image using the locally available Pillow runtime. */
function readScreenshotPixel(
  path: string,
  x: number,
  y: number,
): [number, number, number] {
  const script =
    "from PIL import Image\n" +
    "import sys\n" +
    "im=Image.open(sys.argv[1]).convert('RGB')\n" +
    "x=min(max(0, int(round(float(sys.argv[2])))), im.width-1)\n" +
    "y=min(max(0, int(round(float(sys.argv[3])))), im.height-1)\n" +
    "print(','.join(map(str, im.getpixel((x,y)))))\n";
  const output = execFileSync(
    "python3",
    ["-c", script, path, String(x), String(y)],
    {
      encoding: "utf-8",
    },
  ).trim();
  const values = output.split(",").map(Number);
  if (values.length !== 3 || !values.every(Number.isFinite)) {
    throw new Error(`Unexpected screenshot pixel value: ${output}`);
  }
  return values as [number, number, number];
}

/** Translate a DOM point into a native window screenshot pixel coordinate. */
function nativeScreenshotPoint(
  bounds: NativeWindowBounds,
  screenshotPath: string,
  domX: number,
  domY: number,
): { x: number; y: number } {
  const size = execFileSync(
    "python3",
    [
      "-c",
      "from PIL import Image; import sys; print(*Image.open(sys.argv[1]).size)",
      screenshotPath,
    ],
    {
      encoding: "utf-8",
    },
  )
    .trim()
    .split(/\s+/)
    .map(Number);
  const scaleX = size[0]! / bounds.width;
  const scaleY = size[1]! / bounds.height;
  return { x: domX * scaleX, y: domY * scaleY };
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
  const expanded = await toggle.getAttribute("aria-pressed");
  if (expanded !== "true") {
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
  app: ElectronApplication,
  window: ElectronPage,
  page1Url: string,
  remoteBrowser: Awaited<ReturnType<typeof chromium.connectOverCDP>>,
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

  // This must load the actual local page through the user-facing address bar,
  // not merely preserve the text in the input.
  const localPage = await poll(
    () =>
      remoteBrowser
        .contexts()
        .flatMap((context) => context.pages())
        .find((page) => page.url() === page1Url) ?? null,
    (page) => page !== null,
    15_000,
  );
  await expect(localPage!.locator("#marker")).toHaveText("PAGE_ONE_MARKER");

  // A URL and a CDP page are insufficient evidence: the renderer must have
  // non-zero geometry to display the webview in the window.
  const browserRect = await window.evaluate(() => {
    const element = document.querySelector(
      "section.auxiliary-view-panel:not([hidden]) .browser-panel-container",
    );
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  });
  expect(browserRect).not.toBeNull();
  expect(browserRect!.width).toBeGreaterThan(0);
  expect(browserRect!.height).toBeGreaterThan(0);

  // Verify the OS-composited Electron window rather than renderer DOM alone.
  // A webview can load through CDP while still being invisible here.
  const compositedPath = join(artifactsDir, "06a-browser-composited.png");
  const nativeWindow = captureCompositedElectronWindow(app, compositedPath);
  if (nativeWindow) {
    const point = nativeScreenshotPoint(
      nativeWindow,
      compositedPath,
      browserRect!.left + browserRect!.width / 2,
      browserRect!.top + browserRect!.height / 2,
    );
    const pixel = readScreenshotPixel(compositedPath, point.x, point.y);
    // Fixture page one uses saturated blue as its full-page background.
    expect(pixel[2]).toBeGreaterThan(180);
    expect(pixel[0]).toBeLessThan(80);
  }

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

/** Test 7: Browser resize — container dimensions after viewport change. */
/** Test 7: Browser resize — view-bounds push via ResizeObserver. */
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

/** Test 8: Tab switching — non-active browser view hidden. */
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
  browserTabIndex = 2,
): Promise<void> {
  await switchToTab(window, browserTabIndex);
  await window.waitForTimeout(300);

  const browserPages = await listBrowserPages(window);
  const annotationPageId =
    browserPages.find((page) => page.url.includes("page1.html"))?.pageId ??
    browserPages[0]?.pageId;
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
    .getByTitle("进入批注模式");
  await expect(annotationModeButton).toBeVisible();
  await annotationModeButton.click();

  const annotationBar = window.locator(".browser-annotation-bar");
  await expect(annotationBar).toContainText("正在批注");
  await expect(annotationPage.locator(".ec-interaction-shield")).toBeVisible();

  // Escape is captured inside the real WebContentsView and exits only the
  // annotation mode, even though focus never returned to the app toolbar.
  await annotationPage.keyboard.press("Escape");
  await expect(annotationBar).toHaveCount(0);
  await expect(annotationPage.locator(".ec-interaction-shield")).toHaveCount(0);
  await expect(
    window
      .locator("section.auxiliary-view-panel:not([hidden])")
      .locator(".browser-panel-toolbar"),
  ).toBeVisible();
  await expect(window.locator(".thread-inspector-toggle")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await annotationModeButton.click();
  await expect(annotationBar).toContainText("正在批注");
  await expect(annotationPage.locator(".ec-interaction-shield")).toBeVisible();

  // A target flush with the embedded page's top-left edge must still render
  // both edge borders. Outlines with a positive offset were clipped here.
  const edgeTarget = annotationPage.locator("#annotation-edge-target");
  const edgeTargetBox = await edgeTarget.boundingBox();
  expect(edgeTargetBox).not.toBeNull();
  if (!edgeTargetBox)
    throw new Error("edge annotation target was not laid out");
  expect(edgeTargetBox.x).toBe(0);
  expect(edgeTargetBox.y).toBe(0);
  await annotationPage.mouse.click(
    edgeTargetBox.x + edgeTargetBox.width / 2,
    edgeTargetBox.y + edgeTargetBox.height / 2,
  );
  const edgeSelection = annotationPage.locator(".ec-selection-outline");
  await expect(edgeSelection).toBeVisible();
  await expect(edgeSelection).toHaveCSS("border-top-style", "solid");
  await expect(edgeSelection).toHaveCSS("border-left-style", "solid");
  const edgeSelectionBox = await edgeSelection.boundingBox();
  expect(edgeSelectionBox).not.toBeNull();
  if (!edgeSelectionBox)
    throw new Error("edge annotation selection was not laid out");
  expect(edgeSelectionBox.x).toBe(0);
  expect(edgeSelectionBox.y).toBe(0);
  const edgeScreenshotPath = join(
    artifactsDir,
    "09-edge-browser-annotation.png",
  );
  await annotationPage.screenshot({ path: edgeScreenshotPath });
  const edgePixels = [
    readScreenshotPixel(edgeScreenshotPath, 90, 1),
    readScreenshotPixel(edgeScreenshotPath, 1, 30),
  ];
  for (const [red, green, blue] of edgePixels) {
    expect(blue).toBeGreaterThan(200);
    expect(blue - red).toBeGreaterThan(100);
    expect(blue - green).toBeGreaterThan(50);
  }
  await annotationPage.getByRole("button", { name: "编辑元素样式" }).click();
  await annotationPage.getByRole("button", { name: "取消批注" }).click();
  await expect(annotationPage.locator(".ec-popup")).toHaveCount(0);

  // Annotation mode receives pointer events through the overlay. The local
  // page counters prove that neither hover nor click reaches its own handlers.
  const targetBox = await annotationPage
    .locator("#annotation-target")
    .boundingBox();
  expect(targetBox).not.toBeNull();
  if (!targetBox) throw new Error("annotation target was not laid out");
  const targetPoint = {
    x: targetBox.x + targetBox.width / 2,
    y: targetBox.y + targetBox.height / 2,
  };
  await annotationPage.mouse.move(targetPoint.x, targetPoint.y);
  await expect
    .poll(() =>
      annotationPage.evaluate(() => ({
        clicks: Number(document.body.dataset.annotationClicks ?? 0),
        hovers: Number(document.body.dataset.annotationHovers ?? 0),
      })),
    )
    .toEqual({ clicks: 0, hovers: 0 });
  await annotationPage.mouse.click(targetPoint.x, targetPoint.y);
  await expect(annotationPage.locator(".ec-comment-input")).toBeVisible();
  await expect(annotationPage.locator(".ec-selection-outline")).toBeVisible();
  await expect(annotationPage.locator(".ec-style-editor")).toBeHidden();
  await expect(
    annotationPage.getByRole("button", { name: "编辑元素样式" }),
  ).toHaveAttribute("aria-pressed", "false");
  await annotationPage.screenshot({
    path: join(artifactsDir, "09a-browser-annotation-compact.png"),
  });
  await annotationPage.getByRole("button", { name: "编辑元素样式" }).click();
  await expect(
    annotationPage.getByRole("textbox", { name: "编辑文本颜色" }),
  ).toBeVisible();
  await expect(annotationPage.locator(".ec-style-editor")).toBeVisible();
  await expect(
    annotationPage.getByRole("button", { name: "编辑元素样式" }),
  ).toHaveAttribute("aria-pressed", "true");
  await annotationPage.screenshot({
    path: join(artifactsDir, "09b-browser-annotation-style-editor.png"),
  });
  await annotationPage
    .getByRole("textbox", { name: "编辑文本颜色" })
    .fill("rgb(255, 0, 0)");
  await expect
    .poll(() =>
      annotationPage
        .locator("#annotation-target")
        .evaluate((element) => getComputedStyle(element).color),
    )
    .toBe("rgb(255, 0, 0)");
  await expect
    .poll(() =>
      annotationPage.evaluate(() => ({
        clicks: Number(document.body.dataset.annotationClicks ?? 0),
        hovers: Number(document.body.dataset.annotationHovers ?? 0),
      })),
    )
    .toEqual({ clicks: 0, hovers: 0 });
  await annotationPage.locator(".ec-comment-input").fill("第一个真实页面注释");
  await annotationPage.locator(".ec-popup-send").click();
  await expect(annotationPage.locator(".ec-comment-marker")).toHaveCount(1);
  await expect(
    annotationBar.getByRole("button", { name: "发送 1" }),
  ).toBeEnabled();

  // Editing is previewed, but cancelling an element annotation restores the
  // page's original inline styles and does not add another attachment.
  const cancelTargetBox = await annotationPage
    .locator("#annotation-target-two")
    .boundingBox();
  expect(cancelTargetBox).not.toBeNull();
  if (!cancelTargetBox)
    throw new Error("cancel annotation target was not laid out");
  await annotationPage.mouse.click(
    cancelTargetBox.x + cancelTargetBox.width / 2,
    cancelTargetBox.y + cancelTargetBox.height / 2,
  );
  await annotationPage.getByRole("button", { name: "编辑元素样式" }).click();
  const backgroundField = annotationPage.getByRole("textbox", {
    name: "编辑背景",
  });
  await expect(backgroundField).toBeVisible();
  await backgroundField.fill("rgb(255, 255, 0)");
  await expect
    .poll(() =>
      annotationPage
        .locator("#annotation-target-two")
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    )
    .toBe("rgb(255, 255, 0)");
  await annotationPage.getByRole("button", { name: "取消批注" }).click();
  await expect(annotationPage.locator(".ec-popup")).toHaveCount(0);
  await expect
    .poll(() =>
      annotationPage
        .locator("#annotation-target-two")
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    )
    .not.toBe("rgb(255, 255, 0)");
  await expect(annotationPage.locator(".ec-comment-marker")).toHaveCount(1);

  const composer = window.locator(".composer textarea");
  await expect(composer).toHaveValue("");
  const browserReview = window.locator(".composer-browser-review");
  await expect(browserReview).toHaveCount(1, { timeout: 15_000 });
  await expect(
    browserReview.getByRole("button", { name: "页面批注，1 条" }),
  ).toBeVisible();
  await expect(composer).toHaveValue("");

  // Text remains untouched while saved page annotations are immediately added
  // as structured composer attachments.
  await composer.fill("补充说明：请优先处理这个按钮。");

  // A dragged page area joins the same review group as element annotations.
  // This runs through the actual WebContentsView event bridge, not a mocked
  // renderer callback.
  const region = annotationPage.locator("#annotation-region");
  const regionBox = await region.boundingBox();
  expect(regionBox).not.toBeNull();
  if (!regionBox) throw new Error("annotation region was not laid out");
  await annotationPage.mouse.move(regionBox.x + 20, regionBox.y + 20);
  await annotationPage.mouse.down();
  await annotationPage.mouse.move(regionBox.x + 180, regionBox.y + 85, {
    steps: 8,
  });
  await annotationPage.mouse.up();
  await expect(annotationPage.locator(".ec-comment-input")).toBeVisible();
  await expect(annotationPage.locator(".ec-selection-outline")).toBeVisible();
  await expect(annotationPage.locator(".ec-style-editor")).toHaveCount(0);
  await annotationPage.locator(".ec-comment-input").fill("第二个真实区域注释");
  await annotationPage.locator(".ec-popup-send").click();

  await expect(annotationPage.locator(".ec-comment-marker")).toHaveCount(2);
  await expect(browserReview).toHaveCount(1, { timeout: 15_000 });
  await expect(
    browserReview.getByRole("button", { name: "页面批注，2 条" }),
  ).toBeVisible();
  await browserReview.getByRole("button", { name: "页面批注，2 条" }).click();
  const reviewDetails = window.locator("#composer-browser-review-details");
  await expect(reviewDetails).toBeVisible();
  await expect(reviewDetails).toContainText("第一个真实页面注释");
  await expect(reviewDetails).toContainText("第二个真实区域注释");
  await expect(reviewDetails).toContainText("页面区域");
  await expect(reviewDetails.locator("img")).toHaveCount(2);
  await expect(composer).toHaveValue("补充说明：请优先处理这个按钮。");

  // Removing one composer attachment removes exactly the same page marker.
  // The remaining marker keeps its stable id so later removals cannot target
  // the wrong annotation after a renumber.
  await reviewDetails
    .getByRole("button", { name: "移除第 2 条页面注释" })
    .click();
  await expect(annotationPage.locator(".ec-comment-marker")).toHaveCount(1);
  await expect(annotationPage.locator(".ec-comment-marker")).toHaveText("1");
  await expect(
    browserReview.getByRole("button", { name: "页面批注，1 条" }),
  ).toBeVisible();

  // Add the region annotation again. Its id advances instead of reusing or
  // renumbering an existing marker.
  await annotationPage.mouse.move(regionBox.x + 20, regionBox.y + 20);
  await annotationPage.mouse.down();
  await annotationPage.mouse.move(regionBox.x + 180, regionBox.y + 85, {
    steps: 8,
  });
  await annotationPage.mouse.up();
  await annotationPage.locator(".ec-comment-input").fill("第二个真实区域注释");
  await annotationPage.locator(".ec-popup-send").click();
  await expect(annotationPage.locator(".ec-comment-marker")).toHaveCount(2);
  await expect(annotationPage.locator(".ec-comment-marker").nth(0)).toHaveText(
    "1",
  );
  await expect(annotationPage.locator(".ec-comment-marker").nth(1)).toHaveText(
    "3",
  );
  await expect(
    browserReview.getByRole("button", { name: "页面批注，2 条" }),
  ).toBeVisible();

  await window.screenshot({
    path: join(artifactsDir, "09-browser-annotation-composer.png"),
    fullPage: true,
  });

  // Annotation-bar send follows the primary composer submit path. It must
  // create a user message without an additional click on the composer button.
  await annotationBar.getByRole("button", { name: "发送 2" }).click();
  await expect(browserReview).toHaveCount(0, { timeout: 15_000 });

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
            item.type === "text" &&
            item.text === "补充说明：请优先处理这个按钮。",
        ) &&
        value?.userContent.some(
          (item) =>
            item.type === "browserComment" &&
            item.comment === "第一个真实页面注释",
        ) &&
        value?.userContent.some(
          (item) =>
            item.type === "browserComment" &&
            item.comment === "第二个真实区域注释",
        ),
      ),
    15_000,
  );

  const textItem = persisted!.userContent.find((item) => item.type === "text");
  expect(textItem?.type).toBe("text");
  if (textItem?.type === "text") {
    expect(textItem.text).toBe("补充说明：请优先处理这个按钮。");
  }
  const elementComment = persisted!.userContent.find(
    (item) =>
      item.type === "browserComment" && item.comment === "第一个真实页面注释",
  );
  expect(elementComment?.type).toBe("browserComment");
  if (elementComment?.type === "browserComment") {
    expect(elementComment.targetType).toBe("element");
    expect(elementComment.pageUrl).toBe(annotationPageUrl);
    expect(elementComment.screenshotDataUrl).toMatch(/^data:image\//);
    expect(elementComment.styleEdits).toEqual({ color: "rgb(255, 0, 0)" });
  }
  const browserComment = persisted!.userContent.find(
    (item) =>
      item.type === "browserComment" && item.comment === "第二个真实区域注释",
  );
  expect(browserComment?.type).toBe("browserComment");
  if (browserComment?.type === "browserComment") {
    expect(browserComment.targetType).toBe("region");
    expect(browserComment.ref).toContain("viewport region");
    expect(browserComment.tagName).toBe("");
    expect(browserComment.rect.width).toBeGreaterThanOrEqual(150);
    expect(browserComment.rect.height).toBeGreaterThanOrEqual(60);
    expect(browserComment.pageUrl).toBe(annotationPageUrl);
    expect(browserComment.screenshotDataUrl).toMatch(/^data:image\//);
  }

  await expect(window.locator(".workflow-user-message").first()).toContainText(
    "第二个真实区域注释",
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
    "<!DOCTYPE html><html><head><title>Page One</title><style>html,body{margin:0;width:100%;height:100%;background:#1677ff;color:white;font:700 32px sans-serif}#marker{padding:36px}</style></head>" +
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
    "<!DOCTYPE html><html><head><title>Annotation Page</title><style>html,body{margin:0}#annotation-edge-target{position:fixed;left:0;top:0;width:180px;height:60px;border:0;background:#d9eaff}main{padding:84px 16px 16px}</style></head>" +
      '<body data-annotation-clicks="0" data-annotation-hovers="0"><button id="annotation-edge-target">EDGE_ANNOTATION_TARGET</button><main><h1>ANNOTATION_PAGE_MARKER</h1><button id="annotation-target" style="color:rgb(0, 0, 0)">ANNOTATION_TARGET_ONE</button><button id="annotation-target-two">ANNOTATION_TARGET_TWO</button><div id="annotation-region" style="width:280px;height:130px;margin-top:24px;border:1px solid #333">ANNOTATION_REGION_TARGET</div></main><script>const target=document.querySelector("#annotation-target");target.addEventListener("click",()=>document.body.dataset.annotationClicks=String(Number(document.body.dataset.annotationClicks||0)+1));target.addEventListener("mouseenter",()=>document.body.dataset.annotationHovers=String(Number(document.body.dataset.annotationHovers||0)+1));</script></body></html>',
    "utf-8",
  );
  const page1Url = pathToFileURL(page1Path).href;
  const page2Url = pathToFileURL(page2Path).href;
  const annotationPageUrl = pathToFileURL(annotationPagePath).href;

  console.info("=== Marloues terminal-browser smoke ===");
  console.info(`Home: ${liveHome}`);
  const remoteDebuggingPort = await getAvailableLoopbackPort();

  const app = await electron.launch({
    args: [mainEntry],
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      MARLOUES_HOME: liveHome,
      MARLOUES_REMOTE_DEBUGGING_PORT: String(remoteDebuggingPort),
    },
  });
  const remoteBrowser = (await poll(
    () =>
      chromium
        .connectOverCDP(`http://127.0.0.1:${remoteDebuggingPort}`)
        .catch(() => null),
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

    if (process.argv.includes("--annotation-only")) {
      await window
        .locator(".inspector-empty-cards")
        .getByRole("button", { name: "浏览器" })
        .evaluate((element: HTMLElement) => element.click());
      await testBrowserAnnotationComposer(
        window,
        remoteBrowser,
        annotationPageUrl,
        0,
      );
    } else {
      // Run browser/terminal smoke cases.
      const firstSessionId = await testTerminalExecute(window);
      await testTerminalMultiTab(window, firstSessionId);
      await testTerminalReloadRecovery(window);
      await testBrowserMultiTab(window, page1Url, page2Url);
      await testBrowserNavigate(app, window, page1Url, remoteBrowser);
      await testBrowserResize(window);
      await testTabSwitching(window);
      await testBrowserAnnotationComposer(
        window,
        remoteBrowser,
        annotationPageUrl,
      );
    }

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
