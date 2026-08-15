import { useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import type { WorkflowTurnItem } from "../../../../../shared/adapters/workflow-messages-to-read-thread";
import { itemInputText, itemOutputText, workflowStatusIsRunning } from "../";
import {
  WorkflowActivityRow,
  WorkflowActivityStatusBadge,
  WorkflowInlineDots,
} from "./ActivityRow";
import { ToolDetail } from "./ToolCallRowDetails";

type ImageGenerationItem = Extract<
  WorkflowTurnItem,
  { type: "imageGeneration" }
>;

export function WorkflowImageGenerationRow({
  item,
}: {
  item: ImageGenerationItem;
}) {
  const [open, setOpen] = useState(false);
  const hasDetail = Boolean(itemInputText(item) || itemOutputText(item));
  const status = item.status ?? "completed";
  const running = workflowStatusIsRunning(status);
  const failed = status === "error" || status === "failed";

  return (
    <WorkflowActivityRow
      activityKind="imageGeneration"
      icon={<ImageIcon />}
      label={
        <>
          {imageGenerationLabel(item)}
          {running ? <WorkflowInlineDots /> : null}
          {running || failed ? (
            <WorkflowActivityStatusBadge failed={failed} />
          ) : null}
        </>
      }
      meta={item.savedPath}
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

function imageGenerationLabel(item: ImageGenerationItem): string {
  if (workflowStatusIsRunning(item.status)) return "正在生成图片";
  if (item.status === "error" || item.status === "failed")
    return "失败：生成图片";
  return "已生成图片";
}
