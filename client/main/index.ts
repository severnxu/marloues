import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  nativeTheme,
  shell,
} from "electron";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { registerHandlers, stopImBridge } from "./ipc/handlers";
import { initRuntime, destroyRuntime } from "./core/runtime/manager";
import {
  disableConsoleEcho,
  isBrokenStreamError,
  installMainConsoleCapture,
  isSuppressedError,
  logConsole,
  logError,
  logInfo,
  logQuiet,
  logWarn,
} from "./core/logging/app-logger";
import {
  isAllowedApplicationNavigation,
  isAllowedExternalUrl,
} from "./core/security/navigation-policy";
import { initAutoUpdateService } from "./services/auto-update-service";
import {
  getThemeAwareBackgroundColor,
  readInitialNativeThemeSource,
  registerThemeIpc,
} from "./services/theme-service";
import { getAgentSettings } from "./services/config-service";
import { getWorkspaceSettings } from "./services/workspace-service";
import { startRuntimePrewarm } from "./services/runtime-prewarm-service";
import { browserViewManager } from "./services/browser-view-manager";
import {
  getConfigDir,
  getLogDir,
  getMarlouesHome,
  getSettingsPath,
} from "./app-paths";
import { IPC } from "../shared/types";
import {
  getRendererApplicationUrl,
  handleRendererLoadFailure,
  loadSelectedRenderer,
} from "./hot-update/renderer-controller";

const isDev =
  process.env.NODE_ENV === "development" || !!process.env.ELECTRON_RENDERER_URL;
const isTest = process.env.NODE_ENV === "test";
const isWindows = process.platform === "win32";
const isMacOS = process.platform === "darwin";
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

const fallbackTrayIconDataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAABoElEQVRYhe2WwWrCQBCG8xBtz/sHzUERxIMEfYti38K7gqfGHvSgV0GfSe0biCCeVNI2gl6cMrGG2GyiqLs91B9+WDK7M19m9zCGcZdEpmk+CSHeAIwBeADoQvPZEYAm5zTOEYAXIcTnFUWl/slZOVkcwO7WxUPexUKY+7bf/M8lnfhIpVKPEQCxv3PSZEfW/neNACNZB77iDrTb7cDVajU2McfCe5MepKwDFOewttst2bYd2VMsFmmz2RztTcp5MQCr3+9H9gwGA/otZQDr9ZoKhUIQz+fz5HmePgBWp9MJ4t1ul2RSCrBarSibzVImk6HlcqkPYLFYBGvHcXzLYsoAWq1WsJ7P575lMWUApVKJJpNJpN3T6ZTK5bJ6ANu2qV6vRwBqtZof0wKQTqdpNpsdXYVlWfoAAFCj0SDXdX3zmr9pBYDEdwD7misQCdNQr9cLnMvlYpNyLLw3aSqSvYFxErHygQRAUyPA618Opa5lWQ8RABaPzKrHctM0n40kAajwI1Hx5yeLH8RzO4/OAIZJw+oZRfnskO88tu3Gf9c3d8h7/xPUzzkAAAAASUVORK5CYII=";

function configureDevelopmentIdentity(): void {
  if (!isDev || isTest) return;

  const devUserDataPath = join(getMarlouesHome(), "electron-user-data");
  mkdirSync(devUserDataPath, { recursive: true });
  app.setName("Marloues Dev");
  app.setPath("userData", devUserDataPath);
  if (isWindows) app.setAppUserModelId("com.marloues.desktop.dev");
}

configureDevelopmentIdentity();

if (!isDev && isWindows) app.setAppUserModelId("com.marloues.desktop");

// Enable CDP remote debugging for local development and real Electron E2E
// testing. The smoke test drives the embedded `<webview>` through this
// port, rather than faking browser events in the renderer.
if (isDev || isTest) {
  const remoteDebuggingPort =
    process.env.MARLOUES_REMOTE_DEBUGGING_PORT?.trim() || "9223";
  app.commandLine.appendSwitch("remote-debugging-port", remoteDebuggingPort);
  app.commandLine.appendSwitch("remote-allow-origins", "*");
}

