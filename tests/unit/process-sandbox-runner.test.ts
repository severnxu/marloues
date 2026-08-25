import { describe, expect, it } from "vitest";
import {
  codexSandboxArgs,
  sanitizeSandboxEnvironment,
} from "../../client/main/core/security/process-sandbox-runner";

describe("CodexProcessSandboxRunner", () => {
  it("maps each managed profile to an explicit Codex sandbox profile", () => {
    expect(codexSandboxArgs("read-only")).toContain(":read-only");
    expect(codexSandboxArgs("workspace-write")).toContain("marloues-process");
    expect(codexSandboxArgs("workspace-write-network")).toEqual(
      expect.arrayContaining([
        "marloues-process-network",
        "permissions.marloues-process-network.network.enabled=true",
      ]),
    );
    expect(codexSandboxArgs("workspace-write").join(" ")).toContain(
      '".git"="read"',
    );
    expect(codexSandboxArgs("danger-full-access")).toEqual([]);
  });

  it("strips credentials and process-injection variables", () => {
    const sanitized = sanitizeSandboxEnvironment({
      Path: "safe-path",
      HOME: "safe-home",
      ANTHROPIC_API_KEY: "secret-value",
      CUSTOM_TOKEN: "secret-value",
      HTTPS_PROXY: "http://127.0.0.1:7890",
      NODE_OPTIONS: "--require injected.js",
      CODEX_HOME: "untrusted-home",
    });

    expect(sanitized).toEqual({
      Path: "safe-path",
      HOME: "safe-home",
      HTTPS_PROXY: "http://127.0.0.1:7890",
    });
    expect(
      sanitizeSandboxEnvironment(
        { HTTPS_PROXY: "http://127.0.0.1:7890", HOME: "safe-home" },
        "deny",
      ),
    ).toEqual({ HOME: "safe-home" });
  });
});
