import type { TimelineItem } from "@shared/types";

export interface ReviewPlanItem {
  id: string;
  title: string;
  detail: string;
  state: "done" | "active" | "pending";
}

export function buildReviewPlanItems(
  timeline: readonly TimelineItem[],
): ReviewPlanItem[] {
  return timeline
    .filter((item) => item.toolName === "review_plan")
    .map((item) => ({
      id: item.id,
      title: item.label,
      detail: item.detail?.trim() || "等待更新",
      state: resolvePlanState(item.status),
    }));
}

function resolvePlanState(
  status: TimelineItem["status"],
): ReviewPlanItem["state"] {
  if (status === "completed") return "done";
  if (status === "running") return "active";
  return "pending";
}
