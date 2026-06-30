import { app, dialog } from "electron";
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  getEnterpriseConfigPath,
  getLogDir,
  getSettingsPath,
  getStateDbPath,
  getWorkspaceSettingsPath,
} from "../app-paths";
import {
  getAgentTextLogPath,
  getAppLogPath,
  getConsoleLogPath,
  getConsoleTextLogPath,
  getErrorsTextLogPath,
  getHttpLogPath,
  getHttpTextLogPath,
  getRuntimeLogPath,
  getRuntimeTextLogPath,
} from "../core/logging/app-logger";
import {
  redactSensitiveText,
  redactSensitiveValue,
} from "../core/security/redaction";
import { getAgentSettings } from "./config-service";
import { getCurrentWorkspace } from "./workspace-service";
import { listAuditEvents } from "./session-store";

const MAX_LOG_CHARS = 80_000;

export async function exportDiagnostics(): Promise<string | null> {
  const result = await dialog.showSaveDialog({
    title: "导出诊断包",
    defaultPath: `marloues-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (result.canceled || !result.filePath) return null;

  const payload = buildDiagnosticsPayload();
  await writeFile(
    result.filePath,
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
  return result.filePath;
}

export function buildDiagnosticsPayload(): Record<string, unknown> {
  const payload = redactDiagnosticsValue({
    exportedAt: new Date().toISOString(),
    app: {
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      packaged: app.isPackaged,
    },
    workspace: getCurrentWorkspace(),
    settings: getAgentSettings(),
    files: {
      settingsPath: getSettingsPath(),
      workspaceSettingsPath: getWorkspaceSettingsPath(),
      enterpriseConfigPath: getEnterpriseConfigPath(),
      stateDbPath: getStateDbPath(),
      logDir: getLogDir(),
      enterpriseConfig: readJsonFileIfExists(getEnterpriseConfigPath()),
      workspaceSettings: readJsonFileIfExists(getWorkspaceSettingsPath()),
    },
    auditEvents: listAuditEvents(200),
    logs: readLogBundle(),
  });
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

export function redactDiagnosticsValue(value: unknown): unknown {
  return redactSensitiveValue(value);
}

function readLogBundle(): Record<string, unknown> {
  return Object.fromEntries(
    [
      getAppLogPath(),
      getRuntimeLogPath(),
      getConsoleLogPath(),
      getAgentTextLogPath(),
      getErrorsTextLogPath(),
      getRuntimeTextLogPath(),
      getConsoleTextLogPath(),
      getHttpLogPath(),
      getHttpTextLogPath(),
      join(getLogDir(), "audit.jsonl"),
    ].map((filePath) => [
      basename(filePath),
      {
        path: filePath,
        exists: existsSync(filePath),
        tail: readTextTail(filePath),
      },
    ]),
  );
}

function readTextTail(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  const text = readFileSync(filePath, "utf8");
  return redactSensitiveText(
    text.slice(Math.max(0, text.length - MAX_LOG_CHARS)),
  );
}

function readJsonFileIfExists(filePath: string): unknown {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return "[unreadable-json]";
  }
}
