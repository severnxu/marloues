import { app } from "electron";
import { homedir } from "node:os";
import { basename, join } from "node:path";

export function getMarlouesHome(): string {
  if (process.env.MARLOUES_HOME?.trim()) return process.env.MARLOUES_HOME.trim();
  return join(homedir(), app?.isPackaged ? ".marloues" : ".marloues-dev");
}

export function getConfigDir(): string {
  return join(getMarlouesHome(), "config");
}

export function getSettingsPath(): string {
  return join(getConfigDir(), "settings.json");
}

export function getWorkspaceSettingsPath(): string {
  return join(getConfigDir(), "workspaces.json");
}

export function getDevSettingsPathForImport(): string | null {
  if (process.env.MARLOUES_HOME?.trim()) return null;
  const home = getMarlouesHome();
  if (basename(home) !== ".marloues") return null;
  return join(homedir(), ".marloues-dev", "config", "settings.json");
}

export function getAuthStorePath(): string {
  return join(getConfigDir(), "auth.json");
}

export function getEnterpriseConfigPath(): string {
  return join(getConfigDir(), "marloues.enterprise.json");
}

export function getLegacyStorePath(): string {
  return join(getConfigDir(), "marloues-store.json");
}

export function getStateDir(): string {
  return join(getMarlouesHome(), "state");
}

export function getStateDbPath(): string {
  return join(getStateDir(), "marloues.sqlite");
}

export function getDevStateDbPathForImport(): string | null {
  if (process.env.MARLOUES_HOME?.trim()) return null;
  const home = getMarlouesHome();
  if (basename(home) !== ".marloues") return null;
  return join(homedir(), ".marloues-dev", "state", "marloues.sqlite");
}

export function getSessionMemoryDir(sessionId: string): string {
  return join(getStateDir(), "session-memory", sessionId);
}

export function getRuntimeConfigDir(): string {
  return join(getMarlouesHome(), "runtime-config");
}

export function getClaudeConfigDir(): string {
  return join(getMarlouesHome(), "claude-config");
}

export function getEnterpriseSkillsDir(): string {
  return join(getMarlouesHome(), "enterprise-skills");
}

export function getUserSkillsDir(): string {
  return join(getMarlouesHome(), "skills");
}

export function getLogDir(): string {
  return join(getMarlouesHome(), "logs");
}

export function getTempDir(): string {
  return join(getMarlouesHome(), "temp");
}

export function getCacheDir(): string {
  return join(getMarlouesHome(), "cache");
}
