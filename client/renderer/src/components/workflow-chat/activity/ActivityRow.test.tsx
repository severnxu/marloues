import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FileText } from "lucide-react";
import { WorkflowActivityRow } from "./ActivityRow";

describe("WorkflowActivityRow", () => {
  it("renders the design row columns and exposes expansion state", () => {
    const html = renderToStaticMarkup(
      <WorkflowActivityRow
        activityKind="fileChange"
        icon={<FileText />}
        label="已编辑文件"
        meta="src/Workbench.tsx"
        detail={<pre>+ auxiliary</pre>}
        open
        onToggle={vi.fn()}
      />,
    );

    expect(html).toContain('data-activity-kind="fileChange"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('class="workflow-activity-row-icon');
    expect(html).toContain('class="workflow-activity-row-label"');
    expect(html).toContain('class="workflow-activity-row-meta"');
    expect(html).toContain('class="workflow-activity-detail"');
    expect(html).toContain("src/Workbench.tsx");
  });

  it("uses static row markup when there is no action", () => {
    const html = renderToStaticMarkup(
      <WorkflowActivityRow
        activityKind="contextCompaction"
        icon={<FileText />}
        label="上下文已压缩"
      />,
    );

    expect(html).toContain('class="workflow-activity-row-button is-static"');
    expect(html).not.toContain("<button");
    expect(html).not.toContain("aria-expanded");
  });
});
