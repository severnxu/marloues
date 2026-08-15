import { useState } from "react";
import {
  Brain,
  CircleHelp,
  Image as ImageIcon,
  ShieldQuestion,
  Wrench,
} from "lucide-react";
import type { WorkflowTurnItem } from "../../../../../shared/adapters/workflow-messages-to-read-thread";
import {
  WorkflowActivityDetailBlock,
  WorkflowActivityDetailStack,
} from "./ActivityDetail";
import { WorkflowActivityRow } from "./ActivityRow";

export function WorkflowImageViewRow({
  item,
}: {
  item: Extract<WorkflowTurnItem, { type: "imageView" }>;
}) {
  return (
    <MarkerRow
      icon="image"
      label="已查看图片"
      detail={basename(item.path)}
      activityKind="imageView"
    />
  );
}

export function WorkflowReviewModeMarker({
  item,
}: {
  item: Extract<
    WorkflowTurnItem,
    { type: "enteredReviewMode" | "exitedReviewMode" }
  >;
}) {
  return (
    <ExpandableMarkerRow
      icon="approval"
      label={
        item.type === "enteredReviewMode" ? "已进入审查模式" : "已退出审查模式"
      }
      activityKind={item.type}
      detailLabel="Review"
      payload={item.review}
    />
  );
}

export function WorkflowHookPromptBlock({
  item,
}: {
  item: Extract<WorkflowTurnItem, { type: "hookPrompt" }>;
}) {
  return (
    <ExpandableMarkerRow
      icon="question"
      label="正在提问"
      activityKind="hookPrompt"
      summary={item.fragmentCount ? `${item.fragmentCount} 个片段` : undefined}
      detailLabel="Fragments"
      payload={item.fragments}
    />
  );
}

export function WorkflowContextCompactionMarker() {
  return (
    <MarkerRow
      icon="reasoning"
      label="上下文已压缩"
      activityKind="contextCompaction"
    />
  );
}

export function WorkflowUnknownRawJson({
  item,
}: {
  item: Extract<WorkflowTurnItem, { type: "unknown" }>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <WorkflowActivityRow
      activityKind="unknown"
      icon={<Wrench />}
      label={<>未知项目</>}
      meta={item.rawType}
      detail={
        <WorkflowActivityDetailStack>
          <WorkflowActivityDetailBlock
            label="Raw"
            value={formatUnknownValue(item.raw)}
          />
        </WorkflowActivityDetailStack>
      }
      open={open}
      onToggle={() => setOpen((value) => !value)}
    />
  );
}

function MarkerRow({
  icon,
  label,
  detail,
  activityKind,
}: {
  icon: MarkerIcon;
  label: string;
  detail?: string;
  activityKind: string;
}) {
  return (
    <WorkflowActivityRow
      activityKind={activityKind}
      icon={markerIcon(icon)}
      label={label}
      meta={detail}
    />
  );
}

function ExpandableMarkerRow({
  icon,
  label,
  summary,
  detailLabel,
  payload,
  activityKind,
}: {
  icon: MarkerIcon;
  label: string;
  summary?: string;
  detailLabel: string;
  payload?: unknown;
  activityKind: string;
}) {
  const [open, setOpen] = useState(false);
  const value = formatOptionalDetail(payload);
  const hasDetail = Boolean(value);

  return (
    <WorkflowActivityRow
      activityKind={activityKind}
      icon={markerIcon(icon)}
      label={label}
      meta={summary}
      detail={
        <WorkflowActivityDetailStack>
          <WorkflowActivityDetailBlock label={detailLabel} value={value} />
        </WorkflowActivityDetailStack>
      }
      hasDetail={hasDetail}
      open={open}
      onToggle={() => setOpen((value) => !value)}
    />
  );
}

type MarkerIcon = "approval" | "tool" | "reasoning" | "image" | "question";

function markerIcon(icon: MarkerIcon) {
  if (icon === "approval") return <ShieldQuestion />;
  if (icon === "question") return <CircleHelp />;
  if (icon === "reasoning") return <Brain />;
  if (icon === "image") return <ImageIcon />;
  return <Wrench />;
}

function formatUnknownValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatOptionalDetail(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  return formatUnknownValue(value);
}

function basename(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}
