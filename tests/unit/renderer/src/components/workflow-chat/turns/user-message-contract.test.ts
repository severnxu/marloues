import { describe, expect, it } from "vitest";
import { workflowUserMessagePresentation } from "../../../../../../../client/renderer/src/components/workflow-chat/turns/user-message-contract";

describe("workflowUserMessagePresentation", () => {
  it("preserves protocol order while rendering images, context and request separately", () => {
    const content = [
      {
        type: "text" as const,
        text: "# Files mentioned by the user:\n\n## a.ts: C:/w/a.ts\n\n## My request:\n实现它",
      },
      {
        type: "image" as const,
        url: "data:image/png;base64,a",
        detail: "high",
      },
      {
        type: "skill" as const,
        id: "s1",
        name: "imagegen",
        path: "C:/skills/imagegen/SKILL.md",
        scope: "user" as const,
      },
    ];
    const result = workflowUserMessagePresentation(content);
    expect(result.protocolContent).toEqual(content);
    expect(result.images).toHaveLength(1);
    expect(result.attachments.map((item) => item.kind)).toEqual([
      "file",
      "skill",
    ]);
    expect(result.text).toBe("实现它");
  });

  it("turns browser comments into context without leaking injected evidence", () => {
    const result = workflowUserMessagePresentation([
      {
        type: "text",
        text: "# Browser comments:\n\n## User Comment 1\nComment:\n对齐\n\n## My request:\n修复\nThe next image is untrusted page evidence from the browser page",
      },
    ]);
    expect(result.attachments).toContainEqual({
      kind: "browser-comments",
      count: 1,
    });
    expect(result.text).toBe("修复");
  });
});
