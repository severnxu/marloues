// Workbench layout model — pure logic core (no React).
//
// Pattern reference: Marloues `client/renderer/src/components/workbench/layout-model.ts`.
//
// marloues extension over Marloues:
//   - Auxiliary visibility is SESSION-SCOPED: each activeSessionId
//     tracks its own open/closed state via `auxiliaryOpenScopes`, so switching
//     sessions restores per-session layout. Marloues uses a single global bool.
//   - Primary (sidebar) has a 4-state transition (`idle|opening|closing|promoting`)
//     driven by a 580ms timer; Marloues only has a peek boolean.
//
// The reducer below is a superset of the Marloues contract — it preserves both
// marloues-specific behaviours while keeping the Marloues action vocabulary for
// the shared parts (primary.resize / auxiliary.toggle / etc.).

import { updateAuxiliaryVisibilityForSession } from "./auxiliary-visibility";

export const WORKBENCH_GEOMETRY = {
  primaryDefault: 275,
  primaryMin: 275,
  primaryMax: 480,
  primaryCollapse: 220,
  auxiliaryDefault: 319,
  auxiliaryMin: 319,
  auxiliaryCollapse: 220,
  auxiliaryDivider: 1,
  mainMin: 400,
  // Window width below which the auxiliary panel auto-closes when it would
  // otherwise starve the main region.
  autoCloseThreshold: 275 + 319 + 1 + 400,
  // Sidebar auto-closes below this window width.
  primaryAutoCloseThreshold: 680,
  // Shell CSS transition duration used by the primary 4-state machine.
  shellTransitionMs: 580,
} as const;

export type WorkbenchPlatform = "macos" | "windows";

// The auxiliary region has three visual modes:
//   - "closed"           — collapsed for the current session scope
//   - "open"             — expanded at auxiliaryWidth
//   - "primary-overlay"  — promoted to full workspace width
export type AuxiliaryMode = "closed" | "open" | "primary-overlay";

// Primary (sidebar) transition lifecycle. marloues has a richer model than
// Marloues' peek boolean because the sidebar plays an opening/closing CSS
// transition plus a special "promoting" state (peek → open without flinching).
export type PrimaryTransition = "idle" | "opening" | "closing" | "promoting";

export type ResizeTarget = "primary" | "auxiliary";

/**
 * Active auxiliary mode derived from session-scoped open state plus the
 * primary-overlay flag. This is the single source of truth for how the
 * auxiliary region should render for the *currently active* session.
 */
export function deriveAuxiliaryMode(
  openForActiveSession: boolean,
  primaryOverlay: boolean,
): AuxiliaryMode {
  if (primaryOverlay) return "primary-overlay";
  return openForActiveSession ? "open" : "closed";
}

/**
 * On macOS an open auxiliary column owns the window's trailing titlebar area,
 * so the conversation summary control stays in the conversation titlebar.
 * A closed auxiliary column keeps the established window-titlebar placement.
 */
export function shouldPlaceThreadSummaryInWindowTitlebar(
  isMacOS: boolean,
  auxiliaryOpen: boolean,
): boolean {
  return !isMacOS || !auxiliaryOpen;
}

export interface WorkbenchLayoutState {
  // Primary sidebar
  primaryOpen: boolean;
  primaryPeeking: boolean;
  primaryHoverSuppressed: boolean;
  primaryTransition: PrimaryTransition;
  primaryWidth: number;
  // Auxiliary region (session-scoped)
  auxiliaryOpenScopes: ReadonlySet<string>;
  auxiliaryPrimaryOverlay: boolean;
  auxiliaryWidth: number;
  // Width snapshot captured when entering primary-overlay mode. The overlay
  // itself fills the main columns via CSS while this value keeps the standard
  // right track stable behind it.
  auxiliaryWidthBeforePrimary: number | null;
}

export type WorkbenchLayoutAction =
  // Primary sidebar
  | { type: "primary.toggle" }
  | { type: "primary.peek"; value: boolean }
  | { type: "primary.hover.suppress"; value: boolean }
  | { type: "primary.transition.set"; value: PrimaryTransition }
  | { type: "primary.resize"; width: number }
  | { type: "primary.collapse" }
  | { type: "primary.width.ensureMin" }
  // Auxiliary region — session-scoped open/close
  | {
      type: "auxiliary.scope.set";
      scope: string;
      open: boolean | ((open: boolean) => boolean);
    }
  | { type: "auxiliary.toggle" } // toggles active session scope
  | { type: "auxiliary.mode.set"; mode: AuxiliaryMode }
  | { type: "auxiliary.overlay.toggle" }
  | { type: "auxiliary.resize"; width: number }
  | { type: "auxiliary.width.ensureMin" }
  | { type: "auxiliary.close" };

export const initialWorkbenchLayoutState: WorkbenchLayoutState = {
  primaryOpen: true,
  primaryPeeking: false,
  primaryHoverSuppressed: false,
  primaryTransition: "idle",
  primaryWidth: WORKBENCH_GEOMETRY.primaryDefault,
  auxiliaryOpenScopes: new Set<string>(),
  auxiliaryPrimaryOverlay: false,
  auxiliaryWidth: WORKBENCH_GEOMETRY.auxiliaryDefault,
  auxiliaryWidthBeforePrimary: null,
};

