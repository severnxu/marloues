import { useState } from "react";
import type { WorkflowTurnItem } from "../../../../../shared/adapters/workflow-messages-to-read-thread";
import { itemInputText, itemOutputText } from "../";
import {
  WorkflowActivityRow,
  WorkflowActivityStatusBadge,
  WorkflowInlineDots,
} from "./ActivityRow";
import {
  ToolDetail,
  ToolIcon,
  itemStatus,
  toolLabel,
} from "./ToolCallRowDetails";
import { workflowStatusIsRunning } from "../";
import { useUnifiedChatStore } from "@/stores/unified-chat-store";
import {
  isSubagentDelegationToolName,
  isTaskManagementToolName,
} from "../../../../../shared/execution-tools";

type ToolCallRowItem = Extract<
  WorkflowTurnItem,
  {
    type:
      | "plan"
      | "mcpToolCall"
      | "dynamicToolCall"
      | "webSearch"
      | "imageGeneration";
  }
>;
interface Props {
  item: ToolCallRowItem;
}

export function WorkflowToolCallRow({ item }: Props) {
  const [open, setOpen] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const activeSessionId = useUnifiedChatStore((state) => state.activeSessionId);
  const execution = useUnifiedChatStore((state) =>
    activeSessionId
      ? (state.executionBySession[activeSessionId] ?? null)
      : null,
  );
  const revealExecutionSubagent = useUnifiedChatStore(
    (state) => state.revealExecutionSubagent,
  );
  const input = itemInputText(item);
  const output = itemOutputText(item);
  const status = itemStatus(item);
  const running = workflowStatusIsRunning(status);
  const cancellable = running;
  const hasDetail = Boolean(input || output || cancellable);
  const failed = status === "error" || status === "failed";
  const toolName = "tool" in item ? item.tool : "";
  const linksSubagent = isSubagentDelegationToolName(toolName);
  const isTaskTool = isTaskManagementToolName(toolName);
  const linkedSubagents = linksSubagent
    ? Object.values(execution?.subagents ?? {}).filter(
        (subagent) =>
          subagent.parentToolId === item.id || subagent.id === item.id,
      )
    : [];
  const handleCancelTool = async () => {
    if (isCancelling) return;
    setIsCancelling(true);
    try {
      await window.marloues.chat.cancelTool(item.id);
    } catch (error) {
      console.error("Failed to cancel tool", error);
      setIsCancelling(false);
    }
  };

  if (isTaskTool) {
    return (
      <WorkflowActivityRow
        activityKind={item.type}
        icon={<ToolIcon item={item} />}
        label={
          <>
            {taskToolLabel(toolName)}
            {running ? <WorkflowInlineDots /> : null}
            {failed ? <WorkflowActivityStatusBadge failed /> : null}
          </>
        }
      />
    );
  }

  if (linksSubagent) {
    const count = linkedSubagents.length || 1;
    const firstSubagentId = linkedSubagents[0]?.id ?? item.id;
    const visibleSubagents = linkedSubagents.filter(hasDisplayMetadata);
    return (
      <WorkflowActivityRow
        activityKind={item.type}
        icon={<ToolIcon item={item} />}
        label={
          <>
            {running ? "正在创建" : "已创建"} {count} 个智能体
            {running ? <WorkflowInlineDots /> : null}
            {running || failed ? (
              <WorkflowActivityStatusBadge failed={failed} />
            ) : null}
          </>
        }
        meta={toolName}
        detail={
          visibleSubagents.length ? (
            <div className="workflow-subagent-links workflow-activity-detail-surface">
              {visibleSubagents.map((subagent) => (
                <button
                  key={subagent.id}
                  type="button"
                  className="workflow-subagent-link"
                  onClick={() => {
                    if (activeSessionId) {
                      revealExecutionSubagent(activeSessionId, subagent.id);
                    }
                  }}
                  title={
                    subagent.prompt ?? subagent.description ?? subagent.title
                  }
                >
                  <span className="workflow-subagent-link-label">
                    {subagentLabel(subagent)}
                  </span>
                  {subagent.description ? (
                    <span className="workflow-subagent-link-detail">
                      {compactText(subagent.description, 52)}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : (
            <div className="workflow-subagent-waiting workflow-activity-detail-surface">
              等待智能体启动...
            </div>
          )
        }
        hasDetail={visibleSubagents.length > 0 || running}
        open={open}
        onToggle={() => {
          if (activeSessionId) {
            revealExecutionSubagent(activeSessionId, firstSubagentId);
          }
          setOpen((value) => !value);
        }}
      />
    );
  }

  return (
    <WorkflowActivityRow
      activityKind={item.type}
      icon={<ToolIcon item={item} />}
      label={
        <>
          {toolLabel(item)}
          {running ? <WorkflowInlineDots /> : null}
          {running || failed ? (
            <WorkflowActivityStatusBadge failed={failed} />
          ) : null}
        </>
      }
      meta={toolName}
      detail={
        <ToolDetail
          item={item}
          failed={failed}
          cancellable={cancellable}
          isCancelling={isCancelling}
          onCancel={handleCancelTool}
        />
      }
      hasDetail={hasDetail}
      open={open}
      onToggle={() => setOpen((value) => !value)}
    />
  );
}

function compactText(value: string, maxChars: number): string {
  const text = value.trim().replace(/\s+/g, " ");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function hasDisplayMetadata(subagent: {
  agentName?: string;
  agentType?: string;
  description?: string;
  prompt?: string;
}): boolean {
  return Boolean(
    subagent.description?.trim() ||
    subagent.prompt?.trim() ||
    meaningfulAgentLabel(subagent),
  );
}

function subagentLabel(subagent: {
  ordinal: number;
  agentName?: string;
  agentType?: string;
}): string {
  const label = meaningfulAgentLabel(subagent);
  return label ? `#${subagent.ordinal} ${label}` : `#${subagent.ordinal}`;
}

function meaningfulAgentLabel(subagent: {
  agentName?: string;
  agentType?: string;
}): string | null {
  const label = (subagent.agentName ?? subagent.agentType ?? "").trim();
  if (!label || label.toLowerCase() === "agent") return null;
  return label;
}

function taskToolLabel(toolName: string): string {
  const normalized = toolName.toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "taskcreate" || normalized === "task_create") {
    return "创建任务";
  }
  if (normalized === "taskupdate" || normalized === "task_update") {
    return "更新任务";
  }
  if (normalized === "tasklist" || normalized === "task_list") {
    return "列出任务";
  }
  if (normalized === "taskget" || normalized === "task_get") {
    return "读取任务";
  }
  if (normalized === "taskstop" || normalized === "task_stop") {
    return "停止任务";
  }
  return "处理任务";
}
