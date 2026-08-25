import { describe, expect, it } from "vitest";
import { buildProviderEndpointUrl } from "../../client/main/core/config/provider-endpoint-url";

describe("provider endpoint URL composition", () => {
  it("adds the canonical API version to an origin Base URL", () => {
    expect(
      buildProviderEndpointUrl(
        "https://api.deepseek.com",
        "/v1/chat/completions",
      ),
    ).toBe("https://api.deepseek.com/v1/chat/completions");
  });

  it("does not duplicate a version already present in the Base URL", () => {
    expect(
      buildProviderEndpointUrl(
        "https://api.minimaxi.com/v1",
        "/v1/chat/completions",
      ),
    ).toBe("https://api.minimaxi.com/v1/chat/completions");
    expect(
      buildProviderEndpointUrl(
        "https://open.bigmodel.cn/api/coding/paas/v4",
        "/v1/chat/completions",
      ),
    ).toBe("https://open.bigmodel.cn/api/coding/paas/v4/chat/completions");
  });

  it("keeps non-version provider prefixes before the canonical path", () => {
    expect(
      buildProviderEndpointUrl(
        "https://api.deepseek.com/anthropic",
        "/v1/messages",
      ),
    ).toBe("https://api.deepseek.com/anthropic/v1/messages");
  });
});
