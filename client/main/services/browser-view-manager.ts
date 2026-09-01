import { BrowserWindow, webContents, type WebContents } from "electron";
import { logInfo, logWarn } from "../core/logging/app-logger";

interface ManagedView {
  pageId: string;
  url: string;
  committedUrl: string;
  title: string;
  webContentsId: number | undefined;
  failedUrl?: string;
}

interface BrowserNavigationState {
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
}

/**
 * Manages renderer-side `<webview>` tags for the user-facing browser panel.
 *
 * This is separate from CdpBrowserService (which manages CDP-driven operations
 * for agent interactions). BrowserViewManager provides the visible browser
 * surface that lives inside the renderer DOM, allowing React overlays (image
 * lightbox, menus, auxiliary items) to stack above it naturally via CSS
 * z-index — no native surface obscuring or snapshot workarounds needed.
 *
 * Views are tracked by pageId. The renderer creates a `<webview>` tag
 * imperatively and reports the webContentsId back to the main process via
 * `browser:register-webview` after the `did-attach` event fires.
 */
class BrowserViewManagerImpl {
  private views = new Map<string, ManagedView>();
  private backgroundColor = "#212121";

  createView(pageId: string, url: string): void {
    const existing = this.views.get(pageId);
    if (existing) {
      this.navigate(pageId, url);
      return;
    }

    const managed: ManagedView = {
      pageId,
      url: url || "about:blank",
      committedUrl: "about:blank",
      title: "",
      webContentsId: undefined,
    };

    this.views.set(pageId, managed);
    logInfo("browserView.create", { pageId, url });
  }

