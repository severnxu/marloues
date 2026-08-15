import { useCallback, useEffect, useRef, useState } from "react";

export type TaskContextMode = "hidden" | "docked" | "floating";
export type TaskContextVisibilityPreference = "auto" | "open" | "closed";

const TASK_CONTEXT_DOCK_MIN_WIDTH = 1160;

export function useTaskContextLayout({
  available,
  sessionId,
}: {
  available: boolean;
  sessionId: string | null;
}) {
  const regionRef = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  const [preferenceBySession, setPreferenceBySession] = useState<
    Record<string, TaskContextVisibilityPreference>
  >({});
  const scope = sessionId ?? "__no_session__";
  const preference = preferenceBySession[scope] ?? "auto";
  const mode = resolveTaskContextMode({ available, preference, wide });
  const visible = mode !== "hidden";

  useEffect(() => {
    const element = regionRef.current;
    if (!element) return undefined;
    const update = () =>
      setWide(
        element.getBoundingClientRect().width >= TASK_CONTEXT_DOCK_MIN_WIDTH,
      );
    update();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const toggle = useCallback(() => {
    setPreferenceBySession((current) => ({
      ...current,
      [scope]: visible ? "closed" : "open",
    }));
  }, [scope, visible]);

  const closeFloating = useCallback(() => {
    if (mode !== "floating") return;
    setPreferenceBySession((current) => ({ ...current, [scope]: "closed" }));
  }, [mode, scope]);

  return {
    regionRef,
    mode,
    open: visible,
    toggle,
    closeFloating,
  };
}

export function resolveTaskContextMode({
  available,
  preference,
  wide,
}: {
  available: boolean;
  preference: TaskContextVisibilityPreference;
  wide: boolean;
}): TaskContextMode {
  if (!available || preference !== "open") return "hidden";
  return wide ? "docked" : "floating";
}
