import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { UpdatePreferences } from "@shared/hot-update";
import { getConfigDir } from "../app-paths";
import { logWarn } from "../core/logging/app-logger";
import {
  DEFAULT_UPDATE_PREFERENCES,
  normalizeUpdatePreferences,
} from "../hot-update/update-preferences";

function preferencesPath(): string {
  return join(getConfigDir(), "updates.json");
}

export function getUpdatePreferences(): UpdatePreferences {
  const filePath = preferencesPath();
  if (!existsSync(filePath)) return { ...DEFAULT_UPDATE_PREFERENCES };
  try {
    return normalizeUpdatePreferences(
      JSON.parse(readFileSync(filePath, "utf-8")),
    );
  } catch (error) {
    logWarn("update.preferences.readFailed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ...DEFAULT_UPDATE_PREFERENCES };
  }
}

export function saveUpdatePreferences(value: unknown): UpdatePreferences {
  const preferences = normalizeUpdatePreferences(value);
  const filePath = preferencesPath();
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(preferences, null, 2)}\n`, "utf-8");
  try {
    renameSync(tempPath, filePath);
  } catch {
    copyFileSync(tempPath, filePath);
    unlinkSync(tempPath);
  }
  return preferences;
}
