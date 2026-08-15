// Cross-platform shell resolution.
//
// Determines the window platform ("macos" vs "windows") used by WindowChrome
// rendering and CSS platform hooks. Supports a dev-only `?platform=` query
// override for testing the non-native shell in a browser preview.
import type { WorkbenchPlatform } from "./layout-model";

export function resolveWorkbenchPlatform(
  nativePlatform: string,
  previewPlatform?: string | null,
): WorkbenchPlatform {
  const resolved = previewPlatform ?? nativePlatform;
  return resolved === "darwin" || resolved === "macos" ? "macos" : "windows";
}

/**
 * Read the dev-only `?platform=` override. Returns null in production or
 * when the query param is absent. Used by WorkbenchRoot to feed
 * `resolveWorkbenchPlatform` without duplicating the localhost check.
 */
export function readPreviewPlatform(): string | null {
  const isLocalPreview =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";
  if (!isLocalPreview) return null;
  return new URLSearchParams(window.location.search).get("platform");
}

/**
 * Read the dev-only `?review=acceptance` flag. When set, the renderer hides
 * all presentation chrome (title bar, sidebars, resize handles, outer
 * borders, padding) and shows only the customer area — useful for
 * pixel-diffing against the Marloues design mocks. Mirrors the
 * `index.html?review=acceptance` convention in Marloues' workbench-prototype.
 */
export function readReviewAcceptanceMode(): boolean {
  const params = new URLSearchParams(window.location.search);
  const value = params.get("review");
  return value === "acceptance" || value === "1";
}
