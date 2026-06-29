import { logQuiet } from "../core/logging/app-logger";

/**
 * Gateway logger — delegates to the unified app-logger.
 * File-only (no console echo) to avoid polluting the terminal.
 * Kept as a thin wrapper for backward compatibility.
 */
export function log(...args: unknown[]): void {
  const message = args
    .map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a)))
    .join(" ");
  logQuiet("Gateway.log", { message });
}