const gotSingleInstanceLock = isTest || app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

function getAppIconCandidates(): string[] {
  return [
    join(process.resourcesPath, "tray-icon.png"),
    join(app.getAppPath(), "resources", "tray-icon.png"),
    join(__dirname, "../../resources/tray-icon.png"),
  ];
}

function createAppIcon(): Electron.NativeImage {
  const candidates = getAppIconCandidates();
  const iconPath = candidates.find((candidate) => existsSync(candidate));
  if (!iconPath) {
    logWarn("app.icon.missing", { candidates });
    return nativeImage.createFromDataURL(fallbackTrayIconDataUrl);
  }
  logInfo("app.icon.loaded", { iconPath });
  return nativeImage.createFromPath(iconPath);
}

function getTrayIconCandidates(): string[] {
  // On macOS use the monochrome template image (black + alpha, with face cutout)
  // so macOS adapts the color to light/dark mode automatically.
  const fileName = isMacOS ? "tray-icon-template.png" : "tray-icon.png";
  return [
    join(process.resourcesPath, fileName),
    join(app.getAppPath(), "resources", fileName),
    join(__dirname, "../../resources", fileName),
  ];
}

function createWindow(): void {
  const applicationUrl = getRendererApplicationUrl();
  const appIcon = createAppIcon();
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 640,
    show: false,
    title: "Marloues",
    icon: appIcon.isEmpty() ? undefined : appIcon,
    frame: isMacOS,
    thickFrame: isMacOS ? undefined : false,
    titleBarStyle: isMacOS ? "hiddenInset" : undefined,
    trafficLightPosition: isMacOS ? { x: 20, y: 17 } : undefined,
    backgroundColor: getThemeAwareBackgroundColor(),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      webviewTag: true,
    },
  });
  mainWindow = window;

  if (!isMacOS) window.setMenuBarVisibility(false);

  const emitMaximizedState = (maximized: boolean) => {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC.WINDOW_MAXIMIZED_CHANGED, maximized);
    }
  };
  window.on("maximize", () => emitMaximizedState(true));
  window.on("unmaximize", () => emitMaximizedState(false));

  window.on("ready-to-show", () => {
    window.show();
  });

  window.on("close", (event) => {
    if (isMacOS || isQuitting) return;
    event.preventDefault();
    window.hide();
  });

  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });

  window.webContents.setWindowOpenHandler((details) => {
    if (isAllowedExternalUrl(details.url)) {
      void shell.openExternal(details.url);
    } else {
      logWarn("navigation.externalBlocked", { url: details.url });
    }
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (isAllowedApplicationNavigation(url, getRendererApplicationUrl()))
      return;

    event.preventDefault();
    logWarn("navigation.mainFrameBlocked", { url });
  });

  window.webContents.on(
    "console-message",
    (_event, level, message, line, sourceId) => {
      logConsole(mapRendererConsoleLevel(level), "renderer", message, {
        line,
        sourceId,
      });
    },
  );

  window.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      logConsole("error", "renderer", "did-fail-load", {
        errorCode,
        errorDescription,
        validatedURL,
      });
      if (isMainFrame) handleRendererLoadFailure(window);
    },
  );

  window.webContents.on("render-process-gone", (_event, details) => {
    logConsole("error", "renderer", "render-process-gone", {
      reason: details.reason,
      exitCode: details.exitCode,
    });
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(applicationUrl);
  } else {
    void loadSelectedRenderer(window).catch((error) => {
      logError("renderer.loadFailed", error);
    });
  }
}

function ensureTray(): void {
  if (tray) return;
  const icon = createTrayIcon();
  if (icon.isEmpty()) {
    logWarn("tray.icon.empty", {});
    return;
  }
  tray = new Tray(icon);
  tray.setToolTip("Marloues");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "显示 Marloues",
        click: () => showMainWindow(),
      },
      { type: "separator" },
      {
        label: "退出",
        click: () => {
          quitApplication();
        },
      },
    ]),
  );
  // macOS menu bar: click shows the context menu (set via setContextMenu).
  // Dock icon: handled by the "activate" event → showMainWindow.
  // Windows/Linux: click toggles window visibility (standard tray UX).
  if (!isMacOS) {
    tray.on("click", toggleMainWindow);
    tray.on("double-click", toggleMainWindow);
  }
  logInfo("tray.created", {});
}

