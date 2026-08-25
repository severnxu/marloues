import { describe, expect, it } from "vitest";
import {
  applySecurityMode,
  resolveEffectiveSecurityPolicy,
} from "../../client/shared/security-policy";
import type { AgentSettings } from "../../client/shared/types";

const settings = {
  workMode: "execute",
  securityMode: "request",
  permissionMode: "default",
  sandboxEnabled: true,
  sandboxMode: "workspace-write",
} as AgentSettings;

describe("security policy", () => {
  it("makes plan mode read-only regardless of selected mode", () => {
    const policy = resolveEffectiveSecurityPolicy({
      ...settings,
      workMode: "plan",
      securityMode: "full-access",
    });
    expect(policy.permissionMode).toBe("plan");
    expect(policy.sandboxMode).toBe("read-only");
  });

  it("maps auto review to model review without disabling the sandbox", () => {
    const policy = resolveEffectiveSecurityPolicy({
      ...settings,
      securityMode: "auto-review",
    });
    expect(policy.approvalStrategy).toBe("reviewer");
    expect(policy.sandboxMode).toBe("workspace-write");
  });

  it("maps full access atomically to bypass and danger-full-access", () => {
    const updated = applySecurityMode(settings, "full-access");
    expect(updated.permissionMode).toBe("bypassPermissions");
    expect(updated.sandboxEnabled).toBe(false);
    expect(updated.sandboxMode).toBe("danger-full-access");
  });
});
