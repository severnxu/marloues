import { describe, expect, it } from "vitest";
import {
  activityActiveItem,
  activityGroupDisplayLabel,
} from "../../../../../../../client/renderer/src/components/workflow-chat/activity/activity-presentation-contract";
import type { WorkflowActivitySummary } from "../../../../../../../client/renderer/src/components/workflow-chat/turns/turn-layout";

const emptySummary: WorkflowActivitySummary = {
  commandCount: 0,
  imageCount: 0,
  exploredFileCount: 0,
  fileCreateCount: 0,
  fileEditCount: 0,
  fileDeleteCount: 0,
  listCount: 0,
  searchCount: 0,
  toolCount: 0,
  webSearchCount: 0,
  waitingPermissionRequestCount: 0,
  approvedPermissionRequestCount: 0,
  deniedPermissionRequestCount: 0,
  runningCount: 1,
  runningCommandCount: 1,
  runningExploredFileCount: 0,
  runningFileCreateCount: 0,
  runningFileEditCount: 0,
  runningFileDeleteCount: 0,
  runningFolderCreateCount: 0,
  runningListCount: 0,
  runningSearchCount: 0,
  runningToolCount: 0,
  runningWebSearchCount: 0,
  runningWrittenLineCount: 0,
  addedLineCount: 0,
  removedLineCount: 0,
  runningAddedLineCount: 0,
  runningRemovedLineCount: 0,
};

describe("activity presentation contract", () => {
  it("summarizes the latest active item rather than the first row", () => {
    const items = [
      {
        type: "commandExecution" as const,
        id: "a",
        command: "old",
        status: "completed",
      },
      {
        type: "commandExecution" as const,
        id: "b",
        command: "latest",
        status: "running",
      },
    ];
    expect(activityActiveItem(items)?.id).toBe("b");
    expect(
      activityGroupDisplayLabel(emptySummary, items, "已运行 2 条命令"),
    ).toBe("正在运行 latest");
  });
});
