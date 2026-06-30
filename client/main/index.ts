import { app, BrowserWindow, shell } from "electron";
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
import { isAllowedExternalUrl } from "./core/security/navigation-policy";
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

const isTest = process.env.NODE_ENV === "test";
const gotSingleInstanceLock = isTest || app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

const isDev =
  process.env.NODE_ENV === "development" || !!process.env.ELECTRON_RENDERER_URL;

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 640,
    show: false,
    title: "Marloues",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
    },
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (isAllowedExternalUrl(details.url)) {
      void shell.openExternal(details.url);
    } else {
      logWarn("navigation.externalBlocked", { url: details.url });
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on(
    "console-message",
    (_event, level, message, line, sourceId) => {
      logConsole(mapRendererConsoleLevel(level), "renderer", message, {
        line,
        sourceId,
      });
    },
  );

  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL) => {
      logConsole("error", "renderer", "did-fail-load", {
        errorCode,
        errorDescription,
        validatedURL,
      });
    },
  );

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    logConsole("error", "renderer", "render-process-gone", {
      reason: details.reason,
      exitCode: details.exitCode,
    });
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
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
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("window-all-closed", () => {
  void destroyRuntime();
  if (process.platform !== "darwin") app.quit();
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
