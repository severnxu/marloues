import { app, BrowserWindow, Menu, Tray, nativeImage, shell } from "electron";
import { join } from "node:path";
import { registerHandlers } from "./ipc/handlers";
import { initRuntime, destroyRuntime } from "./core/runtime/manager";
import {
  installMainConsoleCapture,
  isSuppressedError,
  logConsole,
  logError,
  logInfo,
  logWarn,
} from "./core/logging/app-logger";
import {
  isAllowedApplicationNavigation,
  isAllowedExternalUrl,
} from "./core/security/navigation-policy";
import { initAutoUpdateService } from "./services/auto-update-service";
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

const isTest = process.env.NODE_ENV === "test";
const gotSingleInstanceLock = isTest || app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

const isDev =
  process.env.NODE_ENV === "development" || !!process.env.ELECTRON_RENDERER_URL;
const isMacOS = process.platform === "darwin";
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

function createWindow(): void {
  const applicationUrl = getRendererApplicationUrl();
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 640,
    show: false,
    title: "Marloues",
    frame: isMacOS,
    titleBarStyle: isMacOS ? "hiddenInset" : undefined,
    trafficLightPosition: isMacOS ? { x: 20, y: 17 } : undefined,
    backgroundColor: "#212121",
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

  if (!isMacOS) ensureTray();
}

function ensureTray(): void {
  if (tray) return;
  const icon = nativeImage
    .createFromDataURL(
      "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'%3E%3Crect x='2' y='2' width='28' height='28' rx='8' fill='%23212121'/%3E%3Cpath d='M9 23V9h3.4l3.6 7.1L19.6 9H23v14h-3v-8.4l-2.9 5.6h-2.2L12 14.6V23H9Z' fill='white'/%3E%3C/svg%3E",
    )
    .resize({ width: 16, height: 16 });
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
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("double-click", showMainWindow);
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
});

app.on("window-all-closed", () => {
  void destroyRuntime();
  if (!isMacOS && isQuitting) app.quit();
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

process.on("uncaughtException", (error) => {
  if (isSuppressedError(error)) {
    logWarn("process.suppressedException", { message: error.message });
  } else {
    logError("process.uncaughtException", error);
  }
});

process.on("unhandledRejection", (reason) => {
  if (isSuppressedError(reason)) {
    logWarn("process.suppressedRejection", {
      message: reason instanceof Error ? reason.message : String(reason),
    });
  } else {
    logError("process.unhandledRejection", reason);
  }
});
