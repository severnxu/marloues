import { Level, Logger } from "loge";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { inspect } from "node:util";
import { getLogDir } from "../../app-paths";
import { redactSensitiveValue } from "../security/redaction";

/**
 * Marloues Unified Logging System
 * ==============================
 * Architecture:
 *   - JSONL files (structured): marloues-debug.jsonl, marloues-runtime.jsonl, marloues-console.jsonl, http-raw.log
 *   - Text files (human-readable): agent.log, errors.log, runtime.log, console.log, http.log
 *   - Console echo: controlled by MARLOUES_LOG_CONSOLE env var
 *
 * Quick Reference:
 *   logInfo(event, data)       — key business events, always shown
 *   logWarn(event, data)       — recoverable anomalies
 *   logError(event, error)     — unrecoverable errors (pass Error object, NOT plain string)
 *   logDebug(event, data)      — only when DevMode is ON
 *   logRuntime(event, data)    — agent runtime lifecycle events
 *   logQuiet(event, data)      — file-only, no console echo
 *   logHttp(event, data)       — HTTP raw traffic (file-only; console only in DevMode)
 *   logConsole(level, src, msg, data) — renderer/process console capture (internal)
 *   createLogger(tag)          — module-scoped logger with auto-prefixed events
 *
 * Event Naming: module[.submodule].action (e.g., app.ready, config.saved)
 * Data Fields:  keep concise (< 8 KV pairs), prefer fixed names (error, url, path, id, count)
 *
 * Environment Variables:
 *   MARLOUES_LOG_CONSOLE=0 — disable all console echo
 *   MARLOUES_LOG_COLOR=0   — disable ANSI colors (structure preserved)
 *   MARLOUES_DEV_MODE=1    — enable debug-level logging
 *   MARLOUES_LOG_LEVEL     — override log level (trace | debug | info | warn | error | critical)
 */

type LogLevel = "debug" | "info" | "warn" | "error";
type ConsoleSource = "main" | "renderer" | "process";

const MAX_LOG_BYTES = 5 * 1024 * 1024;
const MAX_HTTP_LOG_BYTES = 20 * 1024 * 1024;
const CONSOLE_ECHO_ENABLED = process.env.MARLOUES_LOG_CONSOLE !== "0";
const COLOR_ENABLED =
  process.env.MARLOUES_LOG_COLOR !== "0" && !process.env.NO_COLOR;
const loggers = new Map<string, Logger>();

// ── Developer Mode ──
// Runtime-switchable flag. When OFF, debug-level logs are dropped at file level.
// Uses a cheap boolean check (O(1)) for hot-path protection, avoiding env-var reads.
let developerMode = process.env.MARLOUES_DEV_MODE === "1";
type DevModeListener = (enabled: boolean) => void;
const devModeListeners: DevModeListener[] = [];

/** O(1) memory check — safe to call on hot paths before expensive serialization. */
export function isDeveloperMode(): boolean {
  return developerMode;
}

/** Switch Developer Mode at runtime. Fires registered listeners. */
export function setDeveloperMode(enabled: boolean): void {
  if (developerMode === enabled) return;
  developerMode = enabled;
  // Refresh all cached logger instances so debug logs are not silently dropped.
  const newLevel = resolveLogLevel();
  for (const logger of loggers.values()) {
    logger.level = newLevel;
  }
  // Always log the transition regardless of DevMode state
  const msg = `Developer Mode ${enabled ? "ENABLED" : "DISABLED"} — file log level: ${enabled ? "debug" : "info"}`;
  const kvs = [{ key: "message", value: msg }];
  echoKVs("info", "logging.modeChanged", kvs);
  for (const listener of devModeListeners) {
    try {
      listener(enabled);
    } catch {
      /* never break app */
    }
  }
}

/** Register a callback invoked when Developer Mode toggles. */
export function onDeveloperModeChange(listener: DevModeListener): () => void {
  devModeListeners.push(listener);
  return () => {
    const idx = devModeListeners.indexOf(listener);
    if (idx >= 0) devModeListeners.splice(idx, 1);
  };
}

