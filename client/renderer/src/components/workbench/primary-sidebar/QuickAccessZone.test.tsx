import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { QuickAccessZone } from "./QuickAccessZone";

describe("QuickAccessZone", () => {
  it("renders the frozen entry order without global search", () => {
    const markup = renderToStaticMarkup(
      <QuickAccessZone
        page="chat"
        isMacOS
        onNewConversation={vi.fn()}
        onPage={vi.fn()}
      />,
    );

    const labels = ["新建会话", "定时任务", "插件", "会话回放"];
    labels.reduce((previousIndex, label) => {
      const index = markup.indexOf(label);
      expect(index).toBeGreaterThan(previousIndex);
      return index;
    }, -1);
    expect(markup).not.toContain("搜索");
    expect(markup).toContain("⌘N");
  });

  it("marks the visible quick page as current", () => {
    const markup = renderToStaticMarkup(
      <QuickAccessZone
        page="plugins"
        isMacOS={false}
        onNewConversation={vi.fn()}
        onPage={vi.fn()}
      />,
    );

    expect(markup).toContain('data-quick-access="plugins"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain("Ctrl+N");
  });

  it("can hide replay without leaving an empty slot", () => {
    const markup = renderToStaticMarkup(
      <QuickAccessZone
        page="chat"
        isMacOS={false}
        showReplay={false}
        onNewConversation={vi.fn()}
        onPage={vi.fn()}
      />,
    );

    expect(markup).not.toContain("会话回放");
    expect(markup).not.toContain('data-quick-access="replay"');
  });
});
