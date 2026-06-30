import { app } from "electron";
import { autoUpdater } from "electron-updater";
import { logError, logInfo, logWarn } from "../core/logging/app-logger";

export function initAutoUpdateService(): void {
  if (!app.isPackaged) {
    logInfo("autoUpdate.skipped", { reason: "not-packaged" });
    return;
  }
  if (process.env.MARLOUES_DISABLE_AUTO_UPDATE === "1") {
    logInfo("autoUpdate.skipped", { reason: "disabled-by-env" });
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => logInfo("autoUpdate.checking"));
  autoUpdater.on("update-available", (info) => logInfo("autoUpdate.available", updateInfo(info)));
  autoUpdater.on("update-not-available", (info) => logInfo("autoUpdate.notAvailable", updateInfo(info)));
  autoUpdater.on("download-progress", (progress) => {
    logInfo("autoUpdate.downloadProgress", {
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total,
    });
  });
  autoUpdater.on("update-downloaded", (info) => logInfo("autoUpdate.downloaded", updateInfo(info)));
  autoUpdater.on("error", (error) => logError("autoUpdate.error", error));

  void autoUpdater.checkForUpdates().catch((error) => {
    logWarn("autoUpdate.checkFailed", { error: error instanceof Error ? error.message : String(error) });
  });
}

function updateInfo(info: { version?: string; releaseName?: string | null; releaseDate?: string }): Record<string, unknown> {
  return {
    version: info.version,
    releaseName: info.releaseName,
    releaseDate: info.releaseDate,
  };
}
