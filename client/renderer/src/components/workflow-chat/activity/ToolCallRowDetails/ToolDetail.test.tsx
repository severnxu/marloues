import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ToolDetail } from "./ToolDetail";

describe("ToolDetail", () => {
  it("presents a completed image generation as generated", () => {
    const html = renderToStaticMarkup(
      <ToolDetail
        item={{
          type: "imageGeneration",
          id: "image-generation",
          status: "completed",
          revisedPrompt: "A quiet three-pane desktop workbench.",
        }}
        failed={false}
        cancellable={false}
        isCancelling={false}
      />,
    );

    expect(html).toContain("Image generated");
    expect(html).not.toContain("Generating image");
  });

  it("does not present a cancelled tool as successful", () => {
    const html = renderToStaticMarkup(
      <ToolDetail
        item={{
          type: "dynamicToolCall",
          id: "cancelled-tool",
          tool: "tool_search",
          status: "cancelled",
          arguments: { query: "browser automation" },
        }}
        failed={false}
        cancellable={false}
        isCancelling={false}
      />,
    );

    expect(html).toContain("workflow-tool-detail-status is-stopped");
    expect(html).toContain("已停止");
    expect(html).not.toContain("workflow-tool-detail-status is-success");
  });

  it("renders structured web search details through the shared frame", () => {
    const html = renderToStaticMarkup(
      <ToolDetail
        item={{
          type: "webSearch",
          id: "web-search",
          status: "completed",
          action: {
            type: "search",
            query: "semantic design tokens",
            queries: ["semantic design tokens", "css token migration"],
          },
        }}
        failed={false}
        cancellable={false}
        isCancelling={false}
      />,
    );

    expect(html).toContain("Web search");
    expect(html).toContain("semantic design tokens");
    expect(html).toContain("css token migration");
    expect(html).toContain("workflow-tool-detail-status is-success");
  });
});
