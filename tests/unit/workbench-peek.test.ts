import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlatformWindow } from "@/components/workbench/PlatformWindow";
import { PrimarySidebarShell } from "@/components/workbench/WorkbenchRegions";

describe("primary sidebar Peek layout contract", () => {
  it("keeps the collapsed shell width stable while only changing Peek state", () => {
    const renderShell = (peeking: boolean) =>
      renderToStaticMarkup(
        createElement(PrimarySidebarShell, {
          width: 275,
          open: false,
          peeking,
          onPointerEnter: () => undefined,
          onPointerLeave: () => undefined,
          children: createElement("span", null, "sidebar"),
        }),
      );

    const collapsed = renderShell(false);
    const peek = renderShell(true);

    expect(collapsed).toContain("primary-sidebar-shell closed");
    expect(collapsed).toContain('style="width:275px"');
    expect(collapsed).toContain('aria-hidden="true"');
    expect(peek).toContain("primary-sidebar-shell closed is-peeking");
    expect(peek).toContain('style="width:275px"');
    expect(peek).toContain('aria-hidden="false"');
  });

  it("does not promote Peek to the expanded window-layout state", () => {
    const markup = renderToStaticMarkup(
      createElement(PlatformWindow, {
        platform: "windows",
        primaryOpen: false,
        primaryPeeking: true,
        auxiliaryMode: "open",
        children: createElement("span", null, "workspace"),
      }),
    );

    expect(markup).toContain("primary-collapsed");
    expect(markup).toContain("primary-peeking");
    expect(markup).not.toContain("primary-expanded");
  });
});
