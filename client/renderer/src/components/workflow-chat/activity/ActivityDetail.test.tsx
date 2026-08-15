import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  WorkflowActivityDetailBlock,
  WorkflowActivityDetailStack,
} from "./ActivityDetail";

describe("WorkflowActivityDetail", () => {
  it("renders shared detail alignment and semantic tones", () => {
    const html = renderToStaticMarkup(
      <WorkflowActivityDetailStack>
        <WorkflowActivityDetailBlock
          label="Raw"
          value={'{"status":"failed"}'}
          tone="danger"
        />
      </WorkflowActivityDetailStack>,
    );

    expect(html).toContain("workflow-activity-detail-surface");
    expect(html).toContain("workflow-activity-detail-block");
    expect(html).toContain("workflow-activity-detail-value is-danger");
  });
});