// ── Error Classification ──
const SUPPRESSED_ERROR_PATTERNS = [
  "EPIPE",
  "ETIMEDOUT",
  "ETIMEOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENETDOWN",
  "ENOTFOUND",
  "EAI_AGAIN",
  "Socket timeout",
  "TLSSocket._socketTimeout",
  "Socket._onTimeout",
  "broken pipe",
  "network timeout",
];

/** Returns true if the error is a known transient/network error that should not trigger full error reporting. */
export function isSuppressedError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  return SUPPRESSED_ERROR_PATTERNS.some((pattern) => msg.includes(pattern));
}

export function getAppLogPath(): string {
  return join(getLogDir(), "marloues-debug.jsonl");
}

export function getRuntimeLogPath(): string {
  return join(getLogDir(), "marloues-runtime.jsonl");
}

export function getConsoleLogPath(): string {
  return join(getLogDir(), "marloues-console.jsonl");
}

export function getAgentTextLogPath(): string {
  return join(getLogDir(), "agent.log");
}

export function getErrorsTextLogPath(): string {
  return join(getLogDir(), "errors.log");
}

export function getRuntimeTextLogPath(): string {
  return join(getLogDir(), "runtime.log");
}

export function getConsoleTextLogPath(): string {
  return join(getLogDir(), "console.log");
}

export function getHttpLogPath(): string {
  return join(getLogDir(), "http-raw.log");
}

export function getHttpTextLogPath(): string {
  return join(getLogDir(), "http.log");
}

// ── Module-Tagged Logger ──
// Returns log functions that automatically prefix events with a module tag,
// using a tagged module prefix convention for structured log filtering.
export function createLogger(tag: string) {
  const prefixed = (event: string) => `${tag}:${event}`;
  return {
    debug: (event: string, data?: Record<string, unknown>) =>
      logDebug(prefixed(event), data),
    info: (event: string, data?: Record<string, unknown>) =>
      logInfo(prefixed(event), data),
    warn: (event: string, data?: Record<string, unknown>) =>
      logWarn(prefixed(event), data),
    error: (event: string, error: unknown, data?: Record<string, unknown>) =>
      logError(prefixed(event), error, data),
    runtime: (event: string, data?: Record<string, unknown>) =>
      logRuntime(prefixed(event), data),
    /** Returns true when devMode is ON — use before expensive JSON.stringify on hot paths. */
    isDev: () => developerMode,
  };
}

// ── HTTP Raw Log Channel ──
// File-only (no console echo). Only active when DevMode is ON.
// Uses 20MB limit to accommodate larger payloads. No redaction — developer opt-in.
export function logHttp(event: string, data?: Record<string, unknown>): void {
  if (!developerMode) return;
  writeLogTo(getHttpLogPath(), "info", event, data ?? {}, MAX_HTTP_LOG_BYTES, {
    skipConsole: true,
  });
}

/** Cheap check before performing expensive log data construction on hot paths. */
export function isLoggable(level: LogLevel): boolean {
  if (level === "debug" && !developerMode) return false;
  return true;
}

// ── File-Only Log (no console echo) ──
// Used by wrapper loggers (main/logger.ts, gateway/logger.ts) that should
// write to the structured log files but not pollute the terminal.
// Follows the pattern of disabling console transport for file-only sub-loggers.
export function logQuiet(event: string, data?: Record<string, unknown>): void {
  writeLogTo(getAppLogPath(), "info", event, data ?? {}, MAX_LOG_BYTES, {
    skipConsole: true,
  });
}

export function logDebug(event: string, data?: Record<string, unknown>): void {
  if (!developerMode) return;
  writeLog(getAppLogPath(), "debug", event, data);
}

export function logInfo(event: string, data?: Record<string, unknown>): void {
  writeLog(getAppLogPath(), "info", event, data);
}

export function logWarn(event: string, data?: Record<string, unknown>): void {
  writeLog(getAppLogPath(), "warn", event, data);
}

export function logError(
  event: string,
  error: unknown,
  data?: Record<string, unknown>,
): void {
  writeLog(getAppLogPath(), "error", event, {
    ...data,
    error: serializeError(error),
  });
}

