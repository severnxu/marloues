import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  initialWorkbenchLayoutState,
  type ResizeTarget,
  WORKBENCH_GEOMETRY,
  workbenchLayoutReducer,
} from "./layout-model";

export function useWorkbenchLayout() {
  const [state, dispatch] = useReducer(
    workbenchLayoutReducer,
    initialWorkbenchLayoutState,
  );
  const contentFrameRef = useRef<HTMLDivElement>(null);
  const resizeTargetRef = useRef<ResizeTarget | null>(null);
  const peekTimerRef = useRef<number | null>(null);

  const finishResize = useCallback(() => {
    resizeTargetRef.current = null;
    document.body.classList.remove("resizing-columns");
  }, []);

  useEffect(() => {
    let frame = 0;
    const handlePointerMove = (event: PointerEvent) => {
      const target = resizeTargetRef.current;
      if (!target) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const bounds = contentFrameRef.current?.getBoundingClientRect();
        if (!bounds) return;
        if (target === "primary") {
          const proposed = event.clientX;
          if (proposed < WORKBENCH_GEOMETRY.collapseThreshold) {
            dispatch({ type: "primary.collapse" });
            finishResize();
            return;
          }
          dispatch({ type: "primary.resize", width: proposed });
          return;
        }
        const proposed = bounds.right - event.clientX;
        if (proposed < WORKBENCH_GEOMETRY.collapseThreshold) {
          dispatch({ type: "auxiliary.close" });
          finishResize();
          return;
        }
        dispatch({ type: "auxiliary.resize", width: proposed });
      });
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishResize);
    window.addEventListener("pointercancel", finishResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishResize);
      window.removeEventListener("pointercancel", finishResize);
    };
  }, [finishResize]);

  useEffect(() => {
    const closeAuxiliaryWhenNarrow = () => {
      const minimum =
        (state.primaryOpen ? WORKBENCH_GEOMETRY.primaryMin : 0) +
        WORKBENCH_GEOMETRY.mainMin +
        WORKBENCH_GEOMETRY.auxiliaryMin;
      if (state.auxiliaryMode === "open" && window.innerWidth < minimum) {
        dispatch({ type: "auxiliary.close" });
      }
    };
    closeAuxiliaryWhenNarrow();
    window.addEventListener("resize", closeAuxiliaryWhenNarrow);
    return () => window.removeEventListener("resize", closeAuxiliaryWhenNarrow);
  }, [state.auxiliaryMode, state.primaryOpen]);

  useEffect(
    () => () => {
      if (peekTimerRef.current != null)
        window.clearTimeout(peekTimerRef.current);
    },
    [],
  );

  const startResize = useCallback(
    (target: ResizeTarget, event: ReactPointerEvent<HTMLDivElement>) => {
      if (target === "auxiliary" && state.auxiliaryMode === "primary-overlay") {
        return;
      }
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      resizeTargetRef.current = target;
      document.body.classList.add("resizing-columns");
    },
    [state.auxiliaryMode],
  );

  const showPrimaryPeek = useCallback(() => {
    if (peekTimerRef.current != null) window.clearTimeout(peekTimerRef.current);
    dispatch({ type: "primary.peek", value: true });
  }, []);

  const hidePrimaryPeek = useCallback(() => {
    if (peekTimerRef.current != null) window.clearTimeout(peekTimerRef.current);
    peekTimerRef.current = window.setTimeout(
      () => dispatch({ type: "primary.peek", value: false }),
      120,
    );
  }, []);

  return {
    state,
    dispatch,
    contentFrameRef,
    startResize,
    showPrimaryPeek,
    hidePrimaryPeek,
  };
}