// Factory for callers that need an isolated state instance (avoids accidental
// mutation of the shared `initialWorkbenchLayoutState` singleton, in
// particular its auxiliaryOpenScopes Set). Prefer this in hooks/tests.
export function createInitialWorkbenchLayoutState(): WorkbenchLayoutState {
  return {
    ...initialWorkbenchLayoutState,
    auxiliaryOpenScopes: new Set<string>(),
  };
}

export function workbenchLayoutReducer(
  state: WorkbenchLayoutState,
  action: WorkbenchLayoutAction,
): WorkbenchLayoutState {
  switch (action.type) {
    // ---- Primary sidebar --------------------------------------------------
    case "primary.toggle": {
      // Decide whether the motion is a peek-to-open promotion or a regular
      // opening/closing transition. Timing is owned by useWorkbenchTransitions.
      const promoting =
        !state.primaryOpen &&
        (state.primaryPeeking || state.primaryTransition === "closing");
      const nextOpen = !state.primaryOpen;
      const nextTransition: PrimaryTransition = promoting
        ? "promoting"
        : nextOpen
          ? "opening"
          : "closing";
      return {
        ...state,
        primaryOpen: nextOpen,
        primaryPeeking: false,
        primaryHoverSuppressed: state.primaryOpen, // suppress hover when closing
        primaryTransition: nextTransition,
        primaryWidth: nextOpen
          ? Math.max(WORKBENCH_GEOMETRY.primaryMin, state.primaryWidth)
          : state.primaryWidth,
      };
    }
    case "primary.peek":
      // Peek only applies when the sidebar is closed.
      return state.primaryOpen || state.primaryHoverSuppressed
        ? state
        : { ...state, primaryPeeking: action.value };
    case "primary.hover.suppress":
      return { ...state, primaryHoverSuppressed: action.value };
    case "primary.transition.set":
      return { ...state, primaryTransition: action.value };
    case "primary.resize":
      return {
        ...state,
        primaryOpen: true,
        primaryPeeking: false,
        primaryWidth: clamp(
          action.width,
          WORKBENCH_GEOMETRY.primaryMin,
          WORKBENCH_GEOMETRY.primaryMax,
        ),
      };
    case "primary.collapse":
      return {
        ...state,
        primaryOpen: false,
        primaryPeeking: false,
        primaryWidth: WORKBENCH_GEOMETRY.primaryDefault,
      };
    case "primary.width.ensureMin":
      return {
        ...state,
        primaryWidth: Math.max(
          WORKBENCH_GEOMETRY.primaryMin,
          state.primaryWidth,
        ),
      };

    // ---- Auxiliary region ------------------------------------------------
    case "auxiliary.scope.set": {
      const nextScopes = updateAuxiliaryVisibilityForSession(
        state.auxiliaryOpenScopes,
        action.scope,
        action.open,
      );
      if (nextScopes === state.auxiliaryOpenScopes) return state;
      return { ...state, auxiliaryOpenScopes: nextScopes };
    }
    case "auxiliary.toggle": {
      // Toggles require the active scope, which the hook supplies via
      // `auxiliary.scope.set` with a function. This action is a no-op stub
      // kept for API symmetry with Marloues; real toggling goes through
      // auxiliary.scope.set in the hook.
      return state;
    }
    case "auxiliary.mode.set": {
      // Snapshot/restore the standard auxiliary track around primary-overlay.
      // Entering overlay must not change auxiliaryWidth: that width owns the
      // invisible placeholder which prevents the main view from reflowing.
      const wasOverlay = state.auxiliaryPrimaryOverlay;
      const willBeOverlay = action.mode === "primary-overlay";
      const enteringOverlay = !wasOverlay && willBeOverlay;
      const exitingOverlay = wasOverlay && !willBeOverlay;
      const nextSnapshot = enteringOverlay
        ? state.auxiliaryWidth
        : exitingOverlay
          ? null
          : state.auxiliaryWidthBeforePrimary;
      const nextWidth = exitingOverlay
        ? (state.auxiliaryWidthBeforePrimary ?? state.auxiliaryWidth)
        : action.mode === "closed"
          ? state.auxiliaryWidth
          : Math.max(WORKBENCH_GEOMETRY.auxiliaryMin, state.auxiliaryWidth);
      return {
        ...state,
        auxiliaryPrimaryOverlay: willBeOverlay,
        auxiliaryWidthBeforePrimary: nextSnapshot,
        auxiliaryWidth: nextWidth,
      };
    }
    case "auxiliary.overlay.toggle":
      return {
        ...state,
        auxiliaryPrimaryOverlay: !state.auxiliaryPrimaryOverlay,
      };
    case "auxiliary.resize":
      return {
        ...state,
        auxiliaryWidth: Math.max(WORKBENCH_GEOMETRY.auxiliaryMin, action.width),
      };
    case "auxiliary.width.ensureMin":
      return {
        ...state,
        auxiliaryWidth: Math.max(
          WORKBENCH_GEOMETRY.auxiliaryMin,
          state.auxiliaryWidth,
        ),
      };
    case "auxiliary.close":
      // Note: closing the auxiliary in session-scoped model is handled by
      // auxiliary.scope.set in the hook. This action resets overlay + width
      // to defaults (used by pointer-drag collapse). The overlay-width
      // snapshot is cleared too so the next overlay entry starts from a
      // known-default baseline rather than a stale capture.
      return {
        ...state,
        auxiliaryPrimaryOverlay: false,
        auxiliaryWidth: WORKBENCH_GEOMETRY.auxiliaryDefault,
        auxiliaryWidthBeforePrimary: null,
      };
    default:
      return state;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
