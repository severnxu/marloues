// Workbench-level custom events.
//
// Cross-component affordances (open global search, create new session) need
// to be triggerable from anywhere in the renderer. Dispatch a `CustomEvent`
// on `window`, then let `WorkbenchRoot` subscribe without prop drilling.

/** Opens the global search overlay (⌘K / Ctrl+K). */
export const OPEN_GLOBAL_SEARCH_EVENT = "marloues:open-global-search";

/** Creates a new chat session and focuses the composer (⌘N / Ctrl+N). */
export const CREATE_NEW_SESSION_EVENT = "marloues:create-new-session";
