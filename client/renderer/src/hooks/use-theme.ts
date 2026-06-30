import { useEffect } from "react";
import { applyStoredTheme, applySystemThemePreference, useThemeStore } from "@/stores/theme-store";

export function useThemeSync(): void {
  const mode = useThemeStore((state) => state.mode);
  const accentColor = useThemeStore((state) => state.accentColor);

  useEffect(() => {
    applyStoredTheme();
  }, [accentColor, mode]);

  useEffect(() => {
    if (mode !== "system") return;
    const query = window.matchMedia?.("(prefers-color-scheme: light)");
    if (!query) return;
    const handleChange = () => applySystemThemePreference();
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, [mode]);
}