  /**
   * Called by the renderer after a `<webview>` tag's `did-attach` event fires.
   * Stores the webContentsId, sets up event listeners, and loads the initial
   * URL if one was provided at view creation time.
   */
  registerWebview(pageId: string, webContentsId: number): void {
    const managed = this.views.get(pageId);
    if (!managed) {
      logWarn("browserView.registerWebview.notFound", { pageId });
      return;
    }

    managed.webContentsId = webContentsId;
    const wc = this.getWebContents(pageId);
    if (!wc) {
      logWarn("browserView.registerWebview.webContentsUnavailable", {
        pageId,
        webContentsId,
      });
      return;
    }

    wc.on("did-navigate", (_event, targetUrl: string) => {
      const m = this.views.get(pageId);
      if (m) {
        m.url = targetUrl;
        m.committedUrl = targetUrl;
        m.failedUrl = undefined;
        this.emitUrlChanged(pageId, targetUrl);
        this.emitNavigationState(pageId);
      }
    });
    wc.on("did-navigate-in-page", (_event, targetUrl: string) => {
      const m = this.views.get(pageId);
      if (m) {
        m.url = targetUrl;
        m.committedUrl = targetUrl;
        m.failedUrl = undefined;
        this.emitUrlChanged(pageId, targetUrl);
        this.emitNavigationState(pageId);
      }
    });
    wc.on("did-start-loading", () => {
      this.emitNavigationState(pageId);
    });
    wc.on("did-stop-loading", () => {
      this.emitNavigationState(pageId);
    });
    wc.on("page-title-updated", (_event, title: string) => {
      const m = this.views.get(pageId);
      if (m) {
        m.title = title;
        this.emitTitleChanged(pageId, title);
      }
    });
    wc.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
        if (!isMainFrame || errorCode === -3) return;
        const m = this.views.get(pageId);
        if (!m) return;
        m.failedUrl = validatedUrl || m.url;
        m.title = "无法访问此站点";
        this.emitTitleChanged(pageId, m.title);
        this.emitLoadFailed(pageId, {
          url: m.failedUrl,
          errorCode,
          errorDescription,
        });
        this.emitNavigationState(pageId);
      },
    );

    // Load the initial URL if it was set at view creation time. The webview
    // tag's `src` attribute is only used to bootstrap the first load; all
    // subsequent navigation goes through `wc.loadURL()` from the main process.
    if (managed.url && managed.url !== "about:blank") {
      wc.loadURL(managed.url).catch(() => {});
    }

    logInfo("browserView.registerWebview", { pageId, webContentsId });
  }

  navigate(pageId: string, url: string): void {
    const managed = this.views.get(pageId);
    if (!managed) {
      logWarn("browserView.navigate.notFound", { pageId });
      return;
    }
    managed.url = url;
    managed.failedUrl = undefined;
    managed.title = "";
    this.emitUrlChanged(pageId, url);
    this.emitTitleChanged(pageId, "");
    const wc = this.getWebContents(pageId);
    if (wc) {
      wc.loadURL(url).catch(() => {});
    }
  }

  goBack(pageId: string): void {
    const managed = this.views.get(pageId);
    if (!managed) return;
    if (managed.failedUrl && managed.committedUrl !== "about:blank") {
      const targetUrl = managed.committedUrl;
      managed.failedUrl = undefined;
      managed.url = targetUrl;
      managed.title = "";
      this.emitUrlChanged(pageId, targetUrl);
      this.emitTitleChanged(pageId, "");
      const wc = this.getWebContents(pageId);
      if (wc) {
        wc.loadURL(targetUrl).catch(() => {});
      }
      return;
    }
    const wc = this.getWebContents(pageId);
    if (wc && wc.navigationHistory.canGoBack()) {
      wc.navigationHistory.goBack();
    }
  }

  goForward(pageId: string): void {
    const wc = this.getWebContents(pageId);
    if (!wc) return;
    if (wc.navigationHistory.canGoForward()) {
      wc.navigationHistory.goForward();
    }
  }

  reload(pageId: string): void {
    const managed = this.views.get(pageId);
    if (!managed) return;
    managed.failedUrl = undefined;
    managed.title = "";
    this.emitTitleChanged(pageId, "");
    const wc = this.getWebContents(pageId);
    if (wc) {
      wc.reload();
    }
  }

  /** Keep blank pages and navigation/loading gaps aligned with the app theme. */
  setBackgroundColor(background: string): void {
    if (!/^#[0-9a-f]{6}$/i.test(background)) return;
    this.backgroundColor = background;
  }

  async capturePage(pageId?: string): Promise<string> {
    const targetId = pageId ?? this.activePageId();
    if (!targetId) return "";
    const wc = this.getWebContents(targetId);
    if (!wc) return "";
    const image = await wc.capturePage();
    return image.toDataURL();
  }

  /** Capture a bounded crop from the visible page for annotation previews. */
  async capturePageRegion(
    pageId: string,
    rect: { x: number; y: number; width: number; height: number },
  ): Promise<string> {
    const wc = this.getWebContents(pageId);
    if (!wc) return "";
    const image = await wc.capturePage({
      x: Math.max(0, Math.floor(rect.x)),
      y: Math.max(0, Math.floor(rect.y)),
      width: Math.max(1, Math.floor(rect.width)),
      height: Math.max(1, Math.floor(rect.height)),
    });
    const maxWidth = 480;
    const maxHeight = 320;
    const size = image.getSize();
    if (size.width > maxWidth || size.height > maxHeight) {
      const scale = Math.min(maxWidth / size.width, maxHeight / size.height);
      return image
        .resize({
          width: Math.max(1, Math.round(size.width * scale)),
          height: Math.max(1, Math.round(size.height * scale)),
        })
        .toDataURL();
    }
    return image.toDataURL();
  }

  destroyView(pageId: string): void {
    const managed = this.views.get(pageId);
    if (!managed) return;
    const wc = this.getWebContents(pageId);
    if (wc && !wc.isDestroyed()) {
      wc.close();
    }
    this.views.delete(pageId);
    logInfo("browserView.destroy", { pageId });
  }

  listViews(): Array<{ pageId: string; url: string; title: string }> {
    return Array.from(this.views.values()).map((v) => ({
      pageId: v.pageId,
      url: v.url,
      title: v.title,
    }));
  }

  getUrl(pageId: string): string | undefined {
    return this.views.get(pageId)?.url;
  }

  /** Exposes the underlying WebContents for CDP attachment by CdpBrowserService. */
  getWebContents(pageId: string): WebContents | undefined {
    const managed = this.views.get(pageId);
    if (!managed?.webContentsId) return undefined;
    const wc = webContents.fromId(managed.webContentsId);
    return wc && !wc.isDestroyed() ? wc : undefined;
  }

  getNavigationState(pageId: string): BrowserNavigationState {
    const wc = this.getWebContents(pageId);
    if (!wc) {
      return { canGoBack: false, canGoForward: false, isLoading: false };
    }
    const managed = this.views.get(pageId);
    return {
      canGoBack: managed?.failedUrl
        ? managed.committedUrl !== "about:blank"
        : wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      isLoading: wc.isLoading(),
    };
  }

  destroyAll(): void {
    for (const pageId of Array.from(this.views.keys())) {
      this.destroyView(pageId);
    }
  }

  private activePageId(): string | undefined {
    // Return the first view that has a registered webContentsId
    for (const managed of this.views.values()) {
      if (managed.webContentsId !== undefined) return managed.pageId;
    }
    return undefined;
  }

  private getMainWindow(): BrowserWindow | null {
    const wins = BrowserWindow.getAllWindows();
    return wins.find((w) => !w.isDestroyed()) ?? null;
  }

  private emitUrlChanged(pageId: string, url: string): void {
    const win = this.getMainWindow();
    if (!win || win.isDestroyed()) return;
    win.webContents.send("browser:url-changed", undefined, pageId, url);
  }

  private emitTitleChanged(pageId: string, title: string): void {
    const win = this.getMainWindow();
    if (!win || win.isDestroyed()) return;
    win.webContents.send("browser:title-changed", pageId, title);
  }

  private emitLoadFailed(
    pageId: string,
    error: { url: string; errorCode: number; errorDescription: string },
  ): void {
    const win = this.getMainWindow();
    if (!win || win.isDestroyed()) return;
    win.webContents.send("browser:load-failed", pageId, error);
  }

  private emitNavigationState(pageId: string): void {
    const win = this.getMainWindow();
    if (!win || win.isDestroyed()) return;
    win.webContents.send(
      "browser:navigation-state-changed",
      pageId,
      this.getNavigationState(pageId),
    );
  }
}

export const browserViewManager = new BrowserViewManagerImpl();
