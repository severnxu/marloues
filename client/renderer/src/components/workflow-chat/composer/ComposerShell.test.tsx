import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WorkflowComposerShell } from "./ComposerShell";

describe("WorkflowComposerShell permission branch", () => {
  it("renders the permission panel instead of the complete input stack", () => {
    const markup = renderToStaticMarkup(
      <WorkflowComposerShell
        input="draft that must be preserved"
        isGenerating={false}
        selectedProvider={null}
        onInputChange={vi.fn()}
        onKeyDown={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
        permissionPanel={<section data-testid="permission-panel">权限</section>}
      />,
    );

    expect(markup).toContain('class="composer-permission-slot"');
    expect(markup).toContain('data-testid="permission-panel"');
    expect(markup).not.toContain("composer-steer-stack");
    expect(markup).not.toContain("<form");
    expect(markup).not.toContain("<textarea");
  });

  it("uses the Codex add-context and placeholder contract", () => {
    const markup = renderToStaticMarkup(
      <WorkflowComposerShell
        input=""
        isGenerating={false}
        selectedProvider={null}
        onInputChange={vi.fn()}
        onKeyDown={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    expect(markup).toContain('placeholder="随心输入"');
    expect(markup).toContain('data-composer-navigation-target="add-context"');
    expect(markup).toContain('aria-label="添加文件及更多内容"');
    expect(markup).toContain('data-icon-contract="add-context"');
  });
});
