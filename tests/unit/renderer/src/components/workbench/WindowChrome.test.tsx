import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WindowChrome } from "../../../../../../client/renderer/src/components/workbench/WindowChrome";

const noop = vi.fn();

describe("WindowChrome", () => {
  it("marks the auxiliary toggle pressed when the right sidebar is open", () => {
    const markup = renderToStaticMarkup(
      <WindowChrome
        sidebarOpen
        page="chat"
        isDark={false}
        themeMode="light"
        onPage={noop}
        globalSearchOpen={false}
        onOpenSearch={noop}
        onToggleSidebar={noop}
        onToggleTheme={noop}
        auxiliaryOpen
        onToggleAuxiliary={noop}
      />,
    );

    expect(markup).toContain("thread-inspector-toggle");
    expect(markup).toContain("is-active");
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('title="收起侧栏"');
  });

  it("orders the expanded auxiliary action slot before pinned summary and sidebar toggle", () => {
    const markup = renderToStaticMarkup(
      <WindowChrome
        sidebarOpen
        page="chat"
        isDark={false}
        themeMode="light"
        onPage={noop}
        globalSearchOpen={false}
        onOpenSearch={noop}
        onToggleSidebar={noop}
        onToggleTheme={noop}
        auxiliaryOpen
        onToggleAuxiliary={noop}
      />,
    );

    expect(markup.indexOf("auxiliary-primary-titlebar-slot")).toBeGreaterThan(
      -1,
    );
    expect(markup.indexOf("thread-summary-titlebar-slot")).toBeGreaterThan(
      markup.indexOf("auxiliary-primary-titlebar-slot"),
    );
    expect(markup.indexOf("thread-inspector-toggle")).toBeGreaterThan(
      markup.indexOf("thread-summary-titlebar-slot"),
    );
  });
});
