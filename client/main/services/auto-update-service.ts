import { app, BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";
import type { UpdatePreferences, UpdateState } from "@shared/hot-update";
import { MARLOUES_UPDATE_CONFIG } from "@shared/update-config";
import { IPC } from "@shared/types";
import { logError, logInfo, logWarn } from "../core/logging/app-logger";
import {
  applyInstalledHotUpdate,
  checkForHotUpdates,
  downloadAndInstallHotUpdate,
  hotCandidateState,
} from "../hot-update/hot-update-service";
import { getUpdatePreferences } from "./update-preferences-service";

const AUTO_CHECK_INTERVAL_MS = 30 * 60 * 1000;
let currentState: UpdateState = { status: "idle" };
let initialized = false;
let checkInFlight: Promise<UpdateState> | null = null;
let downloadInFlight: Promise<UpdateState> | null = null;
let autoCheckTimer: ReturnType<typeof setInterval> | undefined;
let clientUpdateAvailable = false;
let operation: "idle" | "checking" | "downloading" = "idle";

function setState(next: UpdateState): void {
  currentState = next;
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IPC.UPDATE_STATE, next);
  }
}

function classifyUpdateError(
  message: string,
): NonNullable<UpdateState["errorCode"]> {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("checksum") ||
    normalized.includes("signature") ||
    normalized.includes("hash") ||
    normalized.includes("signing key")
  ) {
    return "checksum";
  }
  if (
    normalized.includes("eacces") ||
    normalized.includes("eperm") ||
    normalized.includes("permission")
  ) {
    return "permission";
  }
  if (
    normalized.includes("not configured") ||
    normalized.includes("must use https") ||
    normalized.includes("not-packaged")
  ) {
    return "configuration";
  }
  if (
    normalized.includes("network") ||
    normalized.includes("enotfound") ||
    normalized.includes("etimedout") ||
    normalized.includes("econnreset") ||
    normalized.includes("timeout") ||
    normalized.includes("socket") ||
    normalized.includes("http ")
  ) {
    return "network";
  }
  return "unknown";
}

function setErrorState(error: unknown): UpdateState {
  const message = error instanceof Error ? error.message : String(error);
  const state: UpdateState = {
    status: "error",
    updateKind: currentState.updateKind,
    applyMode: currentState.applyMode,
    version: currentState.version,
    releaseNotes: currentState.releaseNotes,
    error: message,
    errorCode: classifyUpdateError(message),
    lastCheckedAt: currentState.lastCheckedAt,
  };
  setState(state);
  return state;
}

function safeReleaseNotes(info: {
  releaseNotes?: unknown;
}): string | undefined {
  return typeof info.releaseNotes === "string" ? info.releaseNotes : undefined;
}

function updaterChannel(preferences: UpdatePreferences): string {
  return preferences.channel === "stable" ? "latest" : preferences.channel;
}

function configureFeed(preferences: UpdatePreferences): void {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = preferences.channel !== "stable";
  autoUpdater.channel = updaterChannel(preferences);

  if (MARLOUES_UPDATE_CONFIG.clientProvider !== "generic") return;
  const configured = MARLOUES_UPDATE_CONFIG.clientUpdateUrl;
  if (!configured) {
    throw new Error("Generic client update feed is not configured");
  }
  const url = new URL(configured);
  if (url.protocol !== "https:") {
    throw new Error("Client update feed must use HTTPS");
  }
  autoUpdater.setFeedURL({
    provider: "generic",
    url: url.toString(),
    channel: updaterChannel(preferences),
  });
}

function registerUpdaterEvents(): void {
  autoUpdater.on("checking-for-update", () => logInfo("autoUpdate.checking"));
  autoUpdater.on("update-available", (info) => {
    if (getUpdatePreferences().ignoredVersion === info.version) {
      clientUpdateAvailable = false;
      logInfo("autoUpdate.ignored", { version: info.version });
      return;
    }
    clientUpdateAvailable = true;
    setState({
      status: "available",
      updateKind: "client",
      applyMode: "install-client",
      version: info.version,
      releaseNotes: safeReleaseNotes(info),
      lastCheckedAt: new Date().toISOString(),
    });
    logInfo("autoUpdate.available", { version: info.version });
  });
  autoUpdater.on("update-not-available", (info) => {
    clientUpdateAvailable = false;
    logInfo("autoUpdate.notAvailable", { version: info.version });
  });
  autoUpdater.on("download-progress", (progress) => {
    setState({
      ...currentState,
      status: "downloading",
      updateKind: "client",
      applyMode: "install-client",
      progress: {
        percent: Math.round(progress.percent),
        transferred: progress.transferred,
        total: progress.total,
      },
    });
  });
  autoUpdater.on("update-downloaded", (info) => {
    setState({
      status: "ready",
      updateKind: "client",
      applyMode: "install-client",
      version: info.version,
      releaseNotes: safeReleaseNotes(info) ?? currentState.releaseNotes,
      lastCheckedAt: currentState.lastCheckedAt,
    });
    logInfo("autoUpdate.downloaded", { version: info.version });
  });
  autoUpdater.on("error", (error) => {
    logError("autoUpdate.error", error);
    if (operation !== "checking") setErrorState(error);
  });
}

