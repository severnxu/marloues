import {
  Clipboard,
  FilePenLine,
  FileText,
  FolderTree,
  Gauge,
  Image as ImageIcon,
  ListChecks,
  Search,
  SquareTerminal,
  Wrench,
} from "lucide-react";
import { itemInputText, itemOutputText } from "../../";
import { workflowStatusIsRunning } from "../../";
import {
  DetailBlock,
  ImageGenerationDetail,
  MarkdownDetail,
  PlanDetail,
  ToolSearchDetail,
  UsageDetail,
  WebSearchDetail,
} from "./detail-sections";
import {
  cleanDetailOutput,
  detailInputLabel,
  detailTitle,
  exitCodeFromOutput,
  isEditToolName,
  isListToolName,
  isReadToolName,
  isSearchToolName,
  itemStatus,
  toolName,
} from "./helpers";
import {
  parseImageGenerationDetail,
  parsePlanSteps,
  parseToolSearchDetail,
  parseUsageDetail,
  parseWebSearchDetail,
} from "./parsers";
import type { ToolCallRowItem } from "./types";
import { ToolDetailFrame, type ToolDetailStatusKind } from "./ToolDetailFrame";

export function ToolDetail({
  item,
  failed,
  cancellable,
  isCancelling,
  onCancel,
}: {
  item: ToolCallRowItem;
  failed: boolean;
  cancellable: boolean;
  isCancelling: boolean;
  onCancel?: () => void;
}) {
  const input = itemInputText(item);
  const outputText = itemOutputText(item);
  const output = cleanDetailOutput(outputText);
  const name = toolName(item);
  const exitCode = exitCodeFromOutput(outputText);
  const status = itemStatus(item);
  const running = workflowStatusIsRunning(status);
  const stopped = ["cancelled", "canceled", "stopped"].includes(status);
  const planSteps = name === "update_plan" ? parsePlanSteps(input) : [];
  const planMarkdown =
    item.type === "plan"
      ? item.text
      : name === "plan_snapshot"
        ? outputText
        : "";
  const toolSearch = name.includes("tool_search")
    ? parseToolSearchDetail(input, output)
    : null;
  const webSearch =
    item.type === "webSearch" ? parseWebSearchDetail(input, output) : null;
  const imageGeneration =
    item.type === "imageGeneration"
      ? parseImageGenerationDetail(input, output)
      : null;
  const usage = name === "token_count" ? parseUsageDetail(output) : null;
  const showDefaultInput = Boolean(
    input &&
    !planSteps.length &&
    !planMarkdown &&
    !toolSearch &&
    !webSearch &&
    !imageGeneration &&
    !usage,
  );
  const showOutput = Boolean(
    output &&
    !(name === "update_plan" && output === "Plan updated") &&
    !planMarkdown &&
    !toolSearch &&
    !webSearch &&
    !imageGeneration &&
    !usage,
  );
  const statusFailed = failed || (exitCode !== null && exitCode !== 0);
  const statusKind: ToolDetailStatusKind = running
    ? "running"
    : statusFailed
      ? "failed"
      : stopped
        ? "stopped"
        : "success";
  const statusText = running
    ? "运行中"
    : statusFailed
      ? "失败"
      : stopped
        ? "已停止"
        : exitCode !== null
          ? `exit ${exitCode}`
          : "成功";

  return (
    <ToolDetailFrame
      title={detailTitle(item)}
      statusKind={statusKind}
      statusText={statusText}
      cancellable={cancellable}
      isCancelling={isCancelling}
      onCancel={onCancel}
    >
      {planSteps.length ? <PlanDetail steps={planSteps} /> : null}
      {planMarkdown ? (
        <MarkdownDetail label="Plan" value={planMarkdown} />
      ) : null}
      {toolSearch ? <ToolSearchDetail data={toolSearch} /> : null}
      {webSearch ? <WebSearchDetail data={webSearch} /> : null}
      {imageGeneration ? (
        <ImageGenerationDetail
          data={imageGeneration}
          completed={statusKind === "success"}
        />
      ) : null}
      {usage ? <UsageDetail data={usage} /> : null}
      {showDefaultInput ? (
        <DetailBlock label={detailInputLabel(item)} value={input} />
      ) : null}
      {showOutput ? (
        <DetailBlock
          label={failed ? "Error" : "Output"}
          value={output}
          danger={failed}
          scrollable
        />
      ) : null}
      {!planSteps.length &&
      !planMarkdown &&
      !toolSearch &&
      !webSearch &&
      !imageGeneration &&
      !usage &&
      !showDefaultInput &&
      !showOutput ? (
        <div className="workflow-tool-empty">无输出</div>
      ) : null}
    </ToolDetailFrame>
  );
}

export function ToolIcon({ item }: { item: ToolCallRowItem }) {
  const name = toolName(item);
  if (name === "update_plan" || name.includes("todo")) return <ListChecks />;
  if (name === "token_count") return <Gauge />;
  if (item.type === "imageGeneration") return <ImageIcon />;
  if (isReadToolName(name)) return <FileText />;
  if (isListToolName(name)) return <FolderTree />;
  if (isEditToolName(name)) return <FilePenLine />;
  if (item.type === "webSearch" || name === "js" || name.includes("web"))
    return <Search />;
  if (isSearchToolName(name)) return <Search />;
  if (name.includes("shell") || name.includes("command") || name === "commands")
    return <SquareTerminal />;
  if (name.includes("clipboard")) return <Clipboard />;
  return <Wrench />;
}
