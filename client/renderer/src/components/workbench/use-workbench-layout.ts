// Workbench layout hook — wires the layout-model reducer to pointer/resize
// interaction.
//
// Global pointer events, responsive auto-close, and primary peek timing all
// dispatch into the pure reducer in layout-model.ts.

import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  createInitialWorkbenchLayoutState,
  WORKBENCH_GEOMETRY,
  workbenchLayoutReducer,
  type ResizeTarget,
} from "./layout-model";
import {
  getAuxiliarySessionScope,
  type AuxiliaryVisibilityAction,
} from "./auxiliary-visibility";

export interface WorkbenchLayoutApi {
  state: ReturnType<typeof createInitialWorkbenchLayoutState>;
  dispatch: React.Dispatch<Parameters<typeof workbenchLayoutReducer>[1]>;
  // Refs the transition hook / root need to mutate style.transition on.
  primaryRef: MutableRefObject<HTMLDivElement | null>;
  auxiliaryRef: MutableRefObject<HTMLDivElement | null>;
  contentFrameRef: MutableRefObject<HTMLDivElement | null>;
  // Pointer-drag entry point for ResizeHandle components.
  startResize: (
    target: ResizeTarget,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => void;
  // Session-scoped auxiliary visibility callback.
  setAuxiliaryOpen: (action: AuxiliaryVisibilityAction) => void;
  // Primary peek affordances (hover on collapsed sidebar).
  showPrimaryPeek: () => void;
  schedulePrimaryPeekHide: () => void;
}

export function useWorkbenchLayout(
  activeSessionId: string | null,
): WorkbenchLayoutApi {
  const [state, dispatch] = useReducer(
    workbenchLayoutReducer,
    null,
    createInitialWorkbenchLayoutState,
  );

  const primaryRef = useRef<HTMLDivElement>(null);
  const auxiliaryRef = useRef<HTMLDivElement>(null);
  const contentFrameRef = useRef<HTMLDivElement>(null);
  const resizeTargetRef = useRef<ResizeTarget | null>(null);
  const peekHideTimerRef = useRef<number | null>(null);

  // Keep refs of the values the global listeners need to read without
  // rebinding (they are attached once).
  const primaryOpenRef = useRef(state.primaryOpen);
  primaryOpenRef.current = state.primaryOpen;
  const auxiliaryOpenRef = useRef(false); // updated below from session scope
  auxiliaryOpenRef.current = state.auxiliaryOpenScopes.has(
    getAuxiliarySessionScope(activeSessionId),
  );
  const auxiliaryPrimaryOverlayRef = useRef(state.auxiliaryPrimaryOverlay);
  auxiliaryPrimaryOverlayRef.current = state.auxiliaryPrimaryOverlay;

  const setAuxiliaryOpen = useCallback(
    (action: AuxiliaryVisibilityAction) => {
      dispatch({
        type: "auxiliary.scope.set",
        scope: getAuxiliarySessionScope(activeSessionId),
        open: action,
      });
    },
    [activeSessionId],
  );

  const finishResize = useCallback(() => {
    resizeTargetRef.current = null;
    document.body.classList.remove(
      "resizing-columns",
      "resizing-left-column",
      "resizing-right-column",
    );
    if (primaryRef.current) primaryRef.current.style.transition = "";
    if (auxiliaryRef.current) auxiliaryRef.current.style.transition = "";
  }, []);

  // Global pointermove/pointerup with rAF throttle — drives column resizing.
  useEffect(() => {
    let rafId: number | null = null;

    const onPointerMove = (event: PointerEvent) => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (resizeTargetRef.current === "primary") {
          const nextWidth = Math.min(
            WORKBENCH_GEOMETRY.primaryMax,
            event.clientX,
          );
          if (nextWidth < WORKBENCH_GEOMETRY.primaryCollapse) {
            dispatch({ type: "primary.collapse" });
            finishResize();
            return;
          }
          dispatch({ type: "primary.resize", width: nextWidth });
          return;
        }
        if (resizeTargetRef.current === "auxiliary") {
          const frameRect = contentFrameRef.current?.getBoundingClientRect();
          const frameRight = frameRect?.right ?? window.innerWidth;
          const frameWidth = frameRect?.width ?? window.innerWidth;
          const maxWidth = Math.max(
            0,
            frameWidth -
              WORKBENCH_GEOMETRY.mainMin -
              WORKBENCH_GEOMETRY.auxiliaryDivider,
          );
          const nextWidth = Math.min(maxWidth, frameRight - event.clientX);
          if (nextWidth < WORKBENCH_GEOMETRY.auxiliaryCollapse) {
            setAuxiliaryOpen(false);
            dispatch({ type: "auxiliary.close" });
            finishResize();
            return;
          }
          setAuxiliaryOpen(true);
          dispatch({ type: "auxiliary.resize", width: nextWidth });
        }
      });
    };

    const onPointerUp = () => finishResize();

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [finishResize, setAuxiliaryOpen]);

  // Auto-close regions when the window gets too narrow.
  useEffect(() => {
    const check = () => {
      const width = window.innerWidth;
      if (
        auxiliaryOpenRef.current &&
        !auxiliaryPrimaryOverlayRef.current &&
        width < WORKBENCH_GEOMETRY.autoCloseThreshold
      ) {
        setAuxiliaryOpen(false);
      }
      if (
        primaryOpenRef.current &&
        width < WORKBENCH_GEOMETRY.primaryAutoCloseThreshold
      ) {
        dispatch({ type: "primary.collapse" });
      }
    };

    const observer = new ResizeObserver(check);
    observer.observe(document.body);
    window.addEventListener("resize", check);
    check();

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", check);
    };
  }, [setAuxiliaryOpen]);

  const startResize = useCallback(
    (target: ResizeTarget, event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      resizeTargetRef.current = target;
      document.body.classList.add(
        "resizing-columns",
        target === "primary" ? "resizing-left-column" : "resizing-right-column",
      );
      if (primaryRef.current) primaryRef.current.style.transition = "none";
      if (auxiliaryRef.current) auxiliaryRef.current.style.transition = "none";
    },
    [],
  );

  const showPrimaryPeek = useCallback(() => {
    if (peekHideTimerRef.current != null) {
      window.clearTimeout(peekHideTimerRef.current);
      peekHideTimerRef.current = null;
    }
    dispatch({ type: "primary.peek", value: true });
  }, []);

  const schedulePrimaryPeekHide = useCallback(() => {
    if (peekHideTimerRef.current != null) {
      window.clearTimeout(peekHideTimerRef.current);
    }
    peekHideTimerRef.current = window.setTimeout(() => {
      dispatch({ type: "primary.peek", value: false });
      dispatch({ type: "primary.hover.suppress", value: false });
      peekHideTimerRef.current = null;
    }, 120);
  }, []);

  // Clear pending timers on unmount.
  useEffect(
    () => () => {
      if (peekHideTimerRef.current != null) {
        window.clearTimeout(peekHideTimerRef.current);
      }
    },
    [],
  );

  return {
    state,
    dispatch,
    primaryRef,
    auxiliaryRef,
    contentFrameRef,
    startResize,
    setAuxiliaryOpen,
    showPrimaryPeek,
    schedulePrimaryPeekHide,
  };
}
