/**
 * Theme service: keeps the macOS native appearance (nativeTheme.themeSource)
 * and every window's background color in sync with the renderer's app theme.
 *
 * Why this exists: macOS draws unfocused traffic-light buttons in a color
 * derived from the window's NSAppearance. If the window background is pinned
 * to a hardcoded dark color while the app runs a light theme, the unfocused
 * lights are drawn light-on-light and become invisible (electron/electron#27295).
 * By driving nativeTheme.themeSource + win.setBackgroundColor from the exact
 * theme the renderer resolved, the lights stay visible in every theme.
 */
import { ipcMain, nativeTheme, BrowserWindow } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getConfigDir } from "../app-paths";
import { IPC } from "@shared/types";
import { logInfo } from "../core/logging/app-logger";

type NativeThemeSource = "system" | "dark" | "light";

interface PersistedTheme {
  theme?: string;
  themeBackground?: string;
  themeNative?: NativeThemeSource;
}

const THEME_FILE = join(getConfigDir(), "theme.json");

const FALLBACK_BACKGROUNDS: Record<string, string> = {
  dark: "#212121",
  light: "#faf9f7",
  warm: "#ede2c9",
};
function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim());
}

function isNativeThemeSource(value: unknown): value is NativeThemeSource {
  return value === "system" || value === "dark" || value === "light";
}

function readPersistedTheme(): PersistedTheme {
  if (!existsSync(THEME_FILE)) return {};
  try {
    const parsed = JSON.parse(readFileSync(THEME_FILE, "utf-8"));
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as PersistedTheme;
  } catch {
    return {};
  }
}

function writePersistedTheme(theme: PersistedTheme): void {
  try {
    mkdirSync(dirname(THEME_FILE), { recursive: true });
    writeFileSync(THEME_FILE, JSON.stringify(theme, null, 2), "utf-8");
  } catch (error) {
    logInfo("theme.writeFailed", {
      themeFile: THEME_FILE,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Theme-aware background color for window creation and native appearance.
 * Derives from the last theme the renderer pushed via WINDOW_SET_THEME so the
 * initial window flash matches the app theme instead of a hardcoded dark.
 */
export function getThemeAwareBackgroundColor(): string {
  const persisted = readPersistedTheme();
  if (isHexColor(persisted.themeBackground)) return persisted.themeBackground;
  // No persisted background yet; fall back to the theme's known color.
  const mode = persisted.theme;
  if (mode && mode in FALLBACK_BACKGROUNDS) return FALLBACK_BACKGROUNDS[mode];
  return nativeTheme.shouldUseDarkColors
    ? FALLBACK_BACKGROUNDS.dark
    : FALLBACK_BACKGROUNDS.light;
}

/** Initial native theme source for app ready (system/dark/light). */
export function readInitialNativeThemeSource(): NativeThemeSource {
  const persisted = readPersistedTheme();
  return isNativeThemeSource(persisted.themeNative)
    ? persisted.themeNative
    : "system";
}

/** Apply a background color to every live window (called on theme change). */
function applyBackgroundColorToAllWindows(background: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.setBackgroundColor(background);
  }
}

/**
 * Register the WINDOW_SET_THEME IPC channel. The renderer calls this on every
 * theme change with (mode, backgroundHex, nativeThemeSource). We persist it,
 * drive nativeTheme so macOS traffic lights pick the right appearance, and
 * repaint every window's background.
 */
export function registerThemeIpc(
  onBackgroundChanged?: (background: string) => void,
): void {
  onBackgroundChanged?.(getThemeAwareBackgroundColor());
  ipcMain.on(
    IPC.WINDOW_SET_THEME,
    (_event, mode: string, background: string, next: NativeThemeSource) => {
      if (!isHexColor(background)) return;
      if (!isNativeThemeSource(next)) return;

      writePersistedTheme({
        theme: typeof mode === "string" ? mode : undefined,
        themeBackground: background,
        themeNative: next,
      });

      if (nativeTheme.themeSource !== next) {
        nativeTheme.themeSource = next;
      }
      applyBackgroundColorToAllWindows(background);
      onBackgroundChanged?.(background);
    },
  );
}
