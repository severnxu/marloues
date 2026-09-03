export const MARKETPLACE_PAGE_SIZE = 20;
export const SEARCH_DEBOUNCE_MS = 300;

export type SkillView = "discover" | "installed";
export type InstalledQuickFilter =
  "all" | "enabled" | "disabled" | "marketplace";
export type SkillSelection =
  { kind: "market"; slug: string } | { kind: "installed"; id: string } | null;
