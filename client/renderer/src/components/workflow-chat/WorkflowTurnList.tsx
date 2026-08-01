import { WorkflowTurnView } from "./TurnView";
import { useWorkflowCollapseState } from "./use-collapse-state";
import type { WorkflowMessageBlock as WorkflowMessageBlock } from "../../../../shared/adapters/workflow-messages-to-read-thread";

interface Props {
  workflowMessages: WorkflowMessageBlock[];
  isStreaming: boolean;
  stateScopeKey?: string;
  modelName?: string;
  showFooterMetadata?: boolean;
  onCopyMessage?: (text: string) => void | Promise<void>;
  onRegenerate?: (message: WorkflowMessageBlock) => void;
  onRewindMessage?: (message: WorkflowMessageBlock) => void;
  onEditMessage?: (message: WorkflowMessageBlock) => void;
  onDeleteMessage?: (id: string) => void;
}

export function WorkflowTurnList({
  workflowMessages,
  isStreaming,
  stateScopeKey = "default",
  modelName,
  showFooterMetadata,
  onCopyMessage,
  onRegenerate,
  onRewindMessage,
  onEditMessage,
  onDeleteMessage,
}: Props) {
  const { isTurnExpanded, setTurnExpanded } = useWorkflowCollapseState({
    isStreaming,
    scope: stateScopeKey,
    workflowMessages,
  });

  return (
    <>
      {workflowMessages.map((message, index) => {
        const expanded = isTurnExpanded(message);
        return (
          <WorkflowTurnView
            key={message.id}
            message={message}
            isLastStreaming={
              isStreaming && index === workflowMessages.length - 1
            }
            expanded={expanded}
            modelName={modelName}
            showFooterMetadata={showFooterMetadata}
            onToggle={() => setTurnExpanded(message.id, !expanded)}
            onCopy={onCopyMessage}
            onRegenerate={() => onRegenerate?.(message)}
            onRewind={() => onRewindMessage?.(message)}
            onEdit={() => onEditMessage?.(message)}
            onDelete={onDeleteMessage}
          />
        );
      })}
    </>
  );
}
