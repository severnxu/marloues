import { EventEmitter } from "node:events";
import type { AgentSettings } from "@shared/types";
import { logInfo, logWarn } from "../core/logging/app-logger";

export interface BrowserPageInfo {
  pageId: string;
  threadId?: string;
  browserId: string;
  url: string;
  title: string;
  createdAt: number;
  lastActivityAt: number;
}

interface BrowserState {
  browserId: string;
  threadId?: string;
  createdAt: number;
  lastActivityAt: number;
  pages: Set<string>;
  idleTimer?: ReturnType<typeof setTimeout>;
}

interface PageState {
  pageId: string;
  threadId?: string;
  browserId: string;
  url: string;
  title: string;
  createdAt: number;
  lastActivityAt: number;
  // Underlying Playwright Page object — stored directly to avoid fragile index matching.
  pageHandle?: PageHandle;
}

const MAX_BROWSERS = 4;
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

type SecurityRulesGetter = () => AgentSettings["securityRules"];

/**
 * Main-process singleton managing Playwright browser instances.
 * Browser instances are isolated by threadId and survive across turns.
 */
class BrowserServiceImpl extends EventEmitter {
  private browsers = new Map<string, BrowserState>();
  private pages = new Map<string, PageState>();
  private playwrightInstance: typeof import("playwright") | null = null;
  private chromiumExecutablePath: string | undefined;
  private activePageByThread = new Map<string, string>();
  private browserIdByThread = new Map<string, string>();
  private getSecurityRules: SecurityRulesGetter = () => undefined;

  setSecurityRulesGetter(getter: SecurityRulesGetter): void {
    this.getSecurityRules = getter;
  }

  setChromiumExecutablePath(path: string | undefined): void {
    this.chromiumExecutablePath = path;
  }

  async launch(opts?: {
    threadId?: string;
    headless?: boolean;
  }): Promise<string> {
    if (this.browsers.size >= MAX_BROWSERS) {
      const oldest = this.findOldestIdle();
      if (oldest) {
        await this.closeInternal(oldest, "max-browsers-evict");
      } else {
        throw new Error("Maximum browser instances reached.");
      }
    }

    if (!this.playwrightInstance) {
      this.playwrightInstance = await import("playwright");
    }
    const pw = this.playwrightInstance;
    const launchOptions: Parameters<typeof pw.chromium.launch>[0] = {
      headless: opts?.headless ?? true,
    };
    if (this.chromiumExecutablePath) {
      launchOptions.executablePath = this.chromiumExecutablePath;
    }

    const browser = await pw.chromium.launch(launchOptions);
    const browserId = crypto.randomUUID();
    const state: BrowserState = {
      browserId,
      threadId: opts?.threadId,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      pages: new Set(),
    };
    this.browsers.set(browserId, state);
    // Store browser reference on the map entry via closure
    (state as unknown as { _browser: typeof browser })._browser = browser;
    if (opts?.threadId) {
      this.browserIdByThread.set(opts.threadId, browserId);
    }
    this.resetIdleTimer(browserId);
    logInfo("browser.launch", { browserId, threadId: opts?.threadId });
    return browserId;
  }

  async newPage(
    browserId: string,
    url: string,
    threadId?: string,
  ): Promise<string> {
    const state = this.browsers.get(browserId);
    if (!state) throw new Error(`Browser ${browserId} not found.`);
    const browser = (
      state as unknown as { _browser: { newPage: () => Promise<unknown> } }
    )._browser;
    const page = await browser.newPage();
    const pageId = crypto.randomUUID();
    const pageState: PageState = {
      pageId,
      threadId: threadId ?? state.threadId,
      browserId,
      url,
      title: "",
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };
    this.pages.set(pageId, pageState);
    state.pages.add(pageId);
    state.lastActivityAt = Date.now();

    // Attach security interception
    this.attachSecurityInterception(pageId, page, pageState);
    pageState.pageHandle = page as PageHandle;

    if (url) {
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        pageState.url = page.url();
      } catch {
        // navigation timeout is non-fatal
      }
    }

