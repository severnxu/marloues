import { create } from "zustand";

export type ThemeMode = string;

export interface ThemeDefinition {
  colorScheme: "dark" | "light";
  label: string;
  mode: string;
}

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
export const DEFAULT_ACCENT_COLOR = "#3D9BFF";
const FALLBACK_THEMES: ThemeDefinition[] = [
  { mode: "dark", label: "深色主题", colorScheme: "dark" },
  { mode: "light", label: "浅色主题", colorScheme: "light" },
  { mode: "warm", label: "羊皮纸", colorScheme: "light" },
];
let themeTransitionTimer: number | null = null;

export function getThemeDefinitions(): ThemeDefinition[] {
  if (typeof document === "undefined") return FALLBACK_THEMES;
  const catalog = getComputedStyle(document.documentElement)
    .getPropertyValue("--theme-catalog")
    .trim();
  if (!catalog) return FALLBACK_THEMES;

  const definitions = catalog
    .split(",")
    .map((entry) => {
      const [mode, label, colorScheme] = entry
        .split("|")
        .map((part) => part.trim());
      if (
        !/^[a-z][a-z0-9-]*$/i.test(mode) ||
        !label ||
        (colorScheme !== "dark" && colorScheme !== "light")
      ) {
        return null;
      }
      return { mode, label, colorScheme };
    })
    .filter((entry): entry is ThemeDefinition => entry !== null);
  return definitions.length > 0 ? definitions : FALLBACK_THEMES;
}

function readInitialMode(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const storedMode = window.localStorage.getItem(MODE_STORAGE_KEY);
  if (
    storedMode &&
    (storedMode === "system" ||
      getThemeDefinitions().some((theme) => theme.mode === storedMode))
  ) {
    return storedMode;
  }
  return "system";
}

function saveMode(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // localStorage may be unavailable
  }
}

export function getThemeAccentStorageKey(mode: ThemeMode): string {
  return `${ACCENT_STORAGE_KEY}.${resolvedThemeMode(mode)}`;
}

function readInitialAccent(mode: ThemeMode): string | null {
  if (typeof window === "undefined") return null;
  const storedAccent = window.localStorage.getItem(
    getThemeAccentStorageKey(mode),
  );
  return isHexColor(storedAccent) ? storedAccent : null;
}

function saveAccent(mode: ThemeMode, color: string | null): void {
  try {
    const storageKey = getThemeAccentStorageKey(mode);
    if (color) window.localStorage.setItem(storageKey, color);
    else window.localStorage.removeItem(storageKey);
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
  return `${Math.round(hue)} ${Math.round(saturation * 100)}% ${Math.round(
    lightness * 100,
  )}%`;
}

export function hslToHex(value: string): string | null {
  const m = value.match(/^hsl\(\s*(\d[\d.]*)\s+([\d.]+)%\s+([\d.]+)%\s*\)$/i);
  if (!m) return null;
  const h = Number(m[1]) / 360;
  const s = Number(m[2]) / 100;
  const l = Number(m[3]) / 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function applyAccentToDOM(accentColor: string | null): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!accentColor) {
    root.style.removeProperty("--accent");
    root.style.removeProperty("--accent-soft");
    root.style.removeProperty("--focus-ring");
    root.style.removeProperty("--gradient-primary");
    root.style.removeProperty("--settings-border-strong");
    root.style.removeProperty("--settings-field-focus");
    root.style.removeProperty("--shadow-glow");
    root.style.removeProperty("--tw-ring");
    root.style.removeProperty("--tw-primary-glow");
    root.style.removeProperty("--tw-accent");
    root.style.removeProperty("--tw-accent-glow");
    root.style.removeProperty("--tw-accent-strong");
    root.style.removeProperty("--tw-sidebar-active");
    return;
  }
  const value = hexToHsl(accentColor);
  if (!value) return;
  root.style.setProperty("--accent", `hsl(${value})`);
  root.style.setProperty("--accent-soft", `hsl(${value} / 0.12)`);
  root.style.setProperty("--focus-ring", `hsl(${value} / 0.4)`);
  root.style.setProperty(
    "--gradient-primary",
    `linear-gradient(135deg, hsl(${value}), hsl(${value}))`,
  );
  root.style.setProperty("--settings-border-strong", `hsl(${value} / 0.38)`);
  root.style.setProperty("--settings-field-focus", `hsl(${value} / 0.18)`);
  root.style.setProperty(
    "--shadow-glow",
    `0 0 0 1px hsl(${value} / 0.24), 0 0 22px -8px hsl(${value} / 0.32)`,
  );
  root.style.setProperty("--tw-ring", value);
  root.style.setProperty("--tw-primary-glow", value);
  root.style.setProperty("--tw-accent", value);
  root.style.setProperty("--tw-accent-glow", value);
  root.style.setProperty("--tw-accent-strong", value);
  root.style.setProperty("--tw-sidebar-active", value);
}

