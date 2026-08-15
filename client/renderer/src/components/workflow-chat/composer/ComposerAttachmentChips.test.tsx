import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ComposerAttachmentChips } from "./ComposerAttachmentChips";

describe("ComposerAttachmentChips", () => {
  it("renders one scrollable attachment band with semantic file metadata", () => {
    const html = renderToStaticMarkup(
      <ComposerAttachmentChips
        attachments={[
          {
            kind: "file",
            id: "file-1",
            name: "notes.md",
            mimeType: "text/markdown",
            text: "# Notes",
            size: 12 * 1024,
          },
          {
            kind: "url",
            id: "url-1",
            url: "https://example.com/reference",
          },
        ]}
        onRemove={vi.fn()}
        onPreviewImage={vi.fn()}
      />,
    );

    expect(html).toContain('class="composer-attachments"');
    expect(html).toContain("MD · 12 KB");
    expect(html).toContain('class="composer-chip-link"');
    const linkMarkup = html.match(
      /<a class="composer-chip-link"[\s\S]*?<\/a>/,
    )?.[0];
    expect(linkMarkup).toBeDefined();
    expect(linkMarkup).not.toContain("<button");
  });

  it("does not reserve attachment height in the zero state", () => {
    const html = renderToStaticMarkup(
      <ComposerAttachmentChips
        attachments={[]}
        onRemove={vi.fn()}
        onPreviewImage={vi.fn()}
      />,
    );

    expect(html).toBe("");
  });
});
