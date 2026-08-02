import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/layout/GlobalSearchOverlay", () => ({
  GlobalSearchOverlay: () => null,
}));

import { WindowChrome } from "../../client/renderer/src/components/workbench/WindowChrome";

const noop = () => undefined;

function renderChrome(
  auxiliaryMode: "closed" | "open" | "primary-overlay",
  primaryOpen = false,
) {
  return renderToStaticMarkup(
    createElement(WindowChrome, {
      platform: "windows",
      primaryOpen,
      primaryPeeking: false,
      auxiliaryMode,
      isRunning: true,
      searchOpen: false,
      page: "chat",
      onPage: noop,
      onOpenSettings: noop,
      onTogglePrimary: noop,
      onNewThread: noop,
      onToggleAuxiliary: noop,
      onReturnToMain: noop,
      onToggleAuxiliaryPrimary: noop,
      onOpenSearch: noop,
      onCloseSearch: noop,
      onPrimaryPointerEnter: noop,
      onPrimaryPointerLeave: noop,
    }),
  );
}

describe("Windows workbench chrome", () => {
  it("shows the main runtime status in the standard workbench", () => {
    const markup = renderChrome("open");

    expect(markup).toContain("Codex · 正在工作");
    expect(markup).toContain("新建会话");
    expect(markup).not.toContain('aria-label="返回主视图"');
    expect(markup).not.toContain("收回辅助区至右栏");
  });

  it("replaces main-only controls in a collapsed auxiliary overlay", () => {
    const markup = renderChrome("primary-overlay");

    expect(markup).not.toContain("Codex · 正在工作");
    expect(markup).not.toContain("新建会话");
    expect(markup).toContain('aria-label="返回主视图"');
    expect(markup).toContain("收回辅助区至右栏");
    expect(markup).toContain("关闭辅助区并返回主视图");
  });

  it("keeps the expanded primary rail while the auxiliary owns the view", () => {
    const markup = renderChrome("primary-overlay", true);

    expect(markup).toContain("Marloues");
    expect(markup).not.toContain('aria-label="返回主视图"');
    expect(markup).not.toContain("Codex · 正在工作");
  });
});
