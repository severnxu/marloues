import { describe, expect, it } from "vitest";
import {
  DEFAULT_ACCENT_COLOR,
  getThemeAccentStorageKey,
  getThemeDefinitions,
  hslToHex,
} from "../../../../../client/renderer/src/stores/theme-store";

describe("theme store", () => {
  it("treats the parchment theme as a light color scheme", () => {
    expect(getThemeDefinitions()).toContainEqual({
      mode: "warm",
      label: "羊皮纸",
      colorScheme: "light",
    });
  });

  it("converts every theme accent token to its picker color", () => {
    expect(hslToHex("hsl(211 100% 62%)")).toBe("#3d9bff");
    expect(hslToHex("hsl(210 90% 42%)")).toBe("#0b6bcb");
    expect(hslToHex("hsl(26 72% 46%)")).toBe("#ca6a21");
  });

  it("uses the dark theme accent as the no-DOM fallback", () => {
    expect(DEFAULT_ACCENT_COLOR).toBe("#3D9BFF");
  });

  it("scopes custom accent storage to each theme", () => {
    expect(getThemeAccentStorageKey("dark")).toBe("marloues.accent.dark");
    expect(getThemeAccentStorageKey("light")).toBe("marloues.accent.light");
    expect(getThemeAccentStorageKey("warm")).toBe("marloues.accent.warm");
  });
});
