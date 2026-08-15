import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WorkflowUserMessage, formatUserMessageTime } from "./UserMessage";

describe("WorkflowUserMessage", () => {
  it("renders images, attachment context, body and icon-only metadata in contract order", () => {
    const html = renderToStaticMarkup(
      <WorkflowUserMessage
        content={[
          { type: "text", text: "正文" },
          { type: "file", name: "a.ts", mimeType: "text/typescript", text: "" },
          { type: "image", url: "data:image/png;base64,a", detail: "high" },
          {
            type: "skill",
            id: "s1",
            name: "imagegen",
            path: "C:/skills/imagegen/SKILL.md",
          },
        ]}
        createdAt={Date.now()}
        onCopy={vi.fn()}
        onEdit={vi.fn()}
      />,
    );
    expect(html.indexOf('data-kind="user-message-images"')).toBeLessThan(
      html.indexOf('data-kind="user-message-attachments"'),
    );
    expect(html.indexOf('data-kind="user-message-attachments"')).toBeLessThan(
      html.indexOf('data-kind="user-message-bubble"'),
    );
    expect(html).toContain('title="复制这条消息"');
    expect(html).toContain('title="编辑这条消息"');
    expect(html).not.toContain(">复制<");
  });

  it("does not render an avatar or user label", () => {
    const html = renderToStaticMarkup(<WorkflowUserMessage text="hello" />);
    expect(html).not.toContain("avatar");
    expect(html).not.toContain(">你<");
  });

  it("renders attachment-only user input", () => {
    const html = renderToStaticMarkup(
      <WorkflowUserMessage
        content={[{ type: "mention", name: "App.tsx", path: "src/App.tsx" }]}
      />,
    );
    expect(html).toContain("@App.tsx");
    expect(html).not.toContain('data-kind="user-message-bubble"');
  });

  it("renders safe link semantics and image detail hover metadata", () => {
    const html = renderToStaticMarkup(
      <WorkflowUserMessage
        content={[
          { type: "url", url: "https://example.com", title: "示例" },
          {
            type: "image",
            url: "https://example.com/a.png",
            detail: "original",
          },
        ]}
      />,
    );
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("点击放大 · original");
  });

  it("collapses likely-long user text to twenty accessible lines", () => {
    const text = Array.from({ length: 21 }, (_, index) => `line ${index}`).join(
      "\n",
    );
    const html = renderToStaticMarkup(<WorkflowUserMessage text={text} />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("展开");
  });

  it("formats an absent timestamp defensively", () => {
    expect(formatUserMessageTime()).toBe("--:--");
  });
});
