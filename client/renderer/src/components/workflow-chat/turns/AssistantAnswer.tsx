import { WorkflowMarkdownContent } from "../";

interface Props {
  text: string;
  hasLeadingContent: boolean;
  plainText?: boolean;
  streaming?: boolean;
}

export function WorkflowAssistantAnswer({
  text,
  hasLeadingContent,
  plainText = false,
  streaming = false,
}: Props) {
  return (
    <article
      className={`workflow-assistant-answer ${hasLeadingContent ? "has-leading-content" : ""}`}
      data-kind="assistant-answer"
    >
      {plainText ? (
        <div
          className="workflow-assistant-plain-text"
          data-render-mode={streaming ? "streaming-text" : "plain-text"}
        >
          {text}
        </div>
      ) : (
        <>
          <WorkflowMarkdownContent content={text} streaming={streaming} />
        </>
      )}
    </article>
  );
}
