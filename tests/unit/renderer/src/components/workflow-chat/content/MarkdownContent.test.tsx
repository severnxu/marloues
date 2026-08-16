import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  hasUnclosedCodeFence,
  parseProgressiveMarkdownBlocks,
  splitIncrementalMarkdown,
  WorkflowMarkdownContent,
} from "../../../../../../../client/renderer/src/components/workflow-chat/content/MarkdownContent";

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

describe("splitIncrementalMarkdown", () => {
  it("treats everything before the last blank line as settled", () => {
    const result = splitIncrementalMarkdown("# H\n\nP1\n\nP2");
    expect(result.settledBlocks.join("|")).toContain("# H");
    expect(result.settledBlocks.join("|")).toContain("P1");
    expect(result.pending).toBe("P2");
    expect(result.pendingIsCode).toBe(false);
  });

  it("keeps settled blocks byte-stable while content is appended", () => {
    const settled1 = splitIncrementalMarkdown("# H\n\nP1\n\nP2").settledBlocks;
    const settled2 = splitIncrementalMarkdown("# H\n\nP1\n\nP2\n\nP3").settledBlocks;
    expect(settled2.slice(0, settled1.length)).toEqual(settled1);
  });

  it("keeps a growing paragraph inside pending until a blank line appears", () => {
    expect(splitIncrementalMarkdown("P1\n\nP2").pending).toBe("P2");
    expect(splitIncrementalMarkdown("P1\n\nP2\n\nP3").pending).toBe("P3");
    expect(splitIncrementalMarkdown("P1\n\nP2\n\n").pending).toBe("");
  });

  it("treats a single growing paragraph without blank lines as pending", () => {
    const result = splitIncrementalMarkdown("line1\nline2");
    expect(result.settledBlocks).toEqual([]);
    expect(result.pending).toBe("line1\nline2");
  });

  it("isolates an unclosed code fence as a plain-text pending block", () => {
    const result = splitIncrementalMarkdown("~~~js\nconst answer = 42;");
    expect(result.settledBlocks).toEqual([]);
    expect(result.pending).toBe("~~~js\nconst answer = 42;");
    expect(result.pendingIsCode).toBe(true);
  });

  it("settles a closed code fence entirely", () => {
    const result = splitIncrementalMarkdown("~~~js\nconst answer = 42;\n~~~");
    expect(result.settledBlocks).toEqual(["~~~js\nconst answer = 42;\n~~~"]);
    expect(result.pending).toBe("");
  });

  it("keeps text before an unclosed fence settled", () => {
    const result = splitIncrementalMarkdown("P1\n\n~~~js\ncode");
    expect(result.settledBlocks).toEqual(["P1"]);
    expect(result.pending).toBe("~~~js\ncode");
    expect(result.pendingIsCode).toBe(true);
  });

  it("renders an unclosed code fence without parsing or highlighting", () => {
    const html = renderToStaticMarkup(
      <WorkflowMarkdownContent content={"~~~js\nconst answer = 42;"} streaming />,
    );
    expect(html).not.toContain("hljs");
    expect(html).toContain("const answer = 42;");
  });

  it("streams a code fence incrementally: settled prefix stays markdown, open tail stays plain", () => {
    // 流式中间态：前面的段落已完成，代码块还在增长
    const midHtml = renderToStaticMarkup(
      <WorkflowMarkdownContent content={"# H\n\n~~~js\nconst a = 1;\nconst b = 2;"} streaming />,
    );
    expect(midHtml).toContain("<h1>");
    expect(midHtml).not.toContain("hljs");
    expect(midHtml).toContain("const b = 2;");

    // 闭合后：整块走高亮
    const closedHtml = renderToStaticMarkup(
      <WorkflowMarkdownContent content={"# H\n\n~~~js\nconst a = 1;\nconst b = 2;\n~~~"} streaming />,
    );
    expect(closedHtml).toContain("<h1>");
    expect(closedHtml).toContain("hljs");
  });

  it("keeps a growing paragraph in the pending slot while prior blocks stay settled", () => {
    const step1 = splitIncrementalMarkdown("P1\n\nP2");
    const step2 = splitIncrementalMarkdown("P1\n\nP2 longer");
    const step3 = splitIncrementalMarkdown("P1\n\nP2 longer still");
    expect(step1.settledBlocks).toEqual(step2.settledBlocks);
    expect(step2.settledBlocks).toEqual(step3.settledBlocks);
    expect(step1.pending).toBe("P2");
    expect(step3.pending).toBe("P2 longer still");
  });
});