export function logRuntime(
  event: string,
  data?: Record<string, unknown>,
): void {
  writeLog(getRuntimeLogPath(), "info", event, data);
}

export function logConsole(
  level: LogLevel,
  source: ConsoleSource,
  message: string,
  data?: Record<string, unknown>,
): void {
  if (!isLoggable(level)) return;
  writeLog(getConsoleLogPath(), level, "console", {
    source,
    message,
    ...data,
  });
}

export function installMainConsoleCapture(): void {
  const original = {
    debug: console.debug.bind(console),
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  console.debug = (...args: unknown[]) => {
    original.debug(...args);
    logConsole("debug", "main", formatConsoleArgs(args));
  };
  console.log = (...args: unknown[]) => {
    original.log(...args);
    logConsole("info", "main", formatConsoleArgs(args));
  };
  console.info = (...args: unknown[]) => {
    original.info(...args);
    logConsole("info", "main", formatConsoleArgs(args));
  };
  console.warn = (...args: unknown[]) => {
    original.warn(...args);
    logConsole("warn", "main", formatConsoleArgs(args));
  };
  console.error = (...args: unknown[]) => {
    original.error(...args);
    logConsole("error", "main", formatConsoleArgs(args));
  };
}

function writeLog(
  filePath: string,
  level: LogLevel,
  event: string,
  data: Record<string, unknown> = {},
): void {
  writeLogTo(filePath, level, event, data, MAX_LOG_BYTES);
}

function writeLogTo(
  filePath: string,
  level: LogLevel,
  event: string,
  data: Record<string, unknown>,
  maxBytes: number,
  opts?: { skipConsole?: boolean },
): void {
  try {
    const redactedData = redactSensitiveValue(data);
    const payload = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      event,
      ...(redactedData &&
      typeof redactedData === "object" &&
      !Array.isArray(redactedData)
        ? redactedData
        : {}),
    });
    const logger = getLogger(filePath, maxBytes);
    if (level === "debug") logger.debug("%s", payload);
    if (level === "info") logger.info("%s", payload);
    if (level === "warn") logger.warning("%s", payload);
    if (level === "error") logger.error("%s", payload);
    writeHumanLogs(filePath, level, event, redactedData);
    if (!opts?.skipConsole) {
      echoToConsole(filePath, level, event, payload, data);
    }
  } catch {
    // Logging must never break the app.
  }
}

function writeHumanLogs(
  sourcePath: string,
  level: LogLevel,
  event: string,
  data: unknown,
): void {
  const line = formatHumanLine(event, data);
  appendTextLine(getAgentTextLogPath(), line);
  if (level === "warn" || level === "error")
    appendTextLine(getErrorsTextLogPath(), line);
  if (sourcePath === getRuntimeLogPath())
    appendTextLine(getRuntimeTextLogPath(), line);
  if (sourcePath === getConsoleLogPath())
    appendTextLine(getConsoleTextLogPath(), line);
  if (sourcePath === getHttpLogPath())
    appendTextLine(getHttpTextLogPath(), line);
}

function appendTextLine(filePath: string, line: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  rotateIfNeeded(filePath);
  appendFileSync(filePath, `${line}\n`, "utf8");
}

function formatConsoleArgs(args: unknown[]): string {
  return args
    .map((arg) =>
      typeof arg === "string"
        ? arg
        : inspect(arg, { depth: 4, breakLength: 120 }),
    )
    .join(" ");
}

function formatHumanLine(event: string, data: unknown): string {
  const record =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};
  const tag = formatCorrelationTag(record);
  const details = Object.entries(record)
    .filter(
      ([key]) =>
        ![
          "ts",
          "level",
          "event",
          "chatSessionId",
          "kernelSessionId",
          "sessionId",
          "turnId",
        ].includes(key),
    )
    .map(([key, value]) => `${key}: ${formatConsoleValue(value)}`)
    .join(" ");
  const time = formatShortTime();
  const prefixTag = eventTag(event);
  return `${time} > [${prefixTag}]${tag} ${event}${details ? ` ${details}` : ""}`;
}

