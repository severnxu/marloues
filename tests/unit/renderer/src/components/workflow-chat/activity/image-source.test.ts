import { describe, expect, it } from "vitest";
import { workflowImageSource } from "../../../../../../../client/renderer/src/components/workflow-chat/activity/image-source";

describe("workflowImageSource", () => {
  it("preserves browser-loadable image sources", () => {
    const dataUri = "data:image/svg+xml,%3Csvg%2F%3E";

    expect(workflowImageSource(dataUri)).toBe(dataUri);
    expect(workflowImageSource("https://example.com/image.png")).toBe(
      "https://example.com/image.png",
    );
  });

  it("normalizes raw base64 and local Windows paths", () => {
    const rawBase64 = "a".repeat(128);

    expect(workflowImageSource(rawBase64)).toBe(
      `data:image/png;base64,${rawBase64}`,
    );
    expect(workflowImageSource("C:\\workspace\\output\\image.png")).toBe(
      "file:///C:/workspace/output/image.png",
    );
  });
});
