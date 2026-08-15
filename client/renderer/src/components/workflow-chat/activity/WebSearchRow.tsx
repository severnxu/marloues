import { useState } from "react";
import { Search } from "lucide-react";
import type { WorkflowTurnItem } from "../../../../../shared/adapters/workflow-messages-to-read-thread";
import { itemInputText, itemOutputText, workflowStatusIsRunning } from "../";
import {
  WorkflowActivityRow,
  WorkflowActivityStatusBadge,
  WorkflowInlineDots,
} from "./ActivityRow";
import {
  cleanDetailOutput,
  parseWebSearchDetail,
  ToolDetail,
} from "./ToolCallRowDetails";

type WebSearchItem = Extract<WorkflowTurnItem, { type: "webSearch" }>;

export function WorkflowWebSearchRow({ item }: { item: WebSearchItem }) {
  const [open, setOpen] = useState(false);
  const input = itemInputText(item);
  const output = itemOutputText(item);
  const hasDetail = Boolean(input || output);
  const status = item.status ?? "completed";
  const running = workflowStatusIsRunning(status);
  const failed = status === "error" || status === "failed";
  const detailData = parseWebSearchDetail(input, cleanDetailOutput(output));

  return (
    <WorkflowActivityRow
      activityKind="webSearch"
      icon={<Search />}
      label={
        <>
          {webSearchLabel(item)}
          {running ? <WorkflowInlineDots /> : null}
          {running || failed ? (
            <WorkflowActivityStatusBadge failed={failed} />
          ) : null}
        </>
      }
      meta={
        detailData?.url ||
        detailData?.query ||
        detailData?.queries[0] ||
        undefined
      }
      hasDetail={hasDetail}
      open={open}
      onToggle={() => setOpen((value) => !value)}
      detail={
        <ToolDetail
          item={item}
          failed={failed}
          cancellable={false}
          isCancelling={false}
        />
      }
    />
  );
}

function webSearchLabel(item: WebSearchItem): string {
  const input = itemInputText(item);
  const openedPage = input.includes('"type": "open_page"');
  const label = openedPage ? "已打开页面" : "已搜索网页";
  if (workflowStatusIsRunning(item.status)) return label.replace(/^已/, "正在");
  if (item.status === "error" || item.status === "failed")
    return `失败：${label}`;
  return label;
}
