/**
 * Presentational components extracted from WorkflowChatPage:
 * - ModelChangeDivider
 * - PlanImplementationPromptCard
 * - ContextActionCard
 */

import {
  X,
  RotateCcw,
  Play,
  Maximize2,
  GitBranch,
  MessageSquarePlus,
  Box,
  Info,
} from "lucide-react";
import type { ContextActionRequest } from "@shared/types";

export function ModelChangeDivider({
  fromModel,
  toModel,
}: {
  fromModel: string;
  toModel: string;
}) {
  return (
    <div
      className="model-change-divider"
      role="status"
      aria-label={`模型已从 ${fromModel} 更改为 ${toModel}`}
    >
      <span className="model-change-divider-line" />
      <span className="model-change-divider-label">
        <Box size={14} />
        <span>
          模型已从 <strong>{fromModel}</strong> 更改为{" "}
          <strong>{toModel}</strong>
        </span>
        <Info size={14} />
      </span>
      <span className="model-change-divider-line" />
    </div>
  );
}

export function PlanImplementationPromptCard({
  planText,
  onImplement,
  onImplementFresh,
  onStayInPlan,
  onDismiss,
}: {
  planText: string;
  onImplement: () => void;
  onImplementFresh: () => void;
  onStayInPlan: () => void;
  onDismiss: () => void;
}) {
  const preview =
    planText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 3)
      .join(" / ") || "Plan ready";

  return (
    <div className="plan-implementation-prompt" role="dialog">
      <div className="plan-implementation-copy">
        <strong>执行这个计划？</strong>
        <span>{preview}</span>
      </div>
      <div className="plan-implementation-actions">
        <button type="button" onClick={onImplement}>
          <Play size={14} />
          <span>执行计划</span>
        </button>
        <button type="button" onClick={onImplementFresh}>
          <RotateCcw size={14} />
          <span>清空上下文执行</span>
        </button>
        <button type="button" onClick={onStayInPlan}>
          <MessageSquarePlus size={14} />
          <span>继续修改计划</span>
        </button>
        <button
          type="button"
          className="plan-implementation-close"
          onClick={onDismiss}
          aria-label="关闭"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

export function ContextActionCard({
  request,
  onDismiss,
  onAction,
}: {
  request: ContextActionRequest;
  onDismiss: () => void;
  onAction: (action: ContextActionRequest["actions"][number]) => void;
}) {
  const hasLargerModelAction =
    request.actions.includes("switch_to_larger_model") &&
    Boolean(request.largerModel);
  const hasBranchAction = request.actions.includes("create_small_model_branch");
  const hasNewSessionAction = request.actions.includes("new_session");
  const hasContinueAction = request.actions.includes("continue_anyway");

  return (
    <section
      className="context-action-card"
      role="group"
      aria-labelledby="context-action-title"
    >
      <button
        type="button"
        className="context-action-dismiss"
        onClick={onDismiss}
        aria-label="关闭上下文提示"
      >
        <X size={14} />
      </button>
      <div className="context-action-main">
        <div className="context-action-copy">
          <h2 id="context-action-title">{request.title}</h2>
          <span>{request.detail ?? "当前会话接近模型上下文上限。"}</span>
        </div>
      </div>
      <div className="context-action-buttons" aria-label="上下文操作">
        {hasLargerModelAction ? (
          <button
            type="button"
            className="primary"
            onClick={() => onAction("switch_to_larger_model")}
          >
            <Maximize2 size={14} />
            切换到大模型
          </button>
        ) : null}
        {hasBranchAction ? (
          <button
            type="button"
            className={hasLargerModelAction ? undefined : "primary"}
            onClick={() => onAction("create_small_model_branch")}
          >
            <GitBranch size={14} />
            创建精简分支
          </button>
        ) : null}
        {hasNewSessionAction ? (
          <button
            type="button"
            className={
              hasLargerModelAction || hasBranchAction ? undefined : "primary"
            }
            onClick={() => onAction("new_session")}
          >
            <MessageSquarePlus size={14} />
            新会话
          </button>
        ) : null}
        {hasContinueAction ? (
          <button type="button" onClick={() => onAction("continue_anyway")}>
            <Play size={14} />
            继续发送
          </button>
        ) : null}
      </div>
    </section>
  );
}
