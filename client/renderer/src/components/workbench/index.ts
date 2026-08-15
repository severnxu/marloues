// Workbench top-level domain — cross-platform window shell, layout regions,
// and the layout state model.
//
// Pattern reference: Marloues `client/renderer/src/components/workbench/`.
//
// Barrel exports the "parts" (model, hooks, shells, chrome, view host). The
// domain entry point `WorkbenchRoot` is intentionally NOT re-exported here:
// consumers that want the assembled shell import it directly from
// `@/components/workbench/WorkbenchRoot`, mirroring the Marloues convention.

export * from "./layout-model";
export * from "./auxiliary-visibility";
export * from "./resolve-platform";
export type { Page } from "./types";
export * from "./use-workbench-layout";
export * from "./use-workbench-transitions";
export * from "./use-auxiliary-transition";
export { PlatformWindow } from "./PlatformWindow";
export type { PlatformWindowProps } from "./PlatformWindow";
export { WindowChrome } from "./WindowChrome";
export { ResizeHandle } from "./ResizeHandle";
export {
  WorkbenchLayout,
  PrimarySidebarShell,
  WorkbenchMainColumns,
  WorkbenchOverlayHost,
  MainWorkspaceShell,
  AuxiliarySidebarShell,
  AuxiliaryLayoutPlaceholder,
} from "./WorkbenchRegions";
export { WorkbenchAuxiliaryHost } from "./WorkbenchAuxiliaryHost";
export type { WorkbenchAuxiliaryHostProps } from "./WorkbenchAuxiliaryHost";
export { WorkbenchViewHost } from "./WorkbenchViewHost";
export type { WorkbenchViewHostProps } from "./WorkbenchViewHost";

// Subdomain barrel for interaction (SteerQueue, InteractionDock,
// TaskResultSummary) — populated in a follow-up pass.
export * as Interaction from "./interaction";
