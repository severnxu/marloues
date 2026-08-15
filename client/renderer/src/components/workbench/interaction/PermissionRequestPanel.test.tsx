import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PermissionRequestPanel } from "./PermissionRequestPanel";

describe("PermissionRequestPanel", () => {
  it("renders the reviewed action order and accessible dialog contract", () => {
    const reason = JSON.stringify({
      input: { command: "npm run test" },
      description: "此命令将在当前工作区执行。请确认后继续任务。",
    });
    const markup = renderToStaticMarkup(
      <PermissionRequestPanel
        request={{
          id: "request-bash",
          toolName: "Bash",
          reason,
          inputSummary: reason,
          options: {
            allowOnce: true,
            allowSession: true,
            denyWithReason: true,
          },
        }}
        onRespond={vi.fn()}
      />,
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain("npm run test");
    expect(markup).toContain('class="permission-allow-primary"');
    const labels = ["拒绝", "允许此任务", "允许一次"];
    labels.reduce((previousIndex, label) => {
      const index = markup.indexOf(label);
      expect(index).toBeGreaterThan(previousIndex);
      return index;
    }, -1);
  });

  it("keeps a safe one-time default for legacy requests", () => {
    const markup = renderToStaticMarkup(
      <PermissionRequestPanel
        request={{
          id: "legacy-request",
          toolName: "CustomTool",
          reason: "需要确认",
          inputSummary: "需要确认",
        }}
        onRespond={vi.fn()}
      />,
    );

    expect(markup).toContain("允许一次");
    expect(markup).not.toContain("允许此任务");
  });
});
