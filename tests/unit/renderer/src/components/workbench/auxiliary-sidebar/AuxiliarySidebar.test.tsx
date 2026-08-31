import { renderToStaticMarkup } from "react-dom/server";
import { FileText } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { AUXILIARY_VIEW_OPTIONS } from "../../../../../../../client/renderer/src/components/workbench/auxiliary-sidebar/catalog";
import { AuxiliaryHeader } from "../../../../../../../client/renderer/src/components/workbench/auxiliary-sidebar/AuxiliaryHeader";
import {
  BrowserPanel,
  browserNavigationErrorMessage,
} from "../../../../../../../client/renderer/src/components/workbench/auxiliary-sidebar/panels/BrowserPanel";
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

  it("marks the auxiliary primary action pressed in primary mode", () => {
    const markup = renderToStaticMarkup(
      <AuxiliaryHeader
        open
        primary
        tabs={[]}
        availableViews={AUXILIARY_VIEW_OPTIONS}
        onActivate={vi.fn()}
        onCloseTab={vi.fn()}
        onMoveTab={vi.fn()}
        onOpenView={vi.fn()}
        onTogglePrimary={vi.fn()}
      />,
    );

    expect(markup).toContain("inspector-head-action is-active");
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain("收回辅助区至右栏");
  });

  it("renders the browser new-tab presentation before navigation", () => {
    const markup = renderToStaticMarkup(
      <BrowserPanel pageId="browser-page-1" />,
    );

    expect(markup).toContain("开始浏览");
    expect(markup).toContain("输入 URL 以打开页面");
    expect(markup).toContain('placeholder="输入 URL"');
    expect(markup).not.toContain("输入网址或搜索");
    expect(markup).toContain('aria-label="更多"');
    expect(markup).not.toContain('aria-label="进入批注模式"');
  });

  it("formats native browser load failures for the visible error state", () => {
    expect(
      browserNavigationErrorMessage(
        "http://127.0.0.1:4173/path",
        "ERR_CONNECTION_REFUSED",
      ),
    ).toBe("127.0.0.1 拒绝建立连接");
    expect(
      browserNavigationErrorMessage(
        "https://missing.example/path",
        "ERR_NAME_NOT_RESOLVED",
      ),
    ).toBe("找不到 missing.example 的服务器 IP 地址");
  });

  it("exposes the browser view type for primary tab sizing", () => {
    const markup = renderToStaticMarkup(
      <AuxiliaryHeader
        open
        primary
        tabs={[
          {
            id: "browser-1",
            type: "browser",
            label: "新标签页",
            icon: FileText,
            selected: true,
          },
        ]}
        availableViews={AUXILIARY_VIEW_OPTIONS}
        onActivate={vi.fn()}
        onCloseTab={vi.fn()}
        onMoveTab={vi.fn()}
        onOpenView={vi.fn()}
        onTogglePrimary={vi.fn()}
      />,
    );

    expect(markup).toContain('data-view-type="browser"');
    expect(markup).toContain("新标签页");
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
