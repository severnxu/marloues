import { describe, expect, it } from "vitest";
import {
  WORKBENCH_GEOMETRY,
  createInitialWorkbenchLayoutState,
  deriveAuxiliaryMode,
  workbenchLayoutReducer,
  type WorkbenchLayoutState,
} from "./layout-model";

const fresh = (): WorkbenchLayoutState => createInitialWorkbenchLayoutState();

describe("workbenchLayoutReducer — primary sidebar", () => {
  it("opens from closed via 'opening' transition", () => {
    let state = fresh();
    state = { ...state, primaryOpen: false };
    state = workbenchLayoutReducer(state, { type: "primary.toggle" });
    expect(state.primaryOpen).toBe(true);
    expect(state.primaryTransition).toBe("opening");
    expect(state.primaryPeeking).toBe(false);
  });

  it("toggle from peeking state promotes (no flinch)", () => {
    let state = fresh();
    state = { ...state, primaryOpen: false, primaryPeeking: true };
    state = workbenchLayoutReducer(state, { type: "primary.toggle" });
    expect(state.primaryOpen).toBe(true);
    expect(state.primaryTransition).toBe("promoting");
    expect(state.primaryPeeking).toBe(false);
  });

  it("closing sets 'closing' transition and suppresses hover", () => {
    let state = fresh(); // primaryOpen: true
    state = workbenchLayoutReducer(state, { type: "primary.toggle" });
    expect(state.primaryOpen).toBe(false);
    expect(state.primaryTransition).toBe("closing");
    expect(state.primaryHoverSuppressed).toBe(true);
  });

  it("peek is ignored while open", () => {
    let state = fresh(); // primaryOpen: true
    state = workbenchLayoutReducer(state, {
      type: "primary.peek",
      value: true,
    });
    expect(state.primaryPeeking).toBe(false);
  });

  it("peek is ignored when hover is suppressed (just-closed)", () => {
    let state = fresh();
    state = workbenchLayoutReducer(state, { type: "primary.toggle" }); // closed + suppressed
    state = workbenchLayoutReducer(state, {
      type: "primary.peek",
      value: true,
    });
    expect(state.primaryPeeking).toBe(false);
  });

  it("peek applies when closed and not suppressed", () => {
    let state = fresh();
    state = { ...state, primaryOpen: false, primaryHoverSuppressed: false };
    state = workbenchLayoutReducer(state, {
      type: "primary.peek",
      value: true,
    });
    expect(state.primaryPeeking).toBe(true);
  });

  it("resize clamps to [primaryMin, primaryMax] and forces open", () => {
    let state = fresh();
    state = { ...state, primaryOpen: false };
    state = workbenchLayoutReducer(state, {
      type: "primary.resize",
      width: WORKBENCH_GEOMETRY.primaryMin - 50,
    });
    expect(state.primaryOpen).toBe(true);
    expect(state.primaryWidth).toBe(WORKBENCH_GEOMETRY.primaryMin);
  });

  it("collapse resets width to default and clears peek", () => {
    let state = fresh();
    state = { ...state, primaryPeeking: true, primaryWidth: 400 };
    state = workbenchLayoutReducer(state, { type: "primary.collapse" });
    expect(state.primaryOpen).toBe(false);
    expect(state.primaryPeeking).toBe(false);
    expect(state.primaryWidth).toBe(WORKBENCH_GEOMETRY.primaryDefault);
  });
});

