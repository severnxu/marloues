import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { QuickAccessZone } from "./QuickAccessZone";

describe("QuickAccessZone", () => {
  it("renders the new conversation entry without dead quick pages", () => {
    const markup = renderToStaticMarkup(
      <QuickAccessZone isMacOS onNewConversation={vi.fn()} />,
    );

    expect(markup).toContain("新建会话");
    expect(markup).toContain("⌘N");
    expect(markup).not.toContain("定时任务");
    expect(markup).not.toContain("插件");
    expect(markup).not.toContain("会话回放");
  });

  it("uses the windows shortcut label on non-macOS", () => {
    const markup = renderToStaticMarkup(
      <QuickAccessZone isMacOS={false} onNewConversation={vi.fn()} />,
    );

    expect(markup).toContain("Ctrl+N");
  });
});
