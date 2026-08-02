import { useCallback, useEffect, useRef, useState, type Dispatch } from "react";
import type { AuxiliaryMode, WorkbenchLayoutAction } from "./layout-model";

export function useAuxiliaryTransition(
  dispatch: Dispatch<WorkbenchLayoutAction>,
) {
  const [switching, setSwitching] = useState(false);
  const switchingRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const queuedModeRef = useRef<AuxiliaryMode | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      queuedModeRef.current = null;
      switchingRef.current = false;
    },
    [],
  );

  const transition = useCallback(
    (mode: AuxiliaryMode) => {
      if (switchingRef.current) {
        queuedModeRef.current = mode;
        return;
      }

      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      if (document.hidden || reduceMotion) {
        queuedModeRef.current = null;
        dispatch({ type: "auxiliary.mode.set", mode });
        return;
      }

      switchingRef.current = true;
      setSwitching(true);
      timerRef.current = window.setTimeout(() => {
        dispatch({ type: "auxiliary.mode.set", mode });
        timerRef.current = window.setTimeout(() => {
          const queuedMode = queuedModeRef.current;
          queuedModeRef.current = null;
          if (queuedMode && queuedMode !== mode) {
            dispatch({ type: "auxiliary.mode.set", mode: queuedMode });
          }
          switchingRef.current = false;
          setSwitching(false);
          timerRef.current = null;
        }, 140);
      }, 140);
    },
    [dispatch],
  );

  return { switching, transition };
}
