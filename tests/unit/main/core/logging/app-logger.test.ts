import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("electron", () => ({ app: undefined }));

let home: string;
let originalHome: string | undefined;
let originalConsoleEcho: string | undefined;

async function loadLogger(): Promise<
  typeof import("../../../../../client/main/core/logging/app-logger")
> {
  vi.resetModules();
  return await import("../../../../../client/main/core/logging/app-logger");
}

beforeEach(() => {
  originalHome = process.env.MARLOUES_HOME;
  originalConsoleEcho = process.env.MARLOUES_LOG_CONSOLE;
  home = mkdtempSync(join(tmpdir(), "marloues-logger-test-"));
  process.env.MARLOUES_HOME = home;
  process.env.MARLOUES_LOG_CONSOLE = "1";
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.MARLOUES_HOME;
  else process.env.MARLOUES_HOME = originalHome;

  if (originalConsoleEcho === undefined)
    delete process.env.MARLOUES_LOG_CONSOLE;
  else process.env.MARLOUES_LOG_CONSOLE = originalConsoleEcho;

  rmSync(home, { recursive: true, force: true });
});

describe("app logger broken-pipe handling", () => {
  it("recognizes broken stream errors", async () => {
    const { isBrokenStreamError } = await loadLogger();
    expect(isBrokenStreamError(new Error("write EPIPE"))).toBe(true);
    expect(isBrokenStreamError(new Error("write EIO"))).toBe(true);
    expect(isBrokenStreamError(new Error("broken pipe"))).toBe(true);
    expect(isBrokenStreamError(new Error("Connection reset"))).toBe(false);
  });

  it("does not echo suppressed logs after console echo is disabled", async () => {
    const { disableConsoleEcho, logWarn } = await loadLogger();
    const stderrWrite = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    disableConsoleEcho("process.stderr: write EPIPE");
    logWarn("test.suppressedAfterEchoDisabled", {
      message: "write EPIPE",
    });

    expect(stderrWrite).not.toHaveBeenCalled();
    stderrWrite.mockRestore();
  });
});
