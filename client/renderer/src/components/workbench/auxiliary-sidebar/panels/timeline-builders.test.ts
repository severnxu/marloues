import { describe, expect, it } from "vitest";
import type { TimelineItem } from "@shared/types";
import { buildFileChanges } from "./timeline-builders";

describe("buildFileChanges", () => {
  it("derives file statistics from a unified diff", () => {
    const timeline: TimelineItem[] = [
      {
        id: "edit-1",
        type: "tool_result",
        label: "edit",
        toolName: "edit",
        toolInput: {
          file_path: "src/WorkbenchLayout.tsx",
          diff: "--- a/file\n+++ b/file\n-old\n+new\n+second",
        },
        createdAt: 1,
      },
    ];

    expect(buildFileChanges(timeline)).toEqual([
      {
        path: "src/WorkbenchLayout.tsx",
        operation: "edit",
        operationLabel: "编辑",
        insertions: 2,
        deletions: 1,
        rawDiff: "--- a/file\n+++ b/file\n-old\n+new\n+second",
      },
    ]);
  });

  it("builds a reviewable diff from replacement input", () => {
    const timeline: TimelineItem[] = [
      {
        id: "replace-1",
        type: "tool_start",
        label: "replace",
        toolName: "replace",
        toolInput: {
          path: "tokens.css",
          old_string: "--old: 1;",
          new_string: "--new: 2;",
        },
        createdAt: 1,
      },
    ];

    expect(buildFileChanges(timeline)[0]).toMatchObject({
      insertions: 1,
      deletions: 1,
      rawDiff: "---old: 1;\n+--new: 2;",
    });
  });
});
