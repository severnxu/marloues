import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ComposerTaskProgress } from "./ComposerTaskProgress";

describe("ComposerTaskProgress", () => {
  it("renders a standalone completed-file summary without task UI", () => {
    const markup = renderToStaticMarkup(
      <ComposerTaskProgress
        fileChangeSummary={{ filesChanged: 2, insertions: 42, deletions: 8 }}
        onFileChangeSummaryClick={vi.fn()}
      />,
    );

    expect(markup).toContain("2 个文件已更改");
    expect(markup).toContain("+42");
    expect(markup).toContain("-8");
    expect(markup).not.toContain("composer-task-progress-spinner");
    expect(markup).not.toContain("composer-task-popover");
    expect(markup).not.toContain("disabled");
  });

  it("disables a result summary that has no review target", () => {
    const markup = renderToStaticMarkup(
      <ComposerTaskProgress fileChangeSummary={{ filesChanged: 1 }} />,
    );

    expect(markup).toContain("disabled");
  });
});
