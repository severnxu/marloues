import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WORKFLOW_READ_THREAD_SCHEMA_VERSION } from "../../client/shared/workflow-read-thread-contract";
import { InteractionDock } from "../../client/renderer/src/components/workbench/interaction/InteractionDock";
import { taskResultSummaryFromThread } from "../../client/renderer/src/components/workbench/interaction/task-result";

describe("workbench interaction result", () => {
  it("summarizes unique files and changed diff lines from the newest completed result", () => {
    const summary = taskResultSummaryFromThread({
      schemaVersion: WORKFLOW_READ_THREAD_SCHEMA_VERSION,
      thread: {
        id: "thread",
        title: "",
        preview: "",
        status: { type: "idle" },
      },
      page: {
        order: "newest_first",
        limit: 20,
        nextCursor: null,
        hasMore: false,
      },
      turns: [
        {
          id: "turn",
          status: "completed",
          error: null,
          items: [
            {
              type: "fileChange",
              id: "changes",
              status: "completed",
              changes: [
                {
                  path: "src/a.ts",
                  kind: "edit",
                  diff: {
                    text: "--- a\n+++ b\n-old\n+new\n+next",
                    truncated: false,
                  },
                },
                {
                  path: "src/b.ts",
                  kind: "create",
                  diff: { text: "+line", truncated: false },
                },
              ],
            },
          ],
        },
      ],
    });

    expect(summary).toEqual({ fileCount: 2, additions: 3, deletions: 1 });
  });

  it("does not surface an in-progress result as completed", () => {
    expect(
      taskResultSummaryFromThread({
        schemaVersion: WORKFLOW_READ_THREAD_SCHEMA_VERSION,
        thread: {
          id: "thread",
          title: "",
          preview: "",
          status: { type: "active" },
        },
        page: {
          order: "newest_first",
          limit: 20,
          nextCursor: null,
          hasMore: false,
        },
        turns: [{ id: "turn", status: "running", error: null, items: [] }],
      }),
    ).toBeNull();
  });

  it("renders permission requests as a mutually exclusive dock branch", () => {
    const markup = renderToStaticMarkup(
      createElement(InteractionDock, {
        permissionPanel: createElement("div", {
          className: "permission-proof",
        }),
        resultSummary: { fileCount: 2, additions: 4, deletions: 1 },
        steers: [{ id: "steer-1", text: "keep going", createdAt: 1 }],
        onGuideSteer: () => undefined,
        onEditSteer: () => undefined,
        onRemoveSteer: () => undefined,
        onReorderSteer: () => undefined,
        children: createElement("div", { className: "composer-proof" }),
      }),
    );

    expect(markup).toContain("permission-interaction-stack");
    expect(markup).toContain("permission-proof");
    expect(markup).not.toContain("input-interaction-stack");
    expect(markup).not.toContain("composer-proof");
    expect(markup).not.toContain("steer-row");
    expect(markup).not.toContain("task-result-summary");
  });

  it("keeps multiple steers in the input branch above the composer", () => {
    const markup = renderToStaticMarkup(
      createElement(InteractionDock, {
        resultSummary: null,
        steers: [
          { id: "steer-1", text: "first", createdAt: 1 },
          { id: "steer-2", text: "second", createdAt: 2 },
        ],
        onGuideSteer: () => undefined,
        onEditSteer: () => undefined,
        onRemoveSteer: () => undefined,
        onReorderSteer: () => undefined,
        children: createElement("div", { className: "composer-proof" }),
      }),
    );

    expect(markup).toContain("input-interaction-stack");
    expect(markup).toContain("composer-proof");
    expect(markup.match(/steer-row/g)).toHaveLength(2);
    expect(markup).not.toContain("permission-interaction-stack");
  });
});
