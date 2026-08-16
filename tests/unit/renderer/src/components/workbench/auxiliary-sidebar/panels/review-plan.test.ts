import { describe, expect, it } from "vitest";
import type { TimelineItem } from "@shared/types";
import { buildReviewPlanItems } from "../../../../../../../../client/renderer/src/components/workbench/auxiliary-sidebar/panels/review-plan";

describe("buildReviewPlanItems", () => {
  it("maps structured review steps without including unrelated timeline items", () => {
    const timeline: TimelineItem[] = [
      planItem("done", "确认 PRD", "基线已冻结", "completed"),
      {
        id: "tool",
        type: "tool_result",
        label: "读取文件",
        toolName: "Read",
        createdAt: 2,
        status: "completed",
      },
      planItem("active", "评审交互稿", "等待布局确认", "running"),
      planItem("pending", "搭建组件", "等待评审通过", "pending"),
    ];

    expect(buildReviewPlanItems(timeline)).toEqual([
      {
        id: "done",
        title: "确认 PRD",
        detail: "基线已冻结",
        state: "done",
      },
      {
        id: "active",
        title: "评审交互稿",
        detail: "等待布局确认",
        state: "active",
      },
      {
        id: "pending",
        title: "搭建组件",
        detail: "等待评审通过",
        state: "pending",
      },
    ]);
  });
});

function planItem(
  id: string,
  label: string,
  detail: string,
  status: TimelineItem["status"],
): TimelineItem {
  return {
    id,
    type: "status",
    label,
    detail,
    toolName: "review_plan",
    createdAt: 1,
    status,
  };
}
