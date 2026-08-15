import { describe, expect, it } from "vitest";
import { safeOutputPath } from "../../client/main/hot-update/archive-policy";
import { validateRendererReady } from "../../client/main/hot-update/renderer-ready";
import { normalizeUpdatePreferences } from "../../client/main/hot-update/update-preferences";
import {
  HOT_UPDATE_CAPABILITY,
  HOT_UPDATE_PROTOCOL_VERSION,
} from "../../client/shared/hot-update";
import { MARLOUES_UPDATE_CONFIG } from "../../client/shared/update-config";

describe("hot-update archive boundaries", () => {
  it("accepts normal relative archive entries", () => {
    expect(safeOutputPath("C:\\updates\\staging", "assets/index.js")).toMatch(
      /assets[\\/]index\.js$/,
    );
  });

  it.each([
    "../index.html",
    "assets/../../index.html",
    "/etc/passwd",
    "C:\\Windows\\system.ini",
    "\\\\server\\share\\file",
    "assets/\0payload.js",
  ])("rejects unsafe entry %s", (entry) => {
    expect(() => safeOutputPath("C:\\updates\\staging", entry)).toThrow(
      /unsafe|escapes/i,
    );
  });
});

describe("renderer readiness handshake", () => {
  const ready = {
    uiVersion: "1.2.0",
    protocolVersion: HOT_UPDATE_PROTOCOL_VERSION,
    capabilities: [HOT_UPDATE_CAPABILITY],
  };

  it("accepts only the selected version and required protocol capability", () => {
    expect(validateRendererReady(ready, "1.2.0")).toEqual({ accepted: true });
    expect(
      validateRendererReady({ ...ready, uiVersion: "1.1.0" }, "1.2.0"),
    ).toMatchObject({
      accepted: false,
      reason: "version_mismatch",
    });
    expect(
      validateRendererReady({ ...ready, capabilities: [] }, "1.2.0"),
    ).toMatchObject({
      accepted: false,
      reason: "capability_mismatch",
    });
  });
});

describe("update preferences", () => {
  it("has safe defaults when build-time update globals are absent", () => {
    expect(MARLOUES_UPDATE_CONFIG).toMatchObject({
      buildEnv: "development",
      clientProvider: "github",
      clientUpdateUrl: "",
      hotUpdateUrl: "",
      hotUpdatePublicKeys: {},
    });
  });

  it("defaults to user-confirmed stable updates", () => {
    expect(normalizeUpdatePreferences(null)).toEqual({
      channel: "stable",
      autoCheck: true,
      autoDownload: false,
      autoApplyUi: false,
    });
  });

  it("normalizes channels, automation, and ignored versions", () => {
    expect(
      normalizeUpdatePreferences({
        channel: "nightly",
        autoCheck: false,
        autoDownload: true,
        autoApplyUi: true,
        ignoredVersion: " 1.2.0 ",
      }),
    ).toEqual({
      channel: "nightly",
      autoCheck: false,
      autoDownload: true,
      autoApplyUi: true,
      ignoredVersion: "1.2.0",
    });
    expect(normalizeUpdatePreferences({ channel: "canary" }).channel).toBe(
      "stable",
    );
  });
});
