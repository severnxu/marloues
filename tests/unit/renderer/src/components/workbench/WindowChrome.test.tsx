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
    expect(markup).toContain('title="收起右侧辅助区"');
  });

  it("places the Windows primary auxiliary action before the pinned summary and sidebar toggle", () => {
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
        onReturnToMain={noop}
        auxiliaryMode="primary-overlay"
      />,
    );

    expect(markup).not.toContain("auxiliary-primary-titlebar-slot");
    expect(markup.indexOf("windows-auxiliary-primary-action")).toBeGreaterThan(
      -1,
    );
    expect(markup.indexOf("thread-summary-titlebar-slot")).toBeGreaterThan(
      markup.indexOf("windows-auxiliary-primary-action"),
    );
    expect(markup.indexOf("thread-inspector-toggle")).toBeGreaterThan(
      markup.indexOf("thread-summary-titlebar-slot"),
    );
    expect(markup).toContain('aria-label="收回辅助区至右栏"');
    expect(markup).toContain('aria-label="关闭辅助区并返回主视图"');
  });

  it("keeps the macOS primary action out of the global title bar", () => {
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
        onReturnToMain={noop}
        auxiliaryMode="primary-overlay"
        isMacOS
      />,
    );

    expect(markup).not.toContain("windows-auxiliary-primary-action");
  });
});