    if (threadId ?? state.threadId) {
      this.activePageByThread.set(threadId ?? state.threadId!, pageId);
    }
    logInfo("browser.newPage", { pageId, browserId, url });
    return pageId;
  }

  async navigate(pageId: string, url: string): Promise<void> {
    const pageState = this.pages.get(pageId);
    if (!pageState) throw new Error(`Page ${pageId} not found.`);
    const page = await this.getPageHandle(pageId);
    if (!page) throw new Error(`Page handle ${pageId} not available.`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    pageState.url = page.url();
    pageState.lastActivityAt = Date.now();
    this.emit("url-changed", pageState.threadId, pageId, pageState.url);
  }

  async screenshot(
    pageId: string,
    opts?: { fullPage?: boolean },
  ): Promise<string> {
    const page = await this.getPageHandle(pageId);
    if (!page) throw new Error(`Page ${pageId} not available.`);
    const buf: Buffer = await page.screenshot({
      fullPage: opts?.fullPage ?? false,
    });
    return buf.toString("base64");
  }

  async click(pageId: string, selector: string): Promise<void> {
    const page = await this.getPageHandle(pageId);
    if (!page) throw new Error(`Page ${pageId} not available.`);
    await page.click(selector, { timeout: 10000 });
    const state = this.pages.get(pageId);
    if (state) state.lastActivityAt = Date.now();
  }

  async fill(pageId: string, selector: string, value: string): Promise<void> {
    const page = await this.getPageHandle(pageId);
    if (!page) throw new Error(`Page ${pageId} not available.`);
    await page.fill(selector, value, { timeout: 10000 });
    const state = this.pages.get(pageId);
    if (state) state.lastActivityAt = Date.now();
  }

  async getContent(pageId: string): Promise<string> {
    const page = await this.getPageHandle(pageId);
    if (!page) throw new Error(`Page ${pageId} not available.`);
    return (await page.content()) as string;
  }

  close(browserId: string): Promise<void> {
    return this.closeInternal(browserId, "user-requested");
  }

  getActivePageId(threadId: string): string | undefined {
    return this.activePageByThread.get(threadId);
  }

  setActivePageId(threadId: string, pageId: string): void {
    this.activePageByThread.set(threadId, pageId);
  }

  getBrowserId(threadId: string): string | undefined {
    return this.browserIdByThread.get(threadId);
  }

  setBrowserId(threadId: string, browserId: string): void {
    this.browserIdByThread.set(threadId, browserId);
  }

  listPages(threadId?: string): BrowserPageInfo[] {
    const results: BrowserPageInfo[] = [];
    for (const [pageId, state] of this.pages) {
      if (threadId && state.threadId !== threadId) continue;
      results.push({
        pageId,
        threadId: state.threadId,
        browserId: state.browserId,
        url: state.url,
        title: state.title,
        createdAt: state.createdAt,
        lastActivityAt: state.lastActivityAt,
      });
    }
    return results;
  }

  async closeByThread(threadId: string): Promise<void> {
    for (const [browserId, state] of this.browsers) {
      if (state.threadId === threadId) {
        await this.closeInternal(browserId, "thread-cleanup");
      }
    }
    this.activePageByThread.delete(threadId);
    this.browserIdByThread.delete(threadId);
  }

  clearByThread(threadId: string): Promise<void> {
    return this.closeByThread(threadId);
  }

  private async getPageHandle(pageId: string): Promise<PageHandle | null> {
    const state = this.pages.get(pageId);
    if (!state?.pageHandle) return null;
    return state.pageHandle;
  }

  private attachSecurityInterception(
    pageId: string,
    page: unknown,
    pageState: PageState,
  ): void {
    const pageObj = page as PageHandle;
    if (!pageObj || typeof pageObj.on !== "function") return;

    pageObj.on("framenavigated", async (frame: { url: () => string }) => {
      const url = frame.url();
      if (!url || url === "about:blank") return;
      const host = this.safeHostname(url);
      if (!host) return;

      const rules = this.getSecurityRules();
      if (!rules) return; // no rules configured → allow

      const denied = this.matchesDomainList(host, rules.deniedDomains ?? []);
      const whitelisted =
        (rules.allowedDomains ?? []).length > 0 &&
        !this.matchesDomainList(host, rules.allowedDomains ?? []);
      const globalDeny = rules.networkAccess === "deny";

      if (denied || whitelisted || globalDeny) {
        logWarn("browser.navigation.blocked", { url, host, pageId });
        try {
          await (
            pageObj as unknown as { goBack: () => Promise<void> }
          ).goBack();
        } catch {
          // best-effort
        }
        this.emit("navigation-blocked", pageId, url, host);
      }
    });

    // Update URL state on navigation
    pageObj.on("framenavigated", (frame: { url: () => string }) => {
      const url = frame.url();
      if (url && url !== "about:blank") {
        pageState.url = url;
        this.emit("url-changed", pageState.threadId, pageId, url);
      }
    });
  }

  private safeHostname(url: string): string | undefined {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return undefined;
    }
  }

  private matchesDomainList(host: string, configured: string[]): boolean {
    const normalizedHost = host.toLowerCase().replace(/\.$/u, "");
    return configured.some((entry) => {
      const domain = entry
        .trim()
        .toLowerCase()
        .replace(/^\*\./u, "")
        .replace(/\.$/u, "");
      return (
        Boolean(domain) &&
        (normalizedHost === domain || normalizedHost.endsWith(`.${domain}`))
      );
    });
  }

  private async closeInternal(
    browserId: string,
    reason: string,
  ): Promise<void> {
    const state = this.browsers.get(browserId);
    if (!state) return;
    const browser = (
      state as unknown as { _browser: { close: () => Promise<void> } }
    )._browser;
    try {
      for (const pageId of state.pages) {
        this.pages.delete(pageId);
      }
      await browser.close();
    } catch {
      // best-effort
    }
    if (state.idleTimer) clearTimeout(state.idleTimer);
    this.browsers.delete(browserId);
    if (state.threadId) {
      this.browserIdByThread.delete(state.threadId);
      this.activePageByThread.delete(state.threadId);
    }
    logInfo("browser.close", { browserId, reason });
  }

  private resetIdleTimer(browserId: string): void {
    const state = this.browsers.get(browserId);
    if (!state) return;
    if (state.idleTimer) clearTimeout(state.idleTimer);
    state.idleTimer = setTimeout(() => {
      const idle = Date.now() - state.lastActivityAt;
      if (idle >= IDLE_TIMEOUT_MS) {
        logWarn("browser.idleTimeout", { browserId, idleMs: idle });
        void this.closeInternal(browserId, "idle-timeout");
      }
    }, IDLE_TIMEOUT_MS);
  }

  private findOldestIdle(): string | undefined {
    let oldest: string | undefined;
    let oldestTime = Date.now();
    for (const [browserId, state] of this.browsers) {
      if (state.lastActivityAt < oldestTime) {
        oldestTime = state.lastActivityAt;
        oldest = browserId;
      }
    }
    return oldest;
  }
}

interface PageHandle {
  on(event: string, listener: (...args: unknown[]) => void): void;
  goto(url: string, opts?: unknown): Promise<unknown>;
  screenshot(opts?: unknown): Promise<Buffer>;
  click(selector: string, opts?: unknown): Promise<void>;
  fill(selector: string, value: string, opts?: unknown): Promise<void>;
  content(): Promise<string>;
  url(): string;
}
export const browserService = new BrowserServiceImpl();
