import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ContextUsageRing } from "../../../../../../../client/renderer/src/components/workflow-chat/composer/ContextUsageRing";

describe("ContextUsageRing", () => {
  it("uses the real model window and shows localized token details without cost or model rows", () => {
    const snapshot = {
      totalTokens: 25_281,
      maxTokens: 850_000,
      percentage: 2.9742,
      model: "deepseek-v4-flash",
    };
    const usage = {
      inputTokens: 65,
      outputTokens: 64,
      cacheReadInputTokens: 25_216,
      cacheCreationInputTokens: 0,
      modelContextWindowTokens: 1_000_000,
      costUSD: 0.42,
    };

    expect(
      usage.inputTokens +
        usage.cacheReadInputTokens +
        usage.cacheCreationInputTokens,
    ).toBe(snapshot.totalTokens);

    const html = renderToStaticMarkup(
      <ContextUsageRing snapshot={snapshot} usage={usage} />,
    );

    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-label="上下文用量 3%"');
    expect(html).toContain('aria-valuenow="3"');
    expect(html).toContain("25.3K / 1M");
    expect(html).toContain("Token 用量(已用上下文)");
    expect(html).toContain(">输入<");
    expect(html).toContain(">65<");
    expect(html).toContain(">输出<");
    expect(html).toContain(">64<");
    expect(html).toContain(">缓存读取<");
    expect(html).toContain(">25.2K<");
    expect(html).toContain(">缓存写入<");
    expect(html).toContain(">0<");
    expect(html).not.toContain("85万");
    expect(html).not.toContain("deepseek-v4-flash");
    expect(html).not.toContain("Cost");
    expect(html).not.toContain("0.42");
  });

  it("shows unknown output as a dash instead of a false zero", () => {
    const html = renderToStaticMarkup(
      <ContextUsageRing
        snapshot={{ totalTokens: 100, maxTokens: 1_000 }}
        usage={{ inputTokens: 100, outputTokens: undefined }}
      />,
    );

    expect(html).toContain(">输出<");
    expect(html).toContain(">—<");
  });
});
