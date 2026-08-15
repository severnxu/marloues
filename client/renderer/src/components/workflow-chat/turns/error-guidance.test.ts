import { describe, expect, it } from "vitest";
import { classifyError, splitErrorPrimary } from "./error-guidance";

describe("error guidance", () => {
  it("classifies quota errors before generic provider failures", () => {
    const guidance = classifyError("2056 usage limit exceeded");

    expect(guidance.title).toBe("Token Plan 不可用");
    expect(guidance.actions).toHaveLength(3);
  });

  it("includes runtime guidance for invalid setting sources", () => {
    const guidance = classifyError(
      "Process exited with code 1: invalid setting source",
    );

    expect(guidance.title).toBe("Agent 启动失败");
    expect(guidance.toolHint).toContain("runtime smoke test");
  });

  it("keeps the first paragraph as the primary error", () => {
    expect(splitErrorPrimary("Primary failure\n\nStack details")).toBe(
      "Primary failure",
    );
  });
});
