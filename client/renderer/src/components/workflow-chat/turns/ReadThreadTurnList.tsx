import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { Virtuoso } from "react-virtuoso";
import {
  workflowReadThreadTurnsInRenderOrder,
  type WorkflowMessageBlock,
  type WorkflowTurnItem,
  workflowTurnToWorkflowMessage,
} from "../../../../../shared/adapters/workflow-messages-to-read-thread";
import type {
  WorkflowReadThreadResponse,
  WorkflowTurn,
} from "../../../../../shared/workflow-read-thread-contract";
import { projectToolItem } from "../../../../../shared/adapters/tool-item-projection";
import { compactItems } from "../adapter/workflow-message-adapter/streaming";
import { WorkflowTurnView } from "./TurnView";
import {
  useWorkflowCollapseState,
  type WorkflowCollapseMessage,
} from "./use-collapse-state";

interface Props {
  readThread: WorkflowReadThreadResponse;
  isStreaming: boolean;
  disableResponseTimer?: boolean;
  stateScopeKey?: string;
  modelName?: string;
  plainTextAnswers?: boolean;
  showFooterMetadata?: boolean;
  onCopyMessage?: (text: string) => void | Promise<void>;
  onEditUserMessage?: (text: string) => void;
  onFork?: (message: WorkflowMessageBlock) => void | Promise<void>;
  onDeleteMessage?: (id: string) => void;
  renderBeforeTurn?: (
    message: WorkflowMessageBlock,
    index: number,
  ) => ReactNode;
  scrollParentRef?: RefObject<HTMLDivElement | null>;
}

export function WorkflowReadThreadTurnList({
  readThread,
  isStreaming,
  disableResponseTimer,
  stateScopeKey,
  modelName,
  plainTextAnswers,
  showFooterMetadata,
  onCopyMessage,
  onEditUserMessage,
  onFork,
  onDeleteMessage,
  renderBeforeTurn,
  scrollParentRef,
}: Props) {
  const workflowTurns = useMemo(() => {
    const turns = workflowReadThreadTurnsInRenderOrder(readThread).filter(
      (turn) => turn.items.length > 0,
    );
    return turns;
  }, [readThread]);
  const collapseMessages = useMemo(
    () => workflowTurns.map(workflowTurnToCollapseMessage),
    [workflowTurns],
  );

  /* Legacy comment with invalid encoding retained for blame stability.

  // 稳定化回调，使被 memo 包裹的 WorkflowTurnView 不会因父组件重渲染而全部重算
  */
  const stableHandlers = useMemo(
    () => ({
      onCopy: onCopyMessage,
      onEditUserMessage,
      onFork,
      onDeleteMessage,
    }),
    [onCopyMessage, onEditUserMessage, onFork, onDeleteMessage],
  );

  /* Legacy comment with invalid encoding retained for blame stability.

  // 稳定化 renderBeforeTurn 入口：按 messageId 索引避免每次创建新函数
  */
  const renderBefore = useCallback(
    (message: WorkflowMessageBlock, index: number) =>
      renderBeforeTurn?.(message, index) ?? null,
    [renderBeforeTurn],
  );

  const scope = stateScopeKey ?? readThread.thread.id;
  // 展开态锚定 running turn 的 id（稳定）：若用 isStreaming 条件决定
  // defaultExpandedMessageId，流式中 thread.status/streamingSessionIds 的
  // 瞬时抖动会让 running turn 在展开/折叠间反复横跳，导致 MarkdownContent
  // 反复 remount（流式缓冲 timer 被 unmount 清理，文本不渐进显示）。
  const runningTurnId =
    workflowTurns.find((turn) => turn.status === "running")?.id ??
    (isStreaming ? workflowTurns.at(-1)?.id : undefined);
  const { isTurnExpanded, setTurnExpanded } = useWorkflowCollapseState({
    isStreaming,
    scope,
    workflowMessages: collapseMessages,
    defaultExpandedMessageId: runningTurnId,
  });
  const [scrollParent, setScrollParent] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const syncScrollParent = () => {
      setScrollParent(scrollParentRef?.current ?? null);
    };
    syncScrollParent();
    // Child layout effects can run before the parent DOM ref is attached.
    const frame = requestAnimationFrame(syncScrollParent);
    return () => cancelAnimationFrame(frame);
  }, [scrollParentRef]);

  const renderTurn = useCallback(
    (index: number, turn: WorkflowTurn) => {
      // Virtuoso invokes itemContent only for the visible range. Keep the raw
      // turn as list data so an initial session switch does not normalize every
      // historical item before the first frame can paint.
      const message = cachedNormalizedWorkflowMessage(turn);
      const expanded = isTurnExpanded(message);
      return (
        <div
          key={message.id}
          className="workflow-turn-frame"
          data-message-id={message.id}
        >
          {renderBefore(message, index)}
          <WorkflowTurnView
            message={message}
            sessionId={readThread.thread.id}
            isLastStreaming={isStreaming && index === workflowTurns.length - 1}
            disableResponseTimer={disableResponseTimer}
            expanded={expanded}
            modelName={modelName}
            plainTextAnswers={plainTextAnswers}
            showFooterMetadata={showFooterMetadata}
            onToggle={() => setTurnExpanded(message.id, !expanded)}
            onCopy={stableHandlers.onCopy}
            onEditUserMessage={stableHandlers.onEditUserMessage}
            onFork={
              stableHandlers.onFork
                ? () => stableHandlers.onFork?.(message)
                : undefined
            }
            onDelete={stableHandlers.onDeleteMessage}
          />
        </div>
      );
    },
    [
      disableResponseTimer,
      isStreaming,
      isTurnExpanded,
      modelName,
      plainTextAnswers,
      readThread.thread.id,
      renderBefore,
      setTurnExpanded,
      showFooterMetadata,
      stableHandlers,
      workflowTurns.length,
    ],
  );

  if (!scrollParentRef) {
    return <>{workflowTurns.map((turn, index) => renderTurn(index, turn))}</>;
  }
  if (!scrollParent) return null;

  return (
    <Virtuoso
      customScrollParent={scrollParent}
      data={workflowTurns}
      computeItemKey={(_index, turn) => turn.id}
      increaseViewportBy={{ top: 1_200, bottom: 1_800 }}
      itemContent={renderTurn}
    />
  );
}