function scheduleAutomaticChecks(preferences = getUpdatePreferences()): void {
  if (autoCheckTimer) clearInterval(autoCheckTimer);
  autoCheckTimer = undefined;
  if (!preferences.autoCheck || !app.isPackaged) return;
  autoCheckTimer = setInterval(() => {
    void performCheck(true).catch((error) => {
      logWarn("autoUpdate.intervalCheckFailed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, AUTO_CHECK_INTERVAL_MS);
}

async function autoDownloadIfEnabled(
  preferences: UpdatePreferences,
): Promise<UpdateState> {
  if (currentState.status !== "available" || !preferences.autoDownload) {
    return currentState;
  }
  const downloaded = await downloadUpdateNow();
  if (
    downloaded.status === "ready" &&
    downloaded.updateKind === "ui" &&
    preferences.autoApplyUi
  ) {
    await installUpdateNow();
  }
  return currentState;
}

async function performCheck(silent: boolean): Promise<UpdateState> {
  if (!app.isPackaged) {
    if (silent) return currentState;
    return setErrorState(
      new Error("Update checks require a packaged application"),
    );
  }
  if (checkInFlight) return checkInFlight;

  checkInFlight = (async () => {
    const preferences = getUpdatePreferences();
    operation = "checking";
    clientUpdateAvailable = false;
    if (!silent) setState({ status: "checking" });
    let clientError: unknown;
    try {
      configureFeed(preferences);
      await autoUpdater.checkForUpdates();
    } catch (error) {
      clientError = error;
      logWarn("autoUpdate.clientCheckFailed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (clientUpdateAvailable) {
      operation = "idle";
      return autoDownloadIfEnabled(preferences);
    }

    try {
      const candidate = await checkForHotUpdates(preferences.channel);
      if (
        candidate &&
        candidate.artifact.version !== preferences.ignoredVersion
      ) {
        setState({
          ...hotCandidateState(candidate),
          lastCheckedAt: new Date().toISOString(),
        });
        operation = "idle";
        return autoDownloadIfEnabled(preferences);
      }
    } catch (error) {
      operation = "idle";
      if (!silent) return setErrorState(error);
      logWarn("hotUpdate.checkFailed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return currentState;
    }

    operation = "idle";
    if (clientError && !silent) return setErrorState(clientError);
    setState({ status: "idle", lastCheckedAt: new Date().toISOString() });
    return currentState;
  })().finally(() => {
    operation = "idle";
    checkInFlight = null;
  });
  return checkInFlight;
}

export function initAutoUpdateService(): void {
  if (initialized) return;
  initialized = true;
  if (!app.isPackaged) {
    logInfo("autoUpdate.skipped", { reason: "not-packaged" });
    return;
  }
  if (process.env.MARLOUES_DISABLE_AUTO_UPDATE === "1") {
    logInfo("autoUpdate.skipped", { reason: "disabled-by-env" });
    return;
  }

  try {
    configureFeed(getUpdatePreferences());
  } catch (error) {
    logError("autoUpdate.configureFailed", error);
  }
  registerUpdaterEvents();
  const preferences = getUpdatePreferences();
  scheduleAutomaticChecks(preferences);
  if (preferences.autoCheck) {
    void performCheck(true).catch((error) => {
      logWarn("autoUpdate.startupCheckFailed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}

export function getUpdateState(): UpdateState {
  return currentState;
}

export function checkForUpdatesManual(): Promise<UpdateState> {
  return performCheck(false);
}

export function downloadUpdateNow(): Promise<UpdateState> {
  if (downloadInFlight) return downloadInFlight;
  downloadInFlight = (async () => {
    if (currentState.status !== "available") {
      throw new Error("No update is available to download");
    }
    operation = "downloading";
    const available = currentState;
    setState({ ...available, status: "downloading" });
    try {
      if (available.updateKind === "ui") {
        const candidate = await downloadAndInstallHotUpdate({
          onProgress: (transferred, total) => {
            setState({
              ...available,
              status: "downloading",
              progress: {
                percent:
                  total > 0 ? Math.round((transferred / total) * 100) : 0,
                transferred,
                total,
              },
            });
          },
        });
        setState({
          ...hotCandidateState(candidate, "ready"),
          lastCheckedAt: available.lastCheckedAt,
        });
        return currentState;
      }

      await autoUpdater.downloadUpdate();
      if (getUpdateState().status === "downloading") {
        setState({ ...available, status: "ready" });
      }
      return currentState;
    } catch (error) {
      setErrorState(error);
      throw error;
    } finally {
      operation = "idle";
    }
  })().finally(() => {
    downloadInFlight = null;
  });
  return downloadInFlight;
}

export async function installUpdateNow(): Promise<void> {
  if (currentState.status !== "ready") {
    throw new Error("No downloaded update is ready to apply");
  }
  if (currentState.updateKind === "ui") {
    await applyInstalledHotUpdate();
    setState({ status: "idle", lastCheckedAt: currentState.lastCheckedAt });
    return;
  }
  autoUpdater.quitAndInstall(false, true);
}

export function applyUpdatePreferences(
  preferences: UpdatePreferences,
  options: { channelChanged?: boolean } = {},
): void {
  if (!app.isPackaged) return;
  try {
    configureFeed(preferences);
    scheduleAutomaticChecks(preferences);
    if (
      options.channelChanged ||
      (preferences.ignoredVersion &&
        preferences.ignoredVersion === currentState.version)
    ) {
      setState({ status: "idle" });
    }
  } catch (error) {
    setErrorState(error);
  }
}
