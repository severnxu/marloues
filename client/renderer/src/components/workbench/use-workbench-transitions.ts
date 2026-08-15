// Workbench transition hook — owns the 4-state primary transition lifecycle
// (`idle -> opening | closing | promoting -> idle`) and exposes toggles for
// the auxiliary primary-overlay mode.
//
// Two distinct auxiliary actions are exposed:
//   - `toggleAuxiliary`         — open/close the auxiliary. If currently in
//                                  primary-overlay mode, closes it entirely
//                                  (exit + close).
//   - `toggleAuxiliaryPrimary`  — expand the auxiliary to overlay the main
//                                  view; if already in overlay, contract back
//                                  to the right column. Platform-specific UI
//                                  placement: macOS keeps the contract button
//                                  in AuxHeader; Windows moves it to the
//                                  WindowChrome trailing controls in
//                                  primary-overlay mode.

import { useCallback, useEffect, useRef } from "react";
import type { WorkbenchLayoutApi } from "./use-workbench-layout";
import { getAuxiliarySessionScope } from "./auxiliary-visibility";
import { WORKBENCH_GEOMETRY, type AuxiliaryMode } from "./layout-model";
import { useAuxiliaryTransition } from "./use-auxiliary-transition";

export interface WorkbenchTransitionApi {
  auxiliarySwitching: boolean;
  // Fire-and-forget primary toggle. The 580ms transition reset timer is
  // managed internally based on `layout.state.primaryTransition`.
  togglePrimary: () => void;
  // Open / close the auxiliary sidebar. If the auxiliary is currently in
  // `primary-overlay` mode, calling this closes it entirely (the design
  // treats that as "exit + close" — the same behaviour as Marloues'
  // `toggleAuxiliary` callback).
  toggleAuxiliary: () => void;
  // Enter/exit auxiliary primary-overlay. When already in overlay, exits it
  // (and optionally also closes the auxiliary panel for the active session).
  toggleAuxiliaryPrimary: () => void;
  leaveAuxiliaryPrimary: (closeAuxiliary?: boolean) => void;
}

export function useWorkbenchTransitions(
  layout: WorkbenchLayoutApi,
  activeSessionId: string | null,
): WorkbenchTransitionApi {
  const { state, dispatch, setAuxiliaryOpen } = layout;
  const { switching: auxiliarySwitching, transition: transitionAuxiliary } =
    useAuxiliaryTransition(dispatch);
  const transitionTimerRef = useRef<number | null>(null);

  // Reset the primary transition after the shell animation completes.
  useEffect(() => {
    if (state.primaryTransition === "idle") {
      return;
    }
    if (transitionTimerRef.current != null) {
      window.clearTimeout(transitionTimerRef.current);
    }
    transitionTimerRef.current = window.setTimeout(() => {
      dispatch({ type: "primary.transition.set", value: "idle" });
      transitionTimerRef.current = null;
    }, WORKBENCH_GEOMETRY.shellTransitionMs);
    return () => {
      if (transitionTimerRef.current != null) {
        window.clearTimeout(transitionTimerRef.current);
        transitionTimerRef.current = null;
      }
    };
  }, [state.primaryTransition, dispatch]);

  const togglePrimary = useCallback(() => {
    dispatch({ type: "primary.toggle" });
  }, [dispatch]);

  // toggleAuxiliary (open/close auxiliary) — distinct from
  // toggleAuxiliaryPrimary (expand to main view / contract back). Per the
  // Marloues design, when the auxiliary is currently in `primary-overlay`
  // mode, calling this collapses the overlay AND closes the panel
  // (i.e. exits + closes). For all other modes it just toggles open/close.
  const toggleAuxiliary = useCallback(() => {
    if (state.auxiliaryPrimaryOverlay) {
      setAuxiliaryOpen(false);
      transitionAuxiliary("closed");
      return;
    }
    const scope = getAuxiliarySessionScope(activeSessionId);
    const isOpen = state.auxiliaryOpenScopes.has(scope);
    if (isOpen) {
      setAuxiliaryOpen(false);
    } else {
      setAuxiliaryOpen(true);
      dispatch({ type: "auxiliary.width.ensureMin" });
    }
  }, [
    activeSessionId,
    state.auxiliaryPrimaryOverlay,
    state.auxiliaryOpenScopes,
    dispatch,
    setAuxiliaryOpen,
    transitionAuxiliary,
  ]);

  const leaveAuxiliaryPrimary = useCallback(
    (closeAuxiliary = false) => {
      // Restore the primary sidebar when the overlay returns to its right track.
      const nextMode: AuxiliaryMode = closeAuxiliary ? "closed" : "open";
      transitionAuxiliary(nextMode);
      dispatch({ type: "primary.peek", value: false });
      if (closeAuxiliary) setAuxiliaryOpen(false);
      else setAuxiliaryOpen(true);
    },
    [dispatch, setAuxiliaryOpen, transitionAuxiliary],
  );

  const toggleAuxiliaryPrimary = useCallback(() => {
    if (state.auxiliaryPrimaryOverlay) {
      leaveAuxiliaryPrimary(false);
      return;
    }
    // Enter primary-overlay without changing the standard right-track width.
    // The shell uses that width for its placeholder while CSS expands the
    // auxiliary surface over the main view.
    setAuxiliaryOpen(true);
    transitionAuxiliary("primary-overlay");
  }, [
    state.auxiliaryPrimaryOverlay,
    setAuxiliaryOpen,
    leaveAuxiliaryPrimary,
    transitionAuxiliary,
  ]);

  return {
    auxiliarySwitching,
    togglePrimary,
    toggleAuxiliary,
    toggleAuxiliaryPrimary,
    leaveAuxiliaryPrimary,
  };
}
