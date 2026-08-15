import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlatformWindow } from "./PlatformWindow";
import { KeepAliveWorkbenchView } from "./WorkbenchViewHost";
import {
  AuxiliaryLayoutPlaceholder,
  AuxiliarySidebarShell,
  PrimarySidebarShell,
} from "./WorkbenchRegions";

describe("workbench region contracts", () => {
  it("keeps the closed primary sidebar mounted but inaccessible", () => {
    const markup = renderToStaticMarkup(
      <PrimarySidebarShell open={false} peeking={false} width={275}>
        <span>primary-state</span>
      </PrimarySidebarShell>,
    );

    expect(markup).toContain('data-state="closed"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("primary-state");
  });

  it("keeps the closed auxiliary tree mounted", () => {
    const markup = renderToStaticMarkup(
      <AuxiliarySidebarShell mode="closed" width={319}>
        <span>auxiliary-state</span>
      </AuxiliarySidebarShell>,
    );

    expect(markup).toContain('data-mode="closed"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("auxiliary-state");
  });

  it("reserves the standard auxiliary track under primary overlay", () => {
    const markup = renderToStaticMarkup(
      <AuxiliaryLayoutPlaceholder width={319} />,
    );

    expect(markup).toContain('class="auxiliary-layout-placeholder"');
    expect(markup).toContain("width:319px");
  });

  it("keeps inactive page content mounted", () => {
    const markup = renderToStaticMarkup(
      <KeepAliveWorkbenchView name="chat" active={false}>
        <span>chat-state</span>
      </KeepAliveWorkbenchView>,
    );

    expect(markup).toContain('data-view="chat"');
    expect(markup).toContain("hidden");
    expect(markup).toContain("chat-state");
  });

  it("does not remove product chrome in acceptance review mode", () => {
    const markup = renderToStaticMarkup(
      <PlatformWindow
        platform="macos"
        page="chat"
        primaryOpen
        primaryPeeking={false}
        primaryTransition="idle"
        auxiliaryMode="closed"
        reviewAcceptance
      >
        <header>product-chrome</header>
      </PlatformWindow>,
    );

    expect(markup).toContain('data-review="acceptance"');
    expect(markup).toContain("product-chrome");
  });
});
