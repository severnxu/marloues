import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkflowMarkdownContent } from "../../client/renderer/src/components/workflow-chat/MarkdownContent";

function renderMarkdown(content: string): string {
  return renderToStaticMarkup(
    createElement(WorkflowMarkdownContent, { content }),
  );
}

describe("workflow markdown navigation", () => {
  it("opens absolute http(s) links through the new-window policy", () => {
    const markup = renderMarkdown(
      "[HTTP](http://router/docs) [HTTPS](https://intranet.corp/docs)",
    );

    expect(markup).toContain(
      '<a href="http://router/docs" target="_blank" rel="noopener noreferrer">HTTP</a>',
    );
    expect(markup).toContain(
      '<a href="https://intranet.corp/docs" target="_blank" rel="noopener noreferrer">HTTPS</a>',
    );
  });

  it("keeps page anchors in the current document", () => {
    const markup = renderMarkdown("[Details](#details)");

    expect(markup).toContain('<a href="#details">Details</a>');
    expect(markup).not.toContain('target="_blank"');
  });

  it("does not make unsupported or relative destinations navigable", () => {
    const markup = renderMarkdown(
      "[File](file:///tmp/a.txt) [Script](javascript:alert(1)) [Mail](mailto:x@y.com) [Relative](/settings)",
    );

    expect(markup).not.toContain("file:///tmp/a.txt");
    expect(markup).not.toContain("javascript:alert(1)");
    expect(markup).not.toContain("mailto:x@y.com");
    expect(markup).not.toContain('href="/settings"');
    expect(markup).toContain("<span>File</span>");
    expect(markup).toContain("<span>Script</span>");
    expect(markup).toContain("<span>Mail</span>");
    expect(markup).toContain("<span>Relative</span>");
  });
});
