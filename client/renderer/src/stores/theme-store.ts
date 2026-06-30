import { create } from "zustand";

export type ThemeMode = "system" | "dark" | "light" | "warm";

interface ThemeStore {
  isDark: boolean;
  mode: ThemeMode;
  accentColor: string | null;
  toggle: () => void;
  setDark: (dark: boolean) => void;
  setMode: (mode: ThemeMode) => void;
  setAccentColor: (color: string) => void;
  resetAccentColor: () => void;
}

const MODE_STORAGE_KEY = "marloues.theme";
const ACCENT_STORAGE_KEY = "marloues.accent";
const THEME_TRANSITION_CLASS = "theme-transitioning";
/* PRD 5.2.0: brand accent #534AB7. */
const DEFAULT_ACCENT_HSL = "247 44% 50%";
export const DEFAULT_ACCENT_COLOR = "#534AB7";
export const WARM_ACCENT_COLOR = "#534AB7";
let themeTransitionTimer: number | null = null;

function readInitialMode(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const storedMode = window.localStorage.getItem(MODE_STORAGE_KEY);
  if (storedMode === "system" || storedMode === "light" || storedMode === "dark" || storedMode === "warm") return storedMode;
  return "system";
}

function saveMode(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // localStorage may be unavailable
  }
}

function readInitialAccent(): string | null {
  if (typeof window === "undefined") return null;
  const storedAccent = window.localStorage.getItem(ACCENT_STORAGE_KEY);
  return isHexColor(storedAccent) ? storedAccent : null;
}

function saveAccent(color: string | null): void {
  try {
    if (color) window.localStorage.setItem(ACCENT_STORAGE_KEY, color);
    else window.localStorage.removeItem(ACCENT_STORAGE_KEY);
  } catch {
    // localStorage may be unavailable
  }
}

function isHexColor(value: string | null): value is string {
  return Boolean(value && /^#[0-9a-fA-F]{6}$/.test(value.trim()));
}

function hexToHsl(hex: string): string | null {
  const normalized = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null;
  const r = Number.parseInt(normalized.slice(0, 2), 16) / 255;
  const g = Number.parseInt(normalized.slice(2, 4), 16) / 255;
  const b = Number.parseInt(normalized.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const lightness = (max + min) / 2;
  if (delta === 0) return `0 0% ${Math.round(lightness * 100)}%`;
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue;
  if (max === r) hue = 60 * (((g - b) / delta) % 6);
  else if (max === g) hue = 60 * ((b - r) / delta + 2);
  else hue = 60 * ((r - g) / delta + 4);
  if (hue < 0) hue += 360;
  return `${Math.round(hue)} ${Math.round(saturation * 100)}% ${Math.round(lightness * 100)}%`;
}

function applyAccentToDOM(accentColor: string | null): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (root.dataset.theme === "warm" && !accentColor) {
    root.style.removeProperty("--accent");
    root.style.removeProperty("--accent-soft");
    root.style.removeProperty("--gradient-primary");
    root.style.removeProperty("--settings-border-strong");
    root.style.removeProperty("--settings-field-focus");
    root.style.removeProperty("--shadow-glow");
    return;
  }
  const accent = accentColor ? hexToHsl(accentColor) : null;
  const value = accent ?? DEFAULT_ACCENT_HSL;
  root.style.setProperty("--accent", `hsl(${value})`);
  root.style.setProperty("--accent-soft", `hsl(${value} / 0.12)`);
  root.style.setProperty("--gradient-primary", `linear-gradient(135deg, hsl(${value}), hsl(${value}))`);
  root.style.setProperty("--settings-border-strong", `hsl(${value} / 0.38)`);
  root.style.setProperty("--settings-field-focus", `hsl(${value} / 0.18)`);
  root.style.setProperty("--shadow-glow", `0 0 0 1px hsl(${value} / 0.24), 0 0 22px -8px hsl(${value} / 0.32)`);
}

function resolvedThemeMode(mode: ThemeMode): Exclude<ThemeMode, "system"> {
  if (mode !== "system") return mode;
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function resolvedIsDark(mode: ThemeMode): boolean {
  return resolvedThemeMode(mode) === "dark";
}

function suppressThemeTransitions(root: HTMLElement): void {
  if (typeof window === "undefined") return;
  if (themeTransitionTimer != null) {
    window.clearTimeout(themeTransitionTimer);
    themeTransitionTimer = null;
  }
  root.classList.add(THEME_TRANSITION_CLASS);
  void root.offsetHeight;
  themeTransitionTimer = window.setTimeout(() => {
    root.classList.remove(THEME_TRANSITION_CLASS);
    themeTransitionTimer = null;
  }, 96);
}

function applyThemeToDOM(mode: ThemeMode, accentColor: string | null, suppressTransitions = false): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (suppressTransitions) suppressThemeTransitions(root);
  const resolvedMode = resolvedThemeMode(mode);
  const isLightLike = resolvedMode === "light" || resolvedMode === "warm";
  root.dataset.theme = resolvedMode;
  root.dataset.themePreference = mode;
  root.style.colorScheme = isLightLike ? "light" : "dark";
  root.classList.toggle("dark", resolvedMode === "dark");
  root.classList.toggle("light", isLightLike);
  root.classList.toggle("warm", resolvedMode === "warm");
  applyAccentToDOM(accentColor);
}

const initialMode = readInitialMode();
const initialAccent = readInitialAccent();
applyThemeToDOM(initialMode, initialAccent);

export const useThemeStore = create<ThemeStore>((set) => ({
  isDark: resolvedIsDark(initialMode),
  mode: initialMode,
  accentColor: initialAccent,
  toggle: () =>
    set((state) => {
     const mode: ThemeMode =
        state.mode === "system" ? "dark" : state.mode === "dark" ? "light" : state.mode === "light" ? "warm" : "system";
      saveMode(mode);
      applyThemeToDOM(mode, state.accentColor, true);
      return { isDark: resolvedIsDark(mode), mode };
    }),
  setDark: (dark) => {
    const mode: ThemeMode = dark ? "dark" : "light";
    saveMode(mode);
    set((state) => {
      applyThemeToDOM(mode, state.accentColor, true);
      return { isDark: dark, mode };
    });
  },
  setMode: (mode) => {
    saveMode(mode);
    set((state) => {
      applyThemeToDOM(mode, state.accentColor, true);
      return { isDark: resolvedIsDark(mode), mode };
    });
  },
  setAccentColor: (color) => {
    const normalized = color.trim();
    if (!isHexColor(normalized)) return;
    saveAccent(normalized);
    set((state) => {
      applyThemeToDOM(state.mode, normalized);
      return { accentColor: normalized };
    });
  },
  resetAccentColor: () => {
    saveAccent(null);
    set((state) => {
      applyThemeToDOM(state.mode, null);
      return { accentColor: null };
    });
  },
}));

export function applyStoredTheme(): void {
  applyThemeToDOM(readInitialMode(), readInitialAccent());
}

export function applySystemThemePreference(): void {
  const mode = useThemeStore.getState().mode;
  if (mode !== "system") return;
  const accentColor = useThemeStore.getState().accentColor;
  applyThemeToDOM(mode, accentColor, true);
  useThemeStore.setState({ isDark: resolvedIsDark(mode) });
}