function workflowTurnToCollapseMessage(
  turn: WorkflowTurn,
): WorkflowCollapseMessage {
  const status: WorkflowCollapseMessage["status"] =
    turn.status === "failed"
      ? "failed"
      : turn.status === "completed"
        ? "completed"
        : turn.status === "cancelled"
          ? "cancelled"
          : "running";
  const activity: WorkflowCollapseMessage["activity"] =
    status === "failed"
      ? "failed"
      : status === "completed" || status === "cancelled"
        ? "done"
        : turn.items.some(
              (item) => item.type === "agentMessage" && item.text.trim(),
            )
          ? "responding"
          : turn.items.some((item) => item.type !== "userMessage")
            ? "running"
            : "thinking";
  return { id: turn.id, status, activity };
}

const normalizedWorkflowMessageCache = new WeakMap<
  WorkflowReadThreadResponse["turns"][number],
  WorkflowMessageBlock
>();

function cachedNormalizedWorkflowMessage(
  turn: WorkflowReadThreadResponse["turns"][number],
): WorkflowMessageBlock {
  const cached = normalizedWorkflowMessageCache.get(turn);
  if (cached) return cached;
  const message = normalizeReadThreadMessageForCodexPresentation(
    workflowTurnToWorkflowMessage(turn),
  );
  normalizedWorkflowMessageCache.set(turn, message);
  return message;
}

function normalizeReadThreadMessageForCodexPresentation(
  message: WorkflowMessageBlock,
): WorkflowMessageBlock {
  return {
    ...message,
    items: compactItems(
      message.items
        .map(projectToolItem)
        .filter((item): item is WorkflowTurnItem => Boolean(item)),
    ),
  };
}