describe("workbenchLayoutReducer — auxiliary inspector (session-scoped)", () => {
  it("opens auxiliary for a specific session scope only", () => {
    let state = fresh();
    state = workbenchLayoutReducer(state, {
      type: "auxiliary.scope.set",
      scope: "session-A",
      open: true,
    });
    expect(state.auxiliaryOpenScopes.has("session-A")).toBe(true);
    expect(state.auxiliaryOpenScopes.has("session-B")).toBe(false);
  });

  it("function-form action receives current open state for that scope", () => {
    let state = fresh();
    state = workbenchLayoutReducer(state, {
      type: "auxiliary.scope.set",
      scope: "s1",
      open: true,
    });
    state = workbenchLayoutReducer(state, {
      type: "auxiliary.scope.set",
      scope: "s1",
      open: (prev) => !prev,
    });
    expect(state.auxiliaryOpenScopes.has("s1")).toBe(false);
  });

  it("no-op set returns the same state reference", () => {
    const state = fresh();
    const next = workbenchLayoutReducer(state, {
      type: "auxiliary.scope.set",
      scope: "s1",
      open: false, // already closed
    });
    expect(next).toBe(state);
  });

  it("opening one session does not mutate another session's state", () => {
    let state = fresh();
    state = workbenchLayoutReducer(state, {
      type: "auxiliary.scope.set",
      scope: "s1",
      open: true,
    });
    state = workbenchLayoutReducer(state, {
      type: "auxiliary.scope.set",
      scope: "s2",
      open: true,
    });
    state = workbenchLayoutReducer(state, {
      type: "auxiliary.scope.set",
      scope: "s1",
      open: false,
    });
    expect(state.auxiliaryOpenScopes.has("s1")).toBe(false);
    expect(state.auxiliaryOpenScopes.has("s2")).toBe(true);
  });

  it("does not mutate the initial state's shared Set singleton", () => {
    // Guards against the classic "mutating initialWorkbenchLayoutState" bug.
    const first = workbenchLayoutReducer(fresh(), {
      type: "auxiliary.scope.set",
      scope: "s1",
      open: true,
    });
    expect(first.auxiliaryOpenScopes.has("s1")).toBe(true);
    // A second independent store must NOT see session s1.
    const second = fresh();
    expect(second.auxiliaryOpenScopes.has("s1")).toBe(false);
  });

  it("overlay toggle flips primaryOverlay flag", () => {
    let state = fresh();
    expect(state.auxiliaryPrimaryOverlay).toBe(false);
    state = workbenchLayoutReducer(state, { type: "auxiliary.overlay.toggle" });
    expect(state.auxiliaryPrimaryOverlay).toBe(true);
    state = workbenchLayoutReducer(state, { type: "auxiliary.overlay.toggle" });
    expect(state.auxiliaryPrimaryOverlay).toBe(false);
  });

  it("entering primary-overlay snapshots current width, exiting restores it", () => {
    // User customises the inspector to 400, then taps the expand-to-primary
    // button. They expect to get back to 400 when they tap it again.
    let state = fresh();
    state = { ...state, auxiliaryWidth: 400 };

    // Enter primary-overlay: the standard right track stays at 400 while the
    // overlay itself expands through CSS.
    state = workbenchLayoutReducer(state, {
      type: "auxiliary.mode.set",
      mode: "primary-overlay",
    });
    expect(state.auxiliaryPrimaryOverlay).toBe(true);
    expect(state.auxiliaryWidth).toBe(400);
    expect(state.auxiliaryWidthBeforePrimary).toBe(400);

    // Exit primary-overlay back to open — original 400 restored, snapshot
    // cleared so a future entry starts from whatever the user has at that
    // point (not a stale 400).
    state = workbenchLayoutReducer(state, {
      type: "auxiliary.mode.set",
      mode: "open",
    });
    expect(state.auxiliaryPrimaryOverlay).toBe(false);
    expect(state.auxiliaryWidth).toBe(400);
    expect(state.auxiliaryWidthBeforePrimary).toBeNull();
  });

  it("exiting primary-overlay via 'closed' also restores prior width", () => {
    // If the user enters overlay then taps the inspector close button
    // (toggleAuxiliary's overlay branch), width should still snap back.
    let state = fresh();
    state = { ...state, auxiliaryWidth: 380 };
    state = workbenchLayoutReducer(state, {
      type: "auxiliary.mode.set",
      mode: "primary-overlay",
    });
    state = workbenchLayoutReducer(state, {
      type: "auxiliary.mode.set",
      mode: "closed",
    });
    expect(state.auxiliaryWidth).toBe(380);
    expect(state.auxiliaryWidthBeforePrimary).toBeNull();
  });

  it("auxiliary.close clears the overlay-width snapshot", () => {
    // pointer-drag collapse should not leave a stale snapshot behind.
    let state = fresh();
    state = {
      ...state,
      auxiliaryPrimaryOverlay: true,
      auxiliaryWidth: 450,
      auxiliaryWidthBeforePrimary: 360,
    };
    state = workbenchLayoutReducer(state, { type: "auxiliary.close" });
    expect(state.auxiliaryPrimaryOverlay).toBe(false);
    expect(state.auxiliaryWidth).toBe(WORKBENCH_GEOMETRY.auxiliaryDefault);
    expect(state.auxiliaryWidthBeforePrimary).toBeNull();
  });
});

describe("deriveAuxiliaryMode", () => {
  it("returns 'closed' when not open for session and not overlay", () => {
    expect(deriveAuxiliaryMode(false, false)).toBe("closed");
  });
  it("returns 'open' when open for session and not overlay", () => {
    expect(deriveAuxiliaryMode(true, false)).toBe("open");
  });
  it("returns 'primary-overlay' regardless of session-open when overlay set", () => {
    expect(deriveAuxiliaryMode(false, true)).toBe("primary-overlay");
    expect(deriveAuxiliaryMode(true, true)).toBe("primary-overlay");
  });
});
