import { WorkflowResultCards } from "../activity/ResultCards";
import { WorkflowAssistantAnswer } from "./AssistantAnswer";
import { WorkflowTurnErrorCard } from "./TurnErrorCard";
import { WorkflowTurnFlowSection } from "./TurnFlowSection";
import type {
  TurnPresentationBlock,
  TurnPresentationModel,
} from "./turn-presentation-model";

interface Props {
  model: TurnPresentationModel;
  expanded: boolean;
  plainTextAnswers?: boolean;
  sessionId?: string;
}

export function TurnPresentationBlocks({
  model,
  expanded,
  plainTextAnswers = false,
  sessionId,
}: Props) {
  return (
    <>
      {model.blocks.map((block) => (
        <div
          key={block.id}
          className="turn-presentation-block"
          data-kind="turn-presentation-block"
          data-block-kind={block.kind}
        >
          <TurnPresentationBlockView
            block={block}
            expanded={expanded}
            isLastStreaming={model.runtime.isLastStreaming}
            plainTextAnswers={plainTextAnswers}
            sessionId={sessionId}
            userMessageId={model.userMessageId}
          />
        </div>
      ))}
    </>
  );
}

function TurnPresentationBlockView({
  block,
  expanded,
  isLastStreaming,
  plainTextAnswers,
  sessionId,
  userMessageId,
}: {
  block: TurnPresentationBlock;
  expanded: boolean;
  isLastStreaming: boolean;
  plainTextAnswers: boolean;
  sessionId?: string;
  userMessageId?: string;
}) {
  if (block.kind === "process") {
    return (
      <WorkflowTurnFlowSection
        entries={block.entries}
        expanded={expanded}
        isLastStreaming={isLastStreaming}
        renderAssistantMessage={(item) => (
          <WorkflowAssistantAnswer
            key={item.id}
            text={item.text}
            hasLeadingContent={false}
            plainText={plainTextAnswers}
            streaming={isLastStreaming}
          />
        )}
      />
    );
  }

  if (block.kind === "document") {
    return block.tone === "error" ? (
      <WorkflowTurnErrorCard message={block.text} />
    ) : (
      <WorkflowAssistantAnswer
        text={block.text}
        hasLeadingContent={false}
        plainText={plainTextAnswers}
        streaming={block.streaming}
      />
    );
  }

  return (
    <WorkflowResultCards
      items={block.items}
      sessionId={sessionId}
      showFileChanges={block.showFileChanges}
      userMessageId={userMessageId}
    />
  );
}
