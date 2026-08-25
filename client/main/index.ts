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
  tray.on("click", showMainWindow);
  tray.on("double-click", showMainWindow);
  logInfo("tray.created", {});
}

function createTrayIcon(): Electron.NativeImage {
  return createAppIcon().resize({ width: 16, height: 16 });
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

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return;
  if (!isMacOS) ensureTray();
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
  registerThemeIpc();
  nativeTheme.on("updated", () => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed())
        win.setBackgroundColor(getThemeAwareBackgroundColor());
    }
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
  destroyTray();
});

app.on("window-all-closed", () => {
  void stopImBridge();
  void destroyRuntime();
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
