import { memo, useEffect, useRef, useState } from "react";
import { WorkflowAssistantTurn } from "./AssistantTurn";
import { useMemo } from "react";
import { WorkflowUserMessage } from "./UserMessage";
import { workflowTurnDurationLabel } from "./turn-status";
import type { WorkflowMessageBlock as WorkflowMessageBlock } from "../../../../../shared/adapters/workflow-messages-to-read-thread";
import { buildTurnPresentationModel } from "./turn-presentation-model";

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

export const WorkflowTurnView = memo(function WorkflowTurnView({
  message,
  sessionId,
  expanded,
  isLastStreaming,
  disableResponseTimer,
  modelName,
  plainTextAnswers,
  showFooterMetadata,
  onToggle,
  onCopy,
  onEditUserMessage,
  onFork,
  onDelete,
}: Props) {
  const presentationModel = useMemo(
    () =>
      buildTurnPresentationModel(message, {
        isLastStreaming,
        modelName,
        liveItemWindow: LIVE_TURN_ITEM_WINDOW,
      }),
    [isLastStreaming, message, modelName],
  );
  const duration = presentationModel.runtime.showDuration ? (
    <WorkflowTurnDuration
      canonicalDurationMs={presentationModel.runtime.durationMs}
      completedAt={presentationModel.runtime.completedAt}
      disableTimer={Boolean(disableResponseTimer)}
      running={presentationModel.runtime.running}
      startedAt={presentationModel.runtime.startedAt}
    />
  ) : null;

  return (
    <section
      className="workflow-turn"
      data-kind="workflow-turn"
      data-turn-expanded={String(expanded)}
    >
      <WorkflowUserMessage
        text={presentationModel.prompt.text}
        content={presentationModel.prompt.content}
        createdAt={presentationModel.prompt.createdAt}
        onCopy={onCopy}
        onEdit={
          onEditUserMessage && presentationModel.prompt.text
            ? () => onEditUserMessage(presentationModel.prompt.text)
            : undefined
        }
      />

      <WorkflowAssistantTurn
        duration={duration}
        expanded={expanded}
        model={presentationModel}
        sessionId={sessionId}
        plainTextAnswers={plainTextAnswers}
        showFooterMetadata={showFooterMetadata}
        onToggle={onToggle}
        onCopy={onCopy}
        onFork={onFork}
        onDelete={onDelete}
      />
    </section>
  );
});

const LIVE_TURN_ITEM_WINDOW = 256;

function WorkflowTurnDuration({
  canonicalDurationMs,
  completedAt,
  disableTimer,
  running,
  startedAt,
}: {
  canonicalDurationMs: number | null;
  completedAt: number | null;
  disableTimer: boolean;
  running: boolean;
  startedAt: number | null;
}) {
  const fallbackStartedAt = useRef(Date.now());
  const stoppedAt = useRef<number | null>(null);
  const [now, setNow] = useState(Date.now);

  if (running) stoppedAt.current = null;
  else stoppedAt.current ??= completedAt ?? Date.now();

  useEffect(() => {
    if (disableTimer || !running) return undefined;
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [disableTimer, running]);

  const effectiveStartedAt = startedAt ?? fallbackStartedAt.current;
  const durationMs = disableTimer
    ? canonicalDurationMs
    : running
      ? Math.max(0, now - effectiveStartedAt)
      : (canonicalDurationMs ??
        Math.max(0, (stoppedAt.current ?? now) - effectiveStartedAt));
  return <>{workflowTurnDurationLabel(durationMs, { running })}</>;
}