function createTrayIcon(): Electron.NativeImage {
  const candidates = getTrayIconCandidates();
  const iconPath = candidates.find((c) => existsSync(c));
  // macOS menu bar: 18px content with ~3px padding (menu bar is ~24px tall).
  // Apple HIG recommends status bar icons stay within 18x18pt.
  const size = isMacOS ? 18 : 16;
  const icon = iconPath
    ? nativeImage.createFromPath(iconPath)
    : createAppIcon();
  const resized = icon.resize({ width: size, height: size });
  // setTemplateImage must be called AFTER resize — resize returns a new
  // NativeImage that does not carry over the template flag.
  if (isMacOS) resized.setTemplateImage(true);
  return resized;
}

function destroyTray(): void {
  if (!tray) return;
  tray.destroy();
  tray = null;
}

function quitApplication(): void {
  isQuitting = true;
  destroyTray();
  app.quit();
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}
function toggleMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isVisible() && mainWindow.isFocused()) {
    mainWindow.hide();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function buildAppMenu(): Menu {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      role: "appMenu",
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      role: "editMenu",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        ...(isDev
          ? ([
              { role: "reload" },
              { role: "forceReload" },
              { role: "toggleDevTools" },
              { type: "separator" },
            ] as Electron.MenuItemConstructorOptions[])
          : []),
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      role: "windowMenu",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        { role: "front" },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return;
  // Set the macOS application menu so the menu-bar app name comes from
  // app.name ("Marloues Dev" in dev, "Marloues" in production) instead of
  // the Electron bundle default.
  Menu.setApplicationMenu(buildAppMenu());
  const aboutIconPath = join(__dirname, "../../resources/dock-icon.png");
  app.setAboutPanelOptions({
    applicationName: app.getName(),
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
    credits: "Marloues",
    iconPath: existsSync(aboutIconPath) ? aboutIconPath : undefined,
  });
  ensureTray();
  if (isMacOS && isDev) {
    const dockIconPath = join(__dirname, "../../resources/dock-icon.png");
    if (existsSync(dockIconPath)) {
      logInfo("app.dock.icon", {
        path: dockIconPath,
        size: nativeImage.createFromPath(dockIconPath).getSize(),
      });
      app.dock?.setIcon(nativeImage.createFromPath(dockIconPath));
    } else {
      logError("app.dock.icon.missing", { path: dockIconPath });
    }
  }
  try {
    await initRuntime();
    logInfo("runtime.initialized", {});
  } catch (err) {
    logError("runtime.init.failed", err);
  }
  installMainConsoleCapture();
  logInfo("app.ready", {
    version: app.getVersion(),
    userData: app.getPath("userData"),
    marlouesHome: getMarlouesHome(),
  });
  logInfo("app.ready.paths", {
    logDir: getLogDir(),
    configDir: getConfigDir(),
    settingsPath: getSettingsPath(),
  });
  logInitialConfig();
  registerHandlers();
  // Sync macOS native appearance with the persisted app theme so unfocused
  // traffic-light buttons stay visible (light theme → dark lights, dark theme
  // → light lights). Renderer pushes theme changes via WINDOW_SET_THEME.
  nativeTheme.themeSource = readInitialNativeThemeSource();
  registerThemeIpc((background) => {
    browserViewManager.setBackgroundColor(background);
  });
  nativeTheme.on("updated", () => {
    const background = getThemeAwareBackgroundColor();
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.setBackgroundColor(background);
    }
    browserViewManager.setBackgroundColor(background);
  });
  createWindow();
  initAutoUpdateService();
  startRuntimePrewarm();
});

app.on("activate", () => {
  if (!gotSingleInstanceLock) return;
  showMainWindow();
});

