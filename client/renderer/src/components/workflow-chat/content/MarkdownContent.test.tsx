import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  hasUnclosedCodeFence,
  parseProgressiveMarkdownBlocks,
  WorkflowMarkdownContent,
} from "./MarkdownContent";

describe("WorkflowMarkdownContent progressive rendering", () => {
  it("keeps Markdown formatting while an answer is streaming", () => {
    const html = renderToStaticMarkup(
      <WorkflowMarkdownContent
        content={"# Heading\n\nA **formatted** streaming answer."}
        streaming
      />,
    );

    expect(html).toContain("<h1>Heading</h1>");
    expect(html).toContain("<strong>formatted</strong>");
  });

  it("keeps completed top-level blocks stable when content is appended", () => {
    const completedPrefix = "# Heading\n\nFirst paragraph.\n\n";
    const initialBlocks = parseProgressiveMarkdownBlocks(completedPrefix);
    const extendedBlocks = parseProgressiveMarkdownBlocks(
      `${completedPrefix}Second paragraph.`,
    );

    expect(extendedBlocks.slice(0, initialBlocks.length)).toEqual(
      initialBlocks,
    );
  });

  it("detects an unfinished fenced code block", () => {
    expect(hasUnclosedCodeFence("~~~ts\nconst answer = 42;")).toBe(true);
    expect(hasUnclosedCodeFence("~~~ts\nconst answer = 42;\n~~~")).toBe(false);
  });

  it("defers syntax highlighting until the streaming code fence closes", () => {
    const incompleteHtml = renderToStaticMarkup(
      <WorkflowMarkdownContent
        content={"~~~js\nconst answer = 42;"}
        streaming
      />,
    );
    const completedHtml = renderToStaticMarkup(
      <WorkflowMarkdownContent
        content={"~~~js\nconst answer = 42;\n~~~"}
        streaming
      />,
    );

    expect(incompleteHtml).not.toContain("hljs");
    expect(completedHtml).toContain("hljs");
  });

  it("keeps very large code blocks plain to protect the renderer", () => {
    const source = `\`\`\`js\n${"const value = 1;\n".repeat(2_000)}\`\`\``;
    const html = renderToStaticMarkup(
      <WorkflowMarkdownContent content={source} />,
    );

    expect(html).toContain("language-js");
    expect(html).not.toContain("hljs-keyword");
  });

  it("renders code through the semantic content surface", () => {
    const html = renderToStaticMarkup(
      <WorkflowMarkdownContent content={"```ts\nconst value = 1;\n```"} />,
    );

    expect(html).toContain("workflow-markdown");
    expect(html).toContain("workflow-code-block");
    expect(html).toContain("workflow-code-block-language");
    expect(html).toContain("workflow-detail-copy-button");
    expect(html).not.toContain("my-3 min-w-0");
  });
});