function resolvedThemeMode(mode: ThemeMode): string {
  if (mode !== "system") return mode;
  return typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

function resolvedColorScheme(mode: ThemeMode): "dark" | "light" {
  const resolvedMode = resolvedThemeMode(mode);
  return (
    getThemeDefinitions().find((theme) => theme.mode === resolvedMode)
      ?.colorScheme ?? (resolvedMode === "light" ? "light" : "dark")
  );
}

function resolvedIsDark(mode: ThemeMode): boolean {
  return resolvedColorScheme(mode) === "dark";
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

function applyThemeToDOM(
  mode: ThemeMode,
  accentColor: string | null,
  suppressTransitions = false,
): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (suppressTransitions) suppressThemeTransitions(root);
  const resolvedMode = resolvedThemeMode(mode);
  const colorScheme = resolvedColorScheme(mode);
  root.dataset.theme = resolvedMode;
  root.dataset.themePreference = mode;
  root.dataset.themeScheme = colorScheme;
  root.style.removeProperty("color-scheme");
  root.classList.toggle("dark", colorScheme === "dark");
  root.classList.toggle("light", colorScheme === "light");
  applyAccentToDOM(accentColor);
  syncNativeTheme(mode);
}

function readResolvedBackgroundHex(): string | null {
  if (typeof window === "undefined" || !document.documentElement) return null;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--bg")
    .trim();
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  // --bg is an hsl(...) triple; convert to #rrggbb for setBackgroundColor.
  const hslHex = hslToHex(value);
  if (hslHex) return hslHex;
  const background = getComputedStyle(document.documentElement).backgroundColor;
  const rgb = background.match(
    /^rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)(?:\D+[\d.]+)?\s*\)$/i,
  );
  return rgb
    ? `#${rgb
        .slice(1, 4)
        .map((channel) => Number(channel).toString(16).padStart(2, "0"))
        .join("")}`
    : null;
}

function syncNativeTheme(mode: ThemeMode): void {
  if (typeof window === "undefined") return;
  const api = (
    window as unknown as {
      marloues?: {
        window?: {
          setTheme?: (
            m: string,
            bg: string,
            nativeTheme: "system" | "dark" | "light",
          ) => void;
        };
      };
    }
  ).marloues;
  const background = readResolvedBackgroundHex();
  if (!background) return;
  // Persist the app theme to settings.json and apply the matching native theme
  // + window background so the login screen and window chrome follow it.
  const nativeTheme = mode === "system" ? "system" : resolvedColorScheme(mode);
  api?.window?.setTheme?.(mode, background, nativeTheme);
}

const initialMode = readInitialMode();
const initialAccent = readInitialAccent(initialMode);
applyThemeToDOM(initialMode, initialAccent);

export const useThemeStore = create<ThemeStore>((set) => ({
  isDark: resolvedIsDark(initialMode),
  mode: initialMode,
  accentColor: initialAccent,
  toggle: () =>
    set((state) => {
      const cycle = [
        "system",
        ...getThemeDefinitions().map(({ mode }) => mode),
      ];
      const currentIndex = cycle.indexOf(state.mode);
      const mode = cycle[(currentIndex + 1) % cycle.length] ?? "system";
      const accentColor = readInitialAccent(mode);
      saveMode(mode);
      applyThemeToDOM(mode, accentColor, true);
      return { accentColor, isDark: resolvedIsDark(mode), mode };
    }),
  setDark: (dark) => {
    const mode: ThemeMode = dark ? "dark" : "light";
    const accentColor = readInitialAccent(mode);
    saveMode(mode);
    set(() => {
      applyThemeToDOM(mode, accentColor, true);
      return { accentColor, isDark: dark, mode };
    });
  },
  setMode: (mode) => {
    const accentColor = readInitialAccent(mode);
    saveMode(mode);
    set(() => {
      applyThemeToDOM(mode, accentColor, true);
      return { accentColor, isDark: resolvedIsDark(mode), mode };
    });
  },
  setAccentColor: (color) => {
    const normalized = color.trim();
    if (!isHexColor(normalized)) return;
    set((state) => {
      saveAccent(state.mode, normalized);
      applyThemeToDOM(state.mode, normalized);
      return { accentColor: normalized };
    });
  },
  resetAccentColor: () => {
    set((state) => {
      saveAccent(state.mode, null);
      applyThemeToDOM(state.mode, null);
      return { accentColor: null };
    });
  },
}));

export function applyStoredTheme(): void {
  const mode = readInitialMode();
  applyThemeToDOM(mode, readInitialAccent(mode));
}

export function applySystemThemePreference(): void {
  const mode = useThemeStore.getState().mode;
  if (mode !== "system") return;
  const accentColor = readInitialAccent(mode);
  applyThemeToDOM(mode, accentColor, true);
  useThemeStore.setState({ accentColor, isDark: resolvedIsDark(mode) });
}
