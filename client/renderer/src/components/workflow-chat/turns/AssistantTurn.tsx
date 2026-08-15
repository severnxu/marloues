import type { ReactNode } from "react";
import { WorkflowTurnFooterView } from "./TurnFooterView";
import { WorkflowTurnShell } from "./TurnShell";
import { TurnPresentationBlocks } from "./TurnPresentationBlocks";
import type { TurnPresentationModel } from "./turn-presentation-model";

interface Props {
  model: TurnPresentationModel;
  duration: ReactNode;
  expanded: boolean;
  sessionId?: string;
  plainTextAnswers?: boolean;
  showFooterMetadata?: boolean;
  onToggle: () => void;
  onCopy?: (text: string) => void | Promise<void>;
  onFork?: () => void | Promise<void>;
  onDelete?: (id: string) => void;
}

export function WorkflowAssistantTurn({
  model,
  duration,
  expanded,
  sessionId,
  plainTextAnswers = false,
  showFooterMetadata = true,
  onToggle,
  onCopy,
  onFork,
  onDelete,
}: Props) {
  const headerModelName =
    showFooterMetadata &&
    model.metadata.modelName &&
    model.metadata.modelName !== "Marloues"
      ? model.metadata.modelName
      : undefined;

  return (
    <WorkflowTurnShell
      duration={duration}
      expanded={expanded}
      model={model}
      onToggle={onToggle}
      modelName={headerModelName}
    >
      <TurnPresentationBlocks
        model={model}
        expanded={expanded}
        plainTextAnswers={plainTextAnswers}
        sessionId={sessionId}
      />

      <WorkflowTurnFooterView
        finalText={model.documentText}
        isRunning={model.runtime.running}
        messageId={model.id}
        createdAt={model.metadata.createdAt}
        showFooterMetadata={showFooterMetadata}
        onCopy={onCopy}
        onFork={onFork}
        onDelete={onDelete}
      />
    </WorkflowTurnShell>
  );
}
