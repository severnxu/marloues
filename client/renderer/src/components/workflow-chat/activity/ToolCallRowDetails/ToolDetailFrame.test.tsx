import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ToolDetailFrame } from "./ToolDetailFrame";

describe("ToolDetailFrame", () => {
  it("renders a semantic status slot without a cancel action", () => {
    const html = renderToStaticMarkup(
      <ToolDetailFrame
        title="Tool search"
        statusKind="success"
        statusText="成功"
      >
        <div>result</div>
      </ToolDetailFrame>,
    );

    expect(html).toContain("workflow-tool-detail");
    expect(html).toContain("workflow-activity-detail-surface");
    expect(html).toContain("workflow-tool-detail-status is-success");
    expect(html).not.toContain("workflow-tool-detail-cancel");
  });

  it("exposes a real disabled cancel button while cancellation is pending", () => {
    const html = renderToStaticMarkup(
      <ToolDetailFrame
        title="Shell"
        statusKind="running"
        statusText="运行中"
        cancellable
        isCancelling
        onCancel={vi.fn()}
      >
        <div>running</div>
      </ToolDetailFrame>,
    );

    expect(html).toContain("<button");
    expect(html).toContain("workflow-tool-detail-cancel");
    expect(html).toContain("disabled");
    expect(html).toContain("正在取消");
  });
});
