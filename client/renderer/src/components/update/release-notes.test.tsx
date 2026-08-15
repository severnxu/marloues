import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderReleaseNotes } from "./release-notes";

describe("release-notes safe renderer", () => {
  it("returns empty array for null/undefined/empty input", () => {
    expect(renderReleaseNotes(undefined)).toEqual([]);
    expect(renderReleaseNotes("")).toEqual([]);
    expect(renderReleaseNotes("   \n\n   ")).toEqual([]);
  });

  it("renders headings, lists, code, bold, links as safe HTML", () => {
    const md = [
      "# 新版本说明",
      "",
      "## 功能",
      "",
      "- 支持 **多窗口**",
      "- 使用 `RUN_ALL` 命令",
      "",
      "### 修复",
      "",
      "修复 [issue](https://example.com/issues/1)。",
    ].join("\n");
    const html = renderToStaticMarkup(<>{renderReleaseNotes(md)}</>);
    expect(html).toContain("新版本说明");
    expect(html).toContain("<strong>多窗口</strong>");
    expect(html).toContain('class="release-notes-inline-code"');
    expect(html).toContain('href="https://example.com/issues/1"');
  });

  it("strips raw HTML so <script>/<img onerror> cannot execute", () => {
    const malicious = [
      "## Changelog",
      "",
      '<script>alert("xss")</script>',
      "",
      '<img src=x onerror="alert(1)">',
    ].join("\n");
    const html = renderToStaticMarkup(<>{renderReleaseNotes(malicious)}</>);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror=");
  });

  it("rejects unsafe URL protocols and falls back to plain text", () => {
    const md = "[click](javascript:alert(1)) and [ok](data:text/html,abc)";
    const html = renderToStaticMarkup(<>{renderReleaseNotes(md)}</>);
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:text/html");
    // 链接降级为纯文本
    expect(html).toContain("click");
  });

  it("escapes ampersands in normal paragraphs", () => {
    const html = renderToStaticMarkup(<>{renderReleaseNotes("Tom & Jerry")}</>);
    expect(html).toContain("Tom &amp; Jerry");
    expect(html).not.toContain("Tom & Jerry");
  });
});
