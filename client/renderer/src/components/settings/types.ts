// Settings section identifiers used across the settings domain (dialog,
// workbench, page) and by consumers that need to navigate to a section
// (sidebar, global search, app shell).
//
// Source of truth lives here (not in layout/) so the settings domain owns
// its own vocabulary; layout/ re-exports it for backward compatibility.
export type SettingsSection =
  | "general"
  | "personalization"
  | "appearance"
  | "providers"
  | "mcp"
  | "skills"
  | "audit"
  | "runtimes"
  | "version"
  | "im-channels";
