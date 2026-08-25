import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WorkflowChatHeader } from "../../../../../client/renderer/src/pages/WorkflowChatHeader";

describe("WorkflowChatHeader", () => {
  it("exposes the pinned summary as a pressed toolbar control", () => {
    const markup = renderToStaticMarkup(
      <WorkflowChatHeader
        title="会话标题"
        threadSummary={{ available: true, open: true, onToggle: vi.fn() }}
      />,
    );

    expect(markup).toContain("会话标题");
    expect(markup).toContain('data-thread-summary-toggle="true"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('data-state="open"');
    expect(markup).toContain('data-icon-contract="pinned-summary"');
  });

  it("keeps the pinned summary control visible before summary data is ready", () => {
    const markup = renderToStaticMarkup(
      <WorkflowChatHeader
        title="会话标题"
        threadSummary={{ available: false, open: false, onToggle: vi.fn() }}
      />,
    );

    expect(markup).toContain("thread-summary-toggle");
    expect(markup).toContain('data-state="closed"');
    expect(markup).toContain('aria-label="固定摘要暂不可用"');
    expect(markup).toContain("disabled");
  });
});
