import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WorkflowChatHeader } from "./WorkflowChatHeader";

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
    expect(markup).toContain('data-icon-contract="pinned-summary"');
  });
});
