import { BrowserWindow } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { UI_BUILD_VERSION } from "@shared/build-info";
import type { RendererReadyReceipt } from "@shared/hot-update";
import { logWarn } from "../core/logging/app-logger";
import {
  getSelectedUiVersion,
  isUiPackageReady,
  markUiPackageFailed,
  markUiPackageReady,
  selectUiPackageForBoot,
  type SelectedUiPackage,
} from "./package-store";
import { validateRendererReady } from "./renderer-ready";

const RENDERER_READY_TIMEOUT_MS = 15_000;
const isDev =
  process.env.NODE_ENV === "development" ||
  Boolean(process.env.ELECTRON_RENDERER_URL);
const bundledRendererEntry = join(__dirname, "../renderer/index.html");
let selectedRenderer: SelectedUiPackage | null = null;
let rendererReadyTimer: ReturnType<typeof setTimeout> | undefined;

export function getSelectedRenderer(): SelectedUiPackage {
  selectedRenderer ??= isDev
    ? {
        version: UI_BUILD_VERSION,
        entryPath: bundledRendererEntry,
        bundled: true,
      }
    : selectUiPackageForBoot({
        bundledVersion: UI_BUILD_VERSION,
        bundledEntry: bundledRendererEntry,
      });
  return selectedRenderer;
}

export function getRendererApplicationUrl(): string {
  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    return process.env.ELECTRON_RENDERER_URL;
  }
  return pathToFileURL(getSelectedRenderer().entryPath).toString();
}

export async function loadSelectedRenderer(
  window: BrowserWindow,
  selection = getSelectedRenderer(),
): Promise<void> {
  if (rendererReadyTimer) clearTimeout(rendererReadyTimer);
  selectedRenderer = selection;
  await window.loadFile(selection.entryPath);
  if (selection.bundled) return;
  rendererReadyTimer = setTimeout(() => {
    if (window.isDestroyed()) return;
    const current = getSelectedRenderer();
    if (current.version !== selection.version) return;
    if (isUiPackageReady(selection.version)) return;
    logWarn("renderer.hotUpdate.readinessTimeout", {
      version: selection.version,
      entryPath: selection.entryPath,
    });
    void recoverRenderer(window, selection.version);
  }, RENDERER_READY_TIMEOUT_MS);
}

export async function activatePendingRenderer(
  window: BrowserWindow,
): Promise<SelectedUiPackage> {
  if (isDev) return getSelectedRenderer();
  const selection = selectUiPackageForBoot({
    bundledVersion: UI_BUILD_VERSION,
    bundledEntry: bundledRendererEntry,
  });
  await loadSelectedRenderer(window, selection);
  return selection;
}

export async function recoverRenderer(
  window: BrowserWindow,
  failedVersion = getSelectedRenderer().version,
): Promise<SelectedUiPackage> {
  if (isDev) return getSelectedRenderer();
  markUiPackageFailed(failedVersion);
  const selection = selectUiPackageForBoot({
    bundledVersion: UI_BUILD_VERSION,
    bundledEntry: bundledRendererEntry,
  });
  await loadSelectedRenderer(window, selection);
  return selection;
}

export function handleRendererLoadFailure(window: BrowserWindow): void {
  const selection = getSelectedRenderer();
  if (!isDev && !selection.bundled) {
    void recoverRenderer(window, selection.version);
  }
}

export function markRendererReady(payload: unknown): RendererReadyReceipt {
  const receipt = validateRendererReady(payload, getSelectedUiVersion());
  if (receipt.accepted) {
    markUiPackageReady((payload as { uiVersion: string }).uiVersion);
    if (rendererReadyTimer) clearTimeout(rendererReadyTimer);
    rendererReadyTimer = undefined;
  }
  return receipt;
}