function formatCorrelationTag(record: Record<string, unknown>): string {
  const id =
    record["turnId"] ??
    record["kernelSessionId"] ??
    record["chatSessionId"] ??
    record["sessionId"];
  if (!id) return "";
  const text = String(id);
  return ` [${text.length > 12 ? text.slice(0, 8) : text}]`;
}

/** Extract module tag from event name: "app.ready" → "App", "console:renderer" → "Console" */
function eventTag(event: string): string {
  const segment = event.split(".")[0].split(":")[0];
  if (!segment) return "Log";
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

function echoToConsole(
  filePath: string,
  level: LogLevel,
  event: string,
  payload: string,
  data: Record<string, unknown>,
): void {
  if (!CONSOLE_ECHO_ENABLED) return;
  if (filePath === getConsoleLogPath() && data["source"] === "main") return;
  // HTTP logs are verbose — only echo when DevMode is ON
  if (filePath === getHttpLogPath() && !developerMode) return;
  // Renderer console info/debug is internal noise — only show warn/error (or all in DevMode)
  if (
    filePath === getConsoleLogPath() &&
    data["source"] === "renderer" &&
    !developerMode &&
    level !== "error" &&
    level !== "warn"
  )
    return;

  const kvs = formatConsolePayload(payload);
  echoKVs(level, event, kvs);
}

/**
 * Shared console output helper. Produces Halo-style logs:
 *   Single-line:  HH:MM:SS.mmm > [Module] event { key: value, key: value }
 *   Block mode:   HH:MM:SS.mmm > [Module] event {
 *                     key: value
 *                     key: value
 *                  }
 * Errors get their stack trace on indented follow-up lines.
 */
function echoKVs(
  level: LogLevel,
  event: string,
  kvs: { key: string; value: string }[],
): void {
  const stream =
    level === "error" || level === "warn" ? process.stderr : process.stdout;

  if (event === "console") {
    echoConsoleEvent(level, kvs, stream);
    return;
  }

  const prefix = formatConsolePrefix(level, event);

  if (kvs.length === 0) {
    stream.write(`${prefix} ${event}\n`);
    return;
  }

  // If the first KV is "message", lift it as the human-readable description
  let desc: string;
  let rest: typeof kvs;
  if (kvs[0].key === "message") {
    desc = kvs[0].value;
    rest = kvs.slice(1);
  } else {
    desc = event;
    rest = kvs;
  }

  if (level === "error") {
    stream.write(`${prefix} ${desc}\n`);
    for (const { key, value } of rest) {
      if (key === "stack") {
        const frames = value.split("\n");
        const topFrames = frames.slice(0, 4);
        stream.write(`  ${topFrames.join("\n  ")}\n`);
      } else {
        stream.write(`  ${key}: ${value}\n`);
      }
    }
  } else if (rest.length === 0) {
    stream.write(`${prefix} ${desc}\n`);
  } else {
    // Block mode: >4 KVs or important events (chat.*) — wrap in { }
    if (rest.length > 4 || event.startsWith("chat.")) {
      stream.write(`${prefix} ${desc} {\n`);
      for (const { key, value } of rest) {
        if (value.includes("\n")) {
          const indented = value
            .split("\n")
            .map((l: string) => `  ${l}`)
            .join("\n");
          stream.write(`  ${key}:\n${indented}\n`);
        } else {
          stream.write(`  ${key}: ${value}\n`);
        }
      }
      stream.write(`}\n`);
    } else {
      const inline = rest
        .map(({ key, value }) => `${key}: ${value}`)
        .join(", ");
      stream.write(`${prefix} ${desc} { ${inline} }\n`);
    }
  }
}

/**
 * Formatter for console events (renderer/process console.log capture).
 * Message is the primary content — displayed inline. Metadata indented.
 */
function echoConsoleEvent(
  level: LogLevel,
  kvs: { key: string; value: string }[],
  stream: NodeJS.WriteStream,
): void {
  const source = kvs.find((k) => k.key === "source")?.value ?? "?";
  const message = kvs.find((k) => k.key === "message")?.value ?? "";
  const meta = kvs.filter((k) => k.key !== "source" && k.key !== "message");

  // For console, use the source sub-tag but the overall tag is always "Console"
  const prefix = formatConsolePrefix(level, `console:${source}`);
  stream.write(`${prefix} ${message}\n`);

  if (meta.length > 0) {
    for (const { key, value } of meta) {
      stream.write(`  ${key}: ${value}\n`);
    }
  }
}

function formatConsolePrefix(level: LogLevel, event: string): string {
  const time = formatShortTime();
  const tag = eventTag(event);
  return `${time} > ${colorize(level, `[${tag}]`)}`;
}

function formatShortTime(): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const ms = String(now.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mi}:${ss}.${ms}`;
}

function formatConsolePayload(
  payload: string,
): { key: string; value: string }[] {
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    const entries = Object.entries(parsed).filter(
      ([key]) => key !== "ts" && key !== "level" && key !== "event",
    );

    // Sort: message field first, error-related fields last
    const sorted = entries.sort(([a], [b]) => {
      if (a === "message") return -1;
      if (b === "message") return 1;
      if (a === "error" || a === "name" || a === "stack") return 1;
      if (b === "error" || b === "name" || b === "stack") return -1;
      return 0;
    });

    return sorted.map(([key, value]) => ({
      key,
      // message is already a display string — don't re-format (avoids double-escaping)
      value: key === "message" ? String(value) : formatConsoleValue(value),
    }));
  } catch {
    return [{ key: "raw", value: payload }];
  }
}

function formatConsoleValue(value: unknown): string {
  if (typeof value === "string") {
    return value.includes(" ") ? JSON.stringify(value) : value;
  }
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) {
    if (value.length > 3) return `[...${value.length} items]`;
    return inspect(value, { depth: 3, breakLength: 100, compact: true });
  }
  if (typeof value === "object") {
    try {
      return inspect(value, { depth: 3, breakLength: 100, compact: false });
    } catch {
      return "[Object]";
    }
  }
  return String(value);
}

function colorize(level: LogLevel, text: string): string {
  if (!COLOR_ENABLED) return text;
  const colors: Record<LogLevel, string> = {
    debug: "\x1b[90m",
    info: "\x1b[36m",
    warn: "\x1b[33m",
    error: "\x1b[31m",
  };
  return `${colors[level]}${text}\x1b[0m`;
}

function getLogger(filePath: string, maxBytes = MAX_LOG_BYTES): Logger {
  const cacheKey = `${filePath}::${maxBytes}`;
  const existing = loggers.get(cacheKey);
  if (existing) return existing;
  const logger = new Logger(
    new JsonlFileStream(filePath, maxBytes),
    resolveLogLevel(),
  );
  loggers.set(cacheKey, logger);
  return logger;
}

class JsonlFileStream {
  constructor(
    private readonly filePath: string,
    private readonly maxBytes = MAX_LOG_BYTES,
  ) {}

  write(buffer: Buffer | string): boolean {
    const text = Buffer.isBuffer(buffer) ? buffer.toString("utf8") : buffer;
    const payload = text.replace(/^\[[^\]]+\]\s*/, "");
    mkdirSync(dirname(this.filePath), { recursive: true });
    rotateIfNeeded(this.filePath, this.maxBytes);
    appendFileSync(this.filePath, payload, "utf8");
    return true;
  }
}

function rotateIfNeeded(filePath: string, maxBytes = MAX_LOG_BYTES): void {
  if (!existsSync(filePath)) return;
  if (statSync(filePath).size < maxBytes) return;
  renameSync(
    filePath,
    `${filePath}.${new Date().toISOString().replace(/[:.]/g, "-")}.bak`,
  );
}

function resolveLogLevel(): Level {
  if (!developerMode) return Level.info;
  const value = (process.env.MARLOUES_LOG_LEVEL ?? "debug").toLowerCase();
  if (value === "trace" || value === "debug") return Level.debug;
  if (value === "info") return Level.info;
  if (value === "warn" || value === "warning") return Level.warning;
  if (value === "error") return Level.error;
  if (value === "critical") return Level.critical;
  return Level.debug;
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return { message: String(error) };
}
