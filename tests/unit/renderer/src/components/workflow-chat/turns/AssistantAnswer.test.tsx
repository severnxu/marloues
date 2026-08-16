import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkflowAssistantAnswer } from "../../../../../../../client/renderer/src/components/workflow-chat/turns/AssistantAnswer";

describe("WorkflowAssistantAnswer streaming rendering", () => {
  it("renders Markdown formatting while streaming and after completion", () => {
    const text = "**bold**\n```ts\nconst value = 1;\n```";
    const streamingHtml = renderToStaticMarkup(
      <WorkflowAssistantAnswer
        text={text}
        hasLeadingContent={false}
        streaming
      />,
    );
    const completedHtml = renderToStaticMarkup(
      <WorkflowAssistantAnswer text={text} hasLeadingContent={false} />,
    );

    // Streaming renders Markdown formatting instead of falling back to plain text.
    expect(streamingHtml).toContain("<strong>bold</strong>");
    expect(streamingHtml).not.toContain("**bold**");
    expect(streamingHtml).toContain("hljs");

    // Completed renders the same formatting.
    expect(completedHtml).toContain("<strong>bold</strong>");
    expect(completedHtml).toContain('class="hljs language-ts"');
  });

  it("falls back to plain text when plainText is set", () => {
    const text = "**bold**";
    const html = renderToStaticMarkup(
      <WorkflowAssistantAnswer
        text={text}
        hasLeadingContent={false}
        plainText
      />,
    );

    expect(html).toContain('data-render-mode="plain-text"');
    expect(html).toContain("**bold**");
    expect(html).not.toContain("<strong>");
  });
});
