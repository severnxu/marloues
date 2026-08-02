import { describe, expect, it } from "vitest";
import {
  initialWorkbenchLayoutState,
  resolveWorkbenchPlatform,
  WORKBENCH_GEOMETRY,
  workbenchLayoutReducer,
} from "../../client/renderer/src/components/workbench/layout-model";

describe("workbench layout state", () => {
  it("allows renderer-only platform previews without changing the native default", () => {
    expect(resolveWorkbenchPlatform("win32", "darwin")).toBe("macos");
    expect(resolveWorkbenchPlatform("darwin", "windows")).toBe("windows");
    expect(resolveWorkbenchPlatform("darwin", null)).toBe("macos");
    expect(resolveWorkbenchPlatform("win32", null)).toBe("windows");
  });

  it("promotes the auxiliary region without changing the primary sidebar", () => {
    const collapsed = workbenchLayoutReducer(initialWorkbenchLayoutState, {
      type: "primary.collapse",
    });
    const promoted = workbenchLayoutReducer(collapsed, {
      type: "auxiliary.overlay.toggle",
    });

    expect(promoted.auxiliaryMode).toBe("primary-overlay");
    expect(promoted.primaryOpen).toBe(false);
    expect(promoted.primaryWidth).toBe(WORKBENCH_GEOMETRY.primaryDefault);
  });

  it("returns an auxiliary overlay to the standard open track", () => {
    const promoted = workbenchLayoutReducer(initialWorkbenchLayoutState, {
      type: "auxiliary.overlay.toggle",
    });
    const restored = workbenchLayoutReducer(promoted, {
      type: "auxiliary.overlay.toggle",
    });

    expect(restored.auxiliaryMode).toBe("open");
    expect(restored.auxiliaryWidth).toBe(
      initialWorkbenchLayoutState.auxiliaryWidth,
    );
  });

  it("sets an exact auxiliary mode without changing either column width", () => {
    const overlay = workbenchLayoutReducer(initialWorkbenchLayoutState, {
      type: "auxiliary.mode.set",
      mode: "primary-overlay",
    });
    const closed = workbenchLayoutReducer(overlay, {
      type: "auxiliary.mode.set",
      mode: "closed",
    });

    expect(overlay.auxiliaryMode).toBe("primary-overlay");
    expect(overlay.primaryWidth).toBe(initialWorkbenchLayoutState.primaryWidth);
    expect(closed.auxiliaryMode).toBe("closed");
    expect(closed.auxiliaryWidth).toBe(
      initialWorkbenchLayoutState.auxiliaryWidth,
    );
  });

  it("resizes each column within its own frozen bounds", () => {
    const primary = workbenchLayoutReducer(initialWorkbenchLayoutState, {
      type: "primary.resize",
      width: 900,
    });
    const auxiliary = workbenchLayoutReducer(primary, {
      type: "auxiliary.resize",
      width: 120,
    });

    expect(primary.primaryWidth).toBe(WORKBENCH_GEOMETRY.primaryMax);
    expect(auxiliary.auxiliaryWidth).toBe(WORKBENCH_GEOMETRY.auxiliaryMin);
    expect(auxiliary.primaryWidth).toBe(WORKBENCH_GEOMETRY.primaryMax);
  });

  it("peek never opens a primary sidebar that is already expanded", () => {
    expect(
      workbenchLayoutReducer(initialWorkbenchLayoutState, {
        type: "primary.peek",
        value: true,
      }),
    ).toEqual(initialWorkbenchLayoutState);
  });
});
