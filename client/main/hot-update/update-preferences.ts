import type { UpdateChannel, UpdatePreferences } from "@shared/hot-update";

export const DEFAULT_UPDATE_PREFERENCES: UpdatePreferences = {
  channel: "stable",
  autoCheck: true,
  autoDownload: false,
  autoApplyUi: false,
};

function channel(value: unknown): UpdateChannel {
  return value === "beta" || value === "nightly" ? value : "stable";
}

export function normalizeUpdatePreferences(value: unknown): UpdatePreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_UPDATE_PREFERENCES };
  }
  const input = value as Partial<UpdatePreferences>;
  return {
    channel: channel(input.channel),
    autoCheck: input.autoCheck !== false,
    autoDownload: input.autoDownload === true,
    autoApplyUi: input.autoApplyUi === true,
    ignoredVersion:
      typeof input.ignoredVersion === "string" && input.ignoredVersion.trim()
        ? input.ignoredVersion.trim()
        : undefined,
  };
}
