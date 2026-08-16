import { memo } from "react";
import type { WorkflowMessageBlock as WorkflowMessageBlock } from "../../../../../shared/adapters/workflow-messages-to-read-thread";
import { AssistantTurnHeader } from "./AssistantTurnHeader";
import { WorkflowTurnFooterView } from "./TurnFooterView";
import { WorkflowUserMessage } from "./UserMessage";
import {
  workflowTurnDurationLabel,
  workflowTurnStatusLabel,
  workflowTurnStatusTone,
} from "./turn-status";
import { WorkflowMarkdownContent } from "../content/MarkdownContent";
import { MessageItemView, MessageStatusRow } from "../message-view";

interface Props {
  message: WorkflowMessageBlock;
  sessionId?: string;
  expanded: boolean;
  isLastStreaming: boolean;
  disableResponseTimer?: boolean;
  modelName?: string;
  plainTextAnswers?: boolean;
  showFooterMetadata?: boolean;
  onToggle: () => void;
  onCopy?: (text: string) => void | Promise<void>;
  onEditUserMessage?: (text: string) => void;
  onFork?: () => void | Promise<void>;
  onDelete?: (id: string) => void;
}

/** 超大 live turn 的 items 窗口：只渲染最后 N 条，防止渲染工作集爆炸。 */
const LIVE_TURN_ITEM_WINDOW = 256;

export const WorkflowTurnView = memo(function WorkflowTurnView(props: Props) {
  const { message, isLastStreaming, onCopy, onFork, onDelete, onEditUserMessage, onToggle, expanded, modelName } = props;
  const running =
    isLastStreaming ||
    message.status === "running" ||
    message.activity === "thinking" ||
    message.activity === "running" ||
    message.activity === "responding";

  // live turn 窗口化：运行中的超大 turn 只渲染最后 N 条 items。
  const items =
    running && message.items.length > LIVE_TURN_ITEM_WINDOW
      ? message.items.slice(-LIVE_TURN_ITEM_WINDOW)
      : message.items;

  // 折叠语义：保留 AI 回复的总结——最后一条 agentMessage（Claude 完成任务时的总结段），
  // 其余（过程叙述/思考/工具）全部折叠。
  const summaryText = (() => {
    const texts = items
      .filter((item) => item.type === "agentMessage")
      .map((item) => ("text" in item ? item.text ?? "" : ""))
      .filter(Boolean);
    return texts.length > 0 ? texts[texts.length - 1] : null;
  })();

  const finalText = message.items
    .filter((item) => item.type === "agentMessage")
    .map((item) => ("text" in item ? item.text ?? "" : ""))
    .filter(Boolean)
    .join("\n\n");

  const turnModelName = message.modelName ?? message.modelId ?? modelName;
  const hasActivityItems = message.items.length > 0;
  const durationMs = running
    ? null
    : message.completedAt !== undefined && message.startedAt !== undefined
      ? Math.max(0, message.completedAt - message.startedAt)
      : (message.durationMs ?? null);
  const label = workflowTurnStatusLabel(message, { hasActivityItems, isLastStreaming });
  const tone = workflowTurnStatusTone(message);

  return (
    <div className="group relative" data-kind="assistant-turn">
      <section className="space-y-2" data-kind="workflow-turn" data-turn-expanded={String(expanded)}>
        <WorkflowUserMessage
          text={message.user}
          content={message.userContent}
          createdAt={message.startedAt}
          onCopy={onCopy}
          onEdit={
            onEditUserMessage && message.user
              ? () => onEditUserMessage(message.user ?? "")
              : undefined
          }
        />

        {!message.continuesPreviousTurn ? (
          <AssistantTurnHeader
            activity={message.activity}
            duration={durationMs != null ? workflowTurnDurationLabel(durationMs, { running }) : null}
            expanded={expanded}
            hasActivityItems={hasActivityItems}
            canToggle={!running && hasActivityItems}
            label={label}
            tone={tone}
            usage={message.usage}
            modelName={turnModelName}
            onToggle={onToggle}
          />
        ) : null}

        {expanded ? (
          <div className="space-y-2">
            {items.map((item) => (
              <MessageItemView key={item.id} item={item} />
            ))}
          </div>
        ) : (
          summaryText ? (
            <div className="text-[16px] leading-[28px]" data-kind="message-turn-summary">
              <WorkflowMarkdownContent content={summaryText} />
            </div>
          ) : null
        )}

        {/* 流式状态：只显示在真正活跃的（最后一个）turn 上；引导的前置段保持
            running 但不再显示"正在思考"。 */}
        {isLastStreaming && expanded ? <MessageStatusRow startedAt={message.startedAt} /> : null}

        <WorkflowTurnFooterView
          finalText={finalText}
          isRunning={running}
          messageId={message.id}
          createdAt={message.completedAt ?? message.startedAt}
          showFooterMetadata={props.showFooterMetadata}
          onCopy={onCopy}
          onFork={onFork}
          onDelete={onDelete}
        />
      </section>
    </div>
  );
});
