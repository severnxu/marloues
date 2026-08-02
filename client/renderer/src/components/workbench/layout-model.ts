export const WORKBENCH_GEOMETRY = {
  titlebarHeight: 46,
  primaryDefault: 275,
  primaryMin: 275,
  primaryMax: 480,
  auxiliaryDefault: 319,
  auxiliaryMin: 319,
  auxiliaryMax: 500,
  collapseThreshold: 220,
  mainMin: 400,
} as const;

export type WorkbenchPlatform = "macos" | "windows";
export type AuxiliaryMode = "closed" | "open" | "primary-overlay";
export type ResizeTarget = "primary" | "auxiliary";

export interface WorkbenchLayoutState {
  primaryOpen: boolean;
  primaryPeeking: boolean;
  primaryWidth: number;
  auxiliaryMode: AuxiliaryMode;
  auxiliaryWidth: number;
}

export type WorkbenchLayoutAction =
  | { type: "primary.toggle" }
  | { type: "primary.peek"; value: boolean }
  | { type: "primary.resize"; width: number }
  | { type: "primary.collapse" }
  | { type: "auxiliary.toggle" }
  | { type: "auxiliary.mode.set"; mode: AuxiliaryMode }
  | { type: "auxiliary.overlay.toggle" }
  | { type: "auxiliary.resize"; width: number }
  | { type: "auxiliary.close" };

export const initialWorkbenchLayoutState: WorkbenchLayoutState = {
  primaryOpen: true,
  primaryPeeking: false,
  primaryWidth: WORKBENCH_GEOMETRY.primaryDefault,
  auxiliaryMode: "open",
  auxiliaryWidth: WORKBENCH_GEOMETRY.auxiliaryDefault,
};

export function resolveWorkbenchPlatform(
  nativePlatform: string,
  previewPlatform?: string | null,
): WorkbenchPlatform {
  if (previewPlatform === "darwin" || previewPlatform === "macos") {
    return "macos";
  }
  if (previewPlatform === "win32" || previewPlatform === "windows") {
    return "windows";
  }
  return nativePlatform === "darwin" ? "macos" : "windows";
}

export function workbenchLayoutReducer(
  state: WorkbenchLayoutState,
  action: WorkbenchLayoutAction,
): WorkbenchLayoutState {
  switch (action.type) {
    case "primary.toggle":
      return {
        ...state,
        primaryOpen: !state.primaryOpen,
        primaryPeeking: false,
        primaryWidth: state.primaryOpen
          ? WORKBENCH_GEOMETRY.primaryDefault
          : Math.max(state.primaryWidth, WORKBENCH_GEOMETRY.primaryMin),
      };
    case "primary.peek":
      return state.primaryOpen
        ? state
        : { ...state, primaryPeeking: action.value };
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
    case "auxiliary.toggle":
      return {
        ...state,
        auxiliaryMode: state.auxiliaryMode === "closed" ? "open" : "closed",
        auxiliaryWidth:
          state.auxiliaryMode === "closed"
            ? Math.max(state.auxiliaryWidth, WORKBENCH_GEOMETRY.auxiliaryMin)
            : state.auxiliaryWidth,
      };
    case "auxiliary.mode.set":
      return {
        ...state,
        auxiliaryMode: action.mode,
        auxiliaryWidth:
          action.mode === "closed"
            ? state.auxiliaryWidth
            : Math.max(state.auxiliaryWidth, WORKBENCH_GEOMETRY.auxiliaryMin),
      };
    case "auxiliary.overlay.toggle":
      return {
        ...state,
        auxiliaryMode:
          state.auxiliaryMode === "primary-overlay"
            ? "open"
            : "primary-overlay",
      };
    case "auxiliary.resize":
      return {
        ...state,
        auxiliaryMode: "open",
        auxiliaryWidth: clamp(
          action.width,
          WORKBENCH_GEOMETRY.auxiliaryMin,
          WORKBENCH_GEOMETRY.auxiliaryMax,
        ),
      };
    case "auxiliary.close":
      return {
        ...state,
        auxiliaryMode: "closed",
        auxiliaryWidth: WORKBENCH_GEOMETRY.auxiliaryDefault,
      };
    default:
      return state;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
