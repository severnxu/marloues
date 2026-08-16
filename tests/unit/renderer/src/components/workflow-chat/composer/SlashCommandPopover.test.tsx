import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SlashCommandPopover } from "../../../../../../../client/renderer/src/components/workflow-chat/composer/SlashCommandPopover";

describe("SlashCommandPopover", () => {
  it("renders an accessible semantic command list without shortcut help", () => {
    const html = renderToStaticMarkup(
      <SlashCommandPopover
        items={[
          {
            id: "compact",
            command: "/compact",
            label: "压缩上下文",
            description: "压缩当前上下文",
            category: "builtin",
          },
          {
            id: "review",
            command: "/review",
            label: "Review",
            argumentHint: "[path]",
            category: "skill",
          },
        ]}
        selectedIndex={0}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        popoverRef={createRef<HTMLDivElement>()}
      />,
    );

    expect(html).toContain('role="listbox"');
    expect(html).toContain('role="option"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("slash-command-item is-selected");
    expect(html).not.toContain("导航");
    expect(html).not.toContain("Esc 关闭");
  });
});
