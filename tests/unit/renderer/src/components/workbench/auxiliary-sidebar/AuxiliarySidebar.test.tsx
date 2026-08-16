import { renderToStaticMarkup } from "react-dom/server";
import { FileText } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { AUXILIARY_VIEW_OPTIONS } from "../../../../../../../client/renderer/src/components/workbench/auxiliary-sidebar/catalog";
import { AuxiliaryHeader } from "../../../../../../../client/renderer/src/components/workbench/auxiliary-sidebar/AuxiliaryHeader";
import {
  AuxiliaryEmptyLauncher,
  AuxiliaryViewPanel,
} from "../../../../../../../client/renderer/src/components/workbench/auxiliary-sidebar/AuxiliaryViewHost";

describe("auxiliary sidebar components", () => {
  it("keeps only the primary action in an empty header", () => {
    const markup = renderToStaticMarkup(
      <AuxiliaryHeader
        open
        primary={false}
        tabs={[]}
        availableViews={AUXILIARY_VIEW_OPTIONS}
        onActivate={vi.fn()}
        onCloseTab={vi.fn()}
        onMoveTab={vi.fn()}
        onOpenView={vi.fn()}
        onTogglePrimary={vi.fn()}
      />,
    );

    expect(markup).not.toContain('role="tablist"');
    expect(markup).not.toContain("添加辅助视图");
    expect(markup).toContain("展开辅助区至主视图区");
  });

  it("separates tab selection from the close command", () => {
    const markup = renderToStaticMarkup(
      <AuxiliaryHeader
        open
        primary={false}
        tabs={[
          {
            id: "outputs-1",
            label: "产出",
            icon: FileText,
            selected: true,
          },
        ]}
        availableViews={AUXILIARY_VIEW_OPTIONS.slice(1)}
        onActivate={vi.fn()}
        onCloseTab={vi.fn()}
        onMoveTab={vi.fn()}
        onOpenView={vi.fn()}
        onTogglePrimary={vi.fn()}
      />,
    );

    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('role="tab"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain("关闭产出视图");
    expect(markup).toContain("添加辅助视图");
  });

  it("disables the add command when every static view is open", () => {
    const markup = renderToStaticMarkup(
      <AuxiliaryHeader
        open
        primary={false}
        tabs={AUXILIARY_VIEW_OPTIONS.map((view) => ({
          id: `${view.type}-1`,
          label: view.label,
          icon: view.icon,
          selected: view.type === "outputs",
        }))}
        availableViews={[]}
        onActivate={vi.fn()}
        onCloseTab={vi.fn()}
        onMoveTab={vi.fn()}
        onOpenView={vi.fn()}
        onTogglePrimary={vi.fn()}
      />,
    );

    expect(markup).toMatch(
      /<button[^>]+disabled=""[^>]+aria-label="添加辅助视图"/,
    );
  });

  it("keeps an inactive view mounted but hidden", () => {
    const markup = renderToStaticMarkup(
      <AuxiliaryViewPanel tabId="outputs-1" active={false}>
        <span>preserved-output-state</span>
      </AuxiliaryViewPanel>,
    );

    expect(markup).toContain('role="tabpanel"');
    expect(markup).toContain("hidden");
    expect(markup).toContain("preserved-output-state");
  });

  it("renders the four lightweight launcher rows", () => {
    const markup = renderToStaticMarkup(
      <AuxiliaryEmptyLauncher
        options={AUXILIARY_VIEW_OPTIONS}
        onOpenView={vi.fn()}
      />,
    );

    expect(markup).toContain('aria-label="选择辅助视图"');
    for (const label of ["产出", "文件", "记忆", "审核"]) {
      expect(markup).toContain(label);
    }
    expect(markup).not.toContain("选择要查看的信息面板");
  });
});
