import { BrowserWindow, WebContentsView } from "electron";
import { logInfo, logWarn } from "../core/logging/app-logger";

interface ManagedView {
  view: WebContentsView;
  pageId: string;
  url: string;
  title: string;
  visible: boolean;
  bounds: { x: number; y: number; width: number; height: number };
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

    view.webContents.on("did-navigate", (_event, targetUrl: string) => {
      const managed = this.views.get(pageId);
      if (managed) {
        managed.url = targetUrl;
        this.emitUrlChanged(pageId, targetUrl);
      }
    });
    view.webContents.on("did-navigate-in-page", (_event, targetUrl: string) => {
      const managed = this.views.get(pageId);
      if (managed) {
        managed.url = targetUrl;
        this.emitUrlChanged(pageId, targetUrl);
      }
    });
    view.webContents.on("page-title-updated", (_event, title: string) => {
      const managed = this.views.get(pageId);
      if (managed) managed.title = title;
    });

    const managed: ManagedView = {
      view,
      pageId,
      url: url || "about:blank",
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
    managed.view.webContents
      .loadURL(url)
      .then(() => this.emitUrlChanged(pageId, url))
      .catch(() => {});
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

  async capturePage(pageId?: string): Promise<string> {
    const targetId = pageId ?? this.activePageId;
    if (!targetId) return "";
    const managed = this.views.get(targetId);
    if (!managed) return "";
    const image = await managed.view.webContents.capturePage();
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
}

export const browserViewManager = new BrowserViewManagerImpl();
