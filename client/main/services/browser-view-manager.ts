import { BrowserWindow, WebContentsView } from "electron";
import { logInfo, logWarn } from "../core/logging/app-logger";

interface ManagedView {
  view: WebContentsView;
  pageId: string;
  url: string;
  committedUrl: string;
  title: string;
  visible: boolean;
  bounds: { x: number; y: number; width: number; height: number };
  failedUrl?: string;
}

interface BrowserNavigationState {
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
}

/**
 * Manages Electron WebContentsView instances for the user-facing browser panel.
 *
 * This is separate from BrowserService (which manages Playwright headless browsers
 * for model-driven operations). BrowserViewManager provides the visible browser
 * that the user sees in the auxiliary sidebar.
 *
 * Views are tracked by pageId and attached to the main BrowserWindow's contentView.
 * The renderer pushes geometric bounds via `browser:view-bounds` IPC whenever the
 * BrowserPanel container resizes (ResizeObserver / window resize / sidebar toggle).
 * Only the active tab's view is visible; others are zero-sized to hide them.
 */
class BrowserViewManagerImpl {
  private views = new Map<string, ManagedView>();
  private activePageId: string | null = null;
  private backgroundColor = "#212121";

  createView(
    pageId: string,
    url: string,
    bounds: { x: number; y: number; width: number; height: number },
  ): void {
    const existing = this.views.get(pageId);
    if (existing) {
      this.navigate(pageId, url);
      return;
    }

    const win = this.getMainWindow();
    if (!win) {
      logWarn("browserView.create.noWindow", { pageId });
      return;
    }

    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    view.setBackgroundColor(this.backgroundColor);

    view.webContents.on("did-navigate", (_event, targetUrl: string) => {
      const managed = this.views.get(pageId);
      if (managed) {
        managed.url = targetUrl;
        managed.committedUrl = targetUrl;
        managed.failedUrl = undefined;
        this.emitUrlChanged(pageId, targetUrl);
        this.emitNavigationState(pageId);
      }
    });
    view.webContents.on("did-navigate-in-page", (_event, targetUrl: string) => {
      const managed = this.views.get(pageId);
      if (managed) {
        managed.url = targetUrl;
        managed.committedUrl = targetUrl;
        managed.failedUrl = undefined;
        this.emitUrlChanged(pageId, targetUrl);
        this.emitNavigationState(pageId);
      }
    });
    view.webContents.on("did-start-loading", () => {
      this.emitNavigationState(pageId);
    });
    view.webContents.on("did-stop-loading", () => {
      this.emitNavigationState(pageId);
    });
    view.webContents.on("page-title-updated", (_event, title: string) => {
      const managed = this.views.get(pageId);
      if (managed) {
        managed.title = title;
        this.emitTitleChanged(pageId, title);
      }
    });
    view.webContents.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
        if (!isMainFrame || errorCode === -3) return;
        const managed = this.views.get(pageId);
        if (!managed) return;
        managed.failedUrl = validatedUrl || managed.url;
        managed.title = "无法访问此站点";
        this.emitTitleChanged(pageId, managed.title);
        this.emitLoadFailed(pageId, {
          url: managed.failedUrl,
          errorCode,
          errorDescription,
        });
        this.emitNavigationState(pageId);
      },
    );

    const managed: ManagedView = {
      view,
      pageId,
      url: url || "about:blank",
      committedUrl: "about:blank",
      title: "",
      visible: false,
      bounds,
    };

    win.contentView.addChildView(view);
    this.views.set(pageId, managed);
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });

    if (url && url !== "about:blank") {
      view.webContents.loadURL(url).catch(() => {});
    }

    logInfo("browserView.create", { pageId, url });
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
    managed.view.webContents.loadURL(url).catch(() => {});
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
      managed.view.webContents.loadURL(targetUrl).catch(() => {});
      return;
    }
    const history = managed.view.webContents.navigationHistory;
    if (history.canGoBack()) history.goBack();
  }

  goForward(pageId: string): void {
    const managed = this.views.get(pageId);
    if (!managed) return;
    const history = managed.view.webContents.navigationHistory;
    if (history.canGoForward()) history.goForward();
  }

  reload(pageId: string): void {
    const managed = this.views.get(pageId);
    if (!managed) return;
    if (managed.failedUrl) {
      this.navigate(pageId, managed.failedUrl);
      return;
    }
    managed.view.webContents.reload();
  }

  getNavigationState(pageId: string): BrowserNavigationState {
    const managed = this.views.get(pageId);
    if (!managed) {
      return { canGoBack: false, canGoForward: false, isLoading: false };
    }
    const contents = managed.view.webContents;
    return {
      canGoBack:
        contents.navigationHistory.canGoBack() ||
        Boolean(managed.failedUrl && managed.committedUrl !== "about:blank"),
      canGoForward: contents.navigationHistory.canGoForward(),
      isLoading: contents.isLoading(),
    };
  }

  setBounds(
    pageId: string,
    bounds: { x: number; y: number; width: number; height: number },
  ): void {
    const managed = this.views.get(pageId);
    if (!managed) return;
    managed.bounds = bounds;
    if (managed.visible) managed.view.setBounds(bounds);
  }

  setActivePage(pageId: string | null): void {
    if (this.activePageId === pageId) return;
    this.activePageId = pageId;
    for (const [pid, managed] of this.views) {
      if (pid === pageId) {
        managed.visible = true;
        managed.view.setBounds(managed.bounds);
      } else {
        managed.visible = false;
        managed.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      }
    }
  }

  /** Keep blank pages and navigation/loading gaps aligned with the app theme. */
  setBackgroundColor(background: string): void {
    if (!/^#[0-9a-f]{6}$/i.test(background)) return;
    this.backgroundColor = background;
    for (const managed of this.views.values()) {
      managed.view.setBackgroundColor(background);
    }
  }

  async capturePage(pageId?: string): Promise<string> {
    const targetId = pageId ?? this.activePageId;
    if (!targetId) return "";
    const managed = this.views.get(targetId);
    if (!managed) return "";
    const image = await managed.view.webContents.capturePage();
    return image.toDataURL();
  }

  /** Capture a bounded crop from the visible page for annotation previews. */
  async capturePageRegion(
    pageId: string,
    rect: { x: number; y: number; width: number; height: number },
  ): Promise<string> {
    const managed = this.views.get(pageId);
    if (!managed) return "";
    const image = await managed.view.webContents.capturePage({
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
    const win = this.getMainWindow();
    if (win && !win.isDestroyed()) {
      win.contentView.removeChildView(managed.view);
    }
    if (!managed.view.webContents.isDestroyed()) {
      managed.view.webContents.close();
    }
    this.views.delete(pageId);
    if (this.activePageId === pageId) this.activePageId = null;
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
  getWebContents(pageId: string): import("electron").WebContents | undefined {
    return this.views.get(pageId)?.view.webContents;
  }

  destroyAll(): void {
    for (const pageId of Array.from(this.views.keys())) {
      this.destroyView(pageId);
    }
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
