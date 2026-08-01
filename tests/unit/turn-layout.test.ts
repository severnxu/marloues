import { describe, it, expect } from "vitest";
import { workflowActivitySummaryLabel } from "../../client/renderer/src/components/workflow-chat/turn-layout";
import {
  workflowTurnStateKey,
  workflowTurnIsCompleted,
  workflowTurnDefaultCollapsed,
} from "../../client/renderer/src/components/workflow-chat/turn-collapse-rules";
import type { WorkflowActivitySummary } from "../../client/renderer/src/components/workflow-chat/turn-layout";

function zeroSummary(): WorkflowActivitySummary {
  return {
    commandCount: 0,
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
    runningCount: 0,
    runningCommandCount: 0,
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
}

describe("workflow-chat turn layout", () => {
  it("labels an idle turn with no activity as empty", () => {
    expect(workflowActivitySummaryLabel(zeroSummary())).toBe("");
  });

  it("labels running commands", () => {
    expect(workflowActivitySummaryLabel({ ...zeroSummary(), runningCommandCount: 2 })).toBe("正在运行 2 条命令");
  });

  it("labels completed file reads", () => {
    expect(workflowActivitySummaryLabel({ ...zeroSummary(), exploredFileCount: 3 })).toBe("已读取 3 个文件");
  });

  it("combines running and completed parts", () => {
    const label = workflowActivitySummaryLabel({ ...zeroSummary(), runningCommandCount: 1, exploredFileCount: 2 });
    expect(label).toContain("正在运行 1 条命令");
    expect(label).toContain("已读取 2 个文件");
  });

  it("labels permission requests", () => {
    expect(workflowActivitySummaryLabel({ ...zeroSummary(), waitingPermissionRequestCount: 1 })).toBe("等待批准 1 个请求");
  });

  it("turnStateKey composes scope and message id", () => {
    expect(workflowTurnStateKey("chat", "msg-1")).toBe("chat:msg-1");
  });

  it("turn is completed when status or activity says so", () => {
    expect(workflowTurnIsCompleted({ status: "completed", activity: [] })).toBe(true);
    expect(workflowTurnIsCompleted({ status: "running", activity: [] })).toBe(false);
  });

  it("completed turns default to collapsed", () => {
    expect(workflowTurnDefaultCollapsed({ status: "completed", activity: [] })).toBe(true);
    expect(workflowTurnDefaultCollapsed({ status: "running", activity: [] })).toBe(false);
  });
});
