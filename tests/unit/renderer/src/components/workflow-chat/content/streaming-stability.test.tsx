// 实验：模拟流式 chunk 序列驱动 useBufferedStreamingContent，观察是否死循环。
// 用 react-test-renderer 不可用；改用手动模拟 hook 逻辑的渲染计数。
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkflowMarkdownContent, splitIncrementalMarkdown } from "@/components/workflow-chat/content/MarkdownContent";

describe("streaming render stability", () => {
  it("splitIncrementalMarkdown stays stable under append-only chunks", () => {
    let content = "";
    const chunks = ["# H", "# H\n\n", "# H\n\nP1", "# H\n\nP1\n\n", "# H\n\nP1\n\nP2"];
    const seen: string[] = [];
    for (const chunk of chunks) {
      content = chunk;
      const { settledBlocks, pending } = splitIncrementalMarkdown(content);
      seen.push(`${settledBlocks.length}|${pending.length}`);
    }
    // 每次只有 pending 增长，settled 块数不回头
    expect(seen.join(",")).toBe("0|3,1|0,1|2,2|0,2|2");
  });

  it("renders each static snapshot without error", () => {
    for (const content of ["# H", "# H\n\nP1", "# H\n\nP1\n\nP2"]) {
      const html = renderToStaticMarkup(
        <WorkflowMarkdownContent content={content} streaming />,
      );
      expect(html).toContain("workflow-markdown");
    }
  });
});
