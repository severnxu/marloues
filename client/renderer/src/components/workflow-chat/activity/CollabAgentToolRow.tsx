import { useState } from "react";
import { Wrench } from "lucide-react";
import type { WorkflowTurnItem } from "../../../../../shared/adapters/workflow-messages-to-read-thread";
import {
  WorkflowActivityDetailBlock,
  WorkflowActivityDetailStack,
} from "./ActivityDetail";
import { WorkflowActivityRow, WorkflowInlineDots } from "./ActivityRow";
import { workflowStatusIsRunning } from "../";
import { useUnifiedChatStore } from "@/stores/unified-chat-store";

type CollabAgentItemModel = Extract<
  WorkflowTurnItem,
  { type: "collabAgentToolCall" }
>;

interface Props {
  item: CollabAgentItemModel;
}

export function WorkflowCollabAgentToolRow({ item }: Props) {
  const [open, setOpen] = useState(false);
  const activeSessionId = useUnifiedChatStore((state) => state.activeSessionId);
  const revealExecutionSubagent = useUnifiedChatStore(
    (state) => state.revealExecutionSubagent,
  );
  const hasDetail = Boolean(
    item.prompt ||
    item.model ||
    item.reasoningEffort ||
    item.receiverThreadIds?.length ||
    item.senderThreadId,
  );
  const running = workflowStatusIsRunning(item.status);

  return (
    <WorkflowActivityRow
      activityKind="collabAgentToolCall"
      icon={<Wrench />}
      label={
        <>
          {running ? "正在使用协作代理" : "已使用协作代理"}
          {running ? <WorkflowInlineDots /> : null}
        </>
      }
      meta={
        item.receiverThreadIds?.length
          ? `${item.receiverThreadIds.length} 个线程`
          : item.tool
      }
      hasDetail={hasDetail}
      open={open}
      onToggle={() => {
        if (activeSessionId) revealExecutionSubagent(activeSessionId, item.id);
        setOpen((value) => !value);
      }}
      detail={
        <WorkflowActivityDetailStack>
          <CollabAgentDetail item={item} />
        </WorkflowActivityDetailStack>
      }
    />
  );
}

function CollabAgentDetail({ item }: { item: CollabAgentItemModel }) {
  return (
    <>
      {item.tool || item.model ? (
        <div className="workflow-collab-agent-head">
          <span className="workflow-collab-agent-tool">
            {item.tool || "collab_agent"}
          </span>
          {item.model ? (
            <span className="workflow-collab-agent-model">{item.model}</span>
          ) : null}
        </div>
      ) : null}
      {item.prompt ? (
        <WorkflowActivityDetailBlock label="Prompt" value={item.prompt} />
      ) : null}
      {item.senderThreadId ? (
        <WorkflowActivityDetailBlock
          label="Sender"
          value={item.senderThreadId}
        />
      ) : null}
      {item.receiverThreadIds?.length ? (
        <WorkflowActivityDetailBlock
          label="Receivers"
          value={item.receiverThreadIds.join(", ")}
        />
      ) : null}
      {item.reasoningEffort ? (
        <WorkflowActivityDetailBlock
          label="Reasoning"
          value={item.reasoningEffort}
        />
      ) : null}
    </>
  );
}
