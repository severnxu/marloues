import { WorkflowTurnView } from "./TurnView";
import { useWorkflowCollapseState } from "./use-collapse-state";
import type { WorkflowMessageBlock as WorkflowMessageBlock } from "../../../../../shared/adapters/workflow-messages-to-read-thread";

interface Props {
  workflowMessages: WorkflowMessageBlock[];
  sessionId?: string;
  isStreaming: boolean;
  stateScopeKey?: string;
  modelName?: string;
  showFooterMetadata?: boolean;
  onCopyMessage?: (text: string) => void | Promise<void>;
  onFork?: (message: WorkflowMessageBlock) => void | Promise<void>;
  onDeleteMessage?: (id: string) => void;
}

export function WorkflowTurnList({
  workflowMessages,
  sessionId,
  isStreaming,
  stateScopeKey = "default",
  modelName,
  showFooterMetadata,
  onCopyMessage,
  onFork,
  onDeleteMessage,
}: Props) {
  const { isTurnExpanded, setTurnExpanded } = useWorkflowCollapseState({
    isStreaming,
    scope: stateScopeKey,
    workflowMessages,
    defaultExpandedMessageId: isStreaming
      ? workflowMessages.at(-1)?.id
      : undefined,
  });
  return (
    <>
      {workflowMessages.map((message, index) => {
        const expanded = isTurnExpanded(message);
        return (
          <WorkflowTurnView
            key={message.id}
            message={message}
            sessionId={sessionId}
            isLastStreaming={
              isStreaming && index === workflowMessages.length - 1
            }
            expanded={expanded}
            modelName={modelName}
            showFooterMetadata={showFooterMetadata}
            onToggle={() => setTurnExpanded(message.id, !expanded)}
            onCopy={onCopyMessage}
            onFork={onFork ? () => onFork(message) : undefined}
            onDelete={onDeleteMessage}
          />
        );
      })}
    </>
  );
}
