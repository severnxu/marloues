import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkflowCommandDetail } from "../../../../../../../client/renderer/src/components/workflow-chat/activity/CommandDetailCard";
import type { CommandPresentation } from "../../../../../../../client/renderer/src/components/workflow-chat/activity/command-presentation";

const presentation: CommandPresentation = {
  detailOutput: "71 tests passed",
  failed: false,
  hasDetail: true,
  input: "npm test",
  kind: "command",
  label: "已运行 npm test",
  meta: "npm test",
  running: false,
  shell: "PowerShell",
  statusKind: "success",
  statusText: "成功",
};

describe("WorkflowCommandDetail", () => {
  it("renders semantic command and output sections with copy controls", () => {
    const html = renderToStaticMarkup(
      <WorkflowCommandDetail presentation={presentation} />,
    );

    expect(html).toContain("workflow-command-detail");
    expect(html).toContain("workflow-activity-detail-surface");
    expect(html).toContain("workflow-command-status is-success");
    expect(html.match(/workflow-detail-copy-button/g)).toHaveLength(2);
    expect(html).not.toContain("workflow-command-card");
  });

  it("uses an explicit error status and error output tone", () => {
    const html = renderToStaticMarkup(
      <WorkflowCommandDetail
        presentation={{
          ...presentation,
          failed: true,
          statusKind: "failed",
          statusText: "失败",
        }}
      />,
    );

    expect(html).toContain("workflow-command-status is-failed");
    expect(html).toContain("workflow-command-code is-danger");
  });
});