app.on("second-instance", () => showMainWindow());

app.on("before-quit", () => {
  isQuitting = true;
  void stopImBridge();
  void destroyRuntime();
  destroyTray();
});

app.on("window-all-closed", () => {
  if (!isMacOS && isQuitting) quitApplication();
});

function logInitialConfig(): void {
  const settings = getAgentSettings();
  const workspaces = getWorkspaceSettings();

  // Model: what am I talking to?
  logInfo("app.initialConfig.loaded", {
    defaultProviderId: settings.defaultModel.providerId,
    defaultModelId: settings.defaultModel.modelId,
    providerCount: settings.providers.length,
    enabledProviders: settings.providers
      .filter((p) => p.enabled)
      .map((p) => p.name),
  });

  // MCP servers
  const enabledMcp = settings.mcpServers.filter((s) => s.enabled);
  if (enabledMcp.length > 0) {
    logInfo("app.initialConfig.mcp", {
      enabledMcpServers: enabledMcp.map((s) => s.name),
    });
  }

  // Tool policy — only worth mentioning if there are restrictions
  const allowedCount = settings.toolPermissionPolicy?.allowedTools?.length ?? 0;
  const disallowedCount =
    settings.toolPermissionPolicy?.disallowedTools?.length ?? 0;
  if (allowedCount > 0 || disallowedCount > 0) {
    logInfo("app.initialConfig.toolPolicy", {
      allowedToolCount: allowedCount,
      disallowedToolCount: disallowedCount,
    });
  }

  // Workspaces: just the names and paths; internal IDs are noise
  const currentName = workspaces.workspaces.find(
    (w) => w.id === workspaces.currentWorkspaceId,
  )?.name;
  logInfo("app.initialConfig.workspaces", {
    workspaceCount: workspaces.workspaces.length,
    currentWorkspace: currentName,
    workspaces: workspaces.workspaces.map((w) => ({
      name: w.name,
      path: w.path,
    })),
  });
}

function mapRendererConsoleLevel(
  level: number,
): "debug" | "info" | "warn" | "error" {
  if (level === 0) return "debug";
  if (level === 2) return "warn";
  if (level >= 3) return "error";
  return "info";
}

const SUPPRESSED_ERROR_LOG_INTERVAL_MS = 60_000;
let lastSuppressedErrorLogAt = 0;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "");
}

function logSuppressedProcessError(event: string, error: unknown): void {
  const now = Date.now();
  if (
    lastSuppressedErrorLogAt !== 0 &&
    now - lastSuppressedErrorLogAt < SUPPRESSED_ERROR_LOG_INTERVAL_MS
  ) {
    return;
  }
  lastSuppressedErrorLogAt = now;
  logQuiet(event, { message: getErrorMessage(error) });
}

function handleProcessStreamError(
  streamName: "stdout" | "stderr",
  error: unknown,
): void {
  if (isBrokenStreamError(error)) {
    disableConsoleEcho(`process.${streamName}: ${getErrorMessage(error)}`);
    logSuppressedProcessError("process.suppressedStreamError", error);
    return;
  }
  logError(`process.${streamName}.error`, error);
}

process.stdout?.on("error", (error) => {
  handleProcessStreamError("stdout", error);
});
process.stderr?.on("error", (error) => {
  handleProcessStreamError("stderr", error);
});

process.on("uncaughtException", (error) => {
  if (isSuppressedError(error)) {
    if (isBrokenStreamError(error)) {
      disableConsoleEcho(`process.uncaught: ${getErrorMessage(error)}`);
    }
    logSuppressedProcessError("process.suppressedException", error);
  } else {
    logError("process.uncaughtException", error);
  }
});

process.on("unhandledRejection", (reason) => {
  if (isSuppressedError(reason)) {
    if (isBrokenStreamError(reason)) {
      disableConsoleEcho(`process.rejection: ${getErrorMessage(reason)}`);
    }
    logSuppressedProcessError("process.suppressedRejection", reason);
  } else {
    logError("process.unhandledRejection", reason);
  }
});
