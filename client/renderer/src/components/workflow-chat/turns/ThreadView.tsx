import type { WorkflowReadThreadResponse } from "../../../../../shared/workflow-read-thread-contract";
import { WorkflowReadThreadTurnList } from "./ReadThreadTurnList";

interface Props {
  readThread: WorkflowReadThreadResponse;
  isStreaming?: boolean;
  stateScopeKey?: string;
  onCopyMessage?: (text: string) => void | Promise<void>;
  onFork?: () => void | Promise<void>;
  onDeleteMessage?: (id: string) => void;
}

export function WorkflowThreadView({
  readThread,
  isStreaming = false,
  stateScopeKey,
  onCopyMessage,
  onFork,
  onDeleteMessage,
}: Props) {
  return (
    <WorkflowReadThreadTurnList
      readThread={readThread}
      isStreaming={isStreaming}
      stateScopeKey={stateScopeKey}
      onCopyMessage={onCopyMessage}
      onFork={onFork}
      onDeleteMessage={onDeleteMessage}
    />
  );
}
