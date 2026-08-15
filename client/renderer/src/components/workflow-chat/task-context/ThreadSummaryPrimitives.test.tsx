import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ThreadSummaryExpandableList,
  ThreadSummarySection,
} from "./ThreadSummaryPrimitives";

describe("thread summary source contract", () => {
  it("renders an accessible collapsible section header", () => {
    const markup = renderToStaticMarkup(
      <ThreadSummarySection
        sectionKey="sources"
        sessionId="session-1"
        title="来源"
        count={2}
      >
        <span>正文</span>
      </ThreadSummarySection>,
    );

    expect(markup).toContain('data-section-key="sources"');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain("正文");
  });

  it("shows six items initially and exposes the source-derived reveal step", () => {
    const items = Array.from({ length: 9 }, (_, index) => `item-${index + 1}`);
    const markup = renderToStaticMarkup(
      <ThreadSummaryExpandableList
        items={items}
        scopeKey="session-1:tasks"
        ariaLabel="任务"
        getKey={(item) => item}
        renderItem={(item) => <span>{item}</span>}
      />,
    );

    expect(markup).toContain("item-6");
    expect(markup).not.toContain("item-7");
    expect(markup).toContain("再显示 3 项");
  });
});
