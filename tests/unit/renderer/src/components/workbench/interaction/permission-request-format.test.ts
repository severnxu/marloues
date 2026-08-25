import { describe, expect, it } from "vitest";
import type { PermissionDialogRequest } from "@shared/types";
import { formatPermissionRequest } from "../../../../../../../client/renderer/src/components/workbench/interaction/permission-request-format";

function request(
  toolName: string,
  input: Record<string, unknown>,
  description?: string,
): PermissionDialogRequest {
  const reason = JSON.stringify({ displayName: toolName, description, input });
  return {
    id: `request-${toolName}`,
    toolName,
    reason,
    inputSummary: reason,
  };
}

describe("formatPermissionRequest", () => {
  it("maps a Bash request to the reviewed command presentation", () => {
    const details = formatPermissionRequest(
      request("Bash", { command: "npm run test" }),
    );

    expect(details).toEqual({
      title: "允许 Marloues 运行命令？",
      description: "此命令将在当前工作区执行。请确认后继续任务。",
      summary: { kind: "command", value: "npm run test" },
    });
  });

  it("builds a file summary and patch for an edit request", () => {
    const details = formatPermissionRequest(
      request("Edit", {
        file_path: "C:\\workspace\\marloues\\src\\Workbench.tsx",
        old_string: "const open = false;",
        new_string: "const open = true;",
      }),
    );

    expect(details.title).toBe("允许 Marloues 修改文件？");
    expect(details.summary).toMatchObject({
      kind: "file",
      value: "C:\\workspace\\marloues\\src\\Workbench.tsx",
    });
    expect(
      details.summary?.kind === "file" && details.summary.diffPatch,
    ).toContain("*** Update File: C:\\workspace\\marloues\\src\\Workbench.tsx");
  });

  it("does not expose structured policy JSON as fallback copy", () => {
    const reason = JSON.stringify({ decision: "requires approval" });
    const details = formatPermissionRequest({
      id: "request-tool",
      toolName: "CustomTool",
      reason,
      inputSummary: reason,
    });

    expect(details.description).toBe("此工具需要你的确认才能继续运行。");
    expect(details.description).not.toContain("decision");
  });

  it("shows the security boundary reason before the model tool description", () => {
    const reason = JSON.stringify({
      decision: "Path is outside the current workspace.",
      description: "Write elevated marker file",
      input: { command: "Set-Content C:\\outside.txt ok" },
    });
    const details = formatPermissionRequest({
      id: "request-elevation",
      toolName: "Bash",
      reason,
      inputSummary: JSON.stringify({
        command: "Set-Content C:\\outside.txt ok",
        description: "Write elevated marker file",
      }),
    });

    expect(details.description).toContain("工作区之外");
    expect(details.description).not.toContain("elevated marker");
  });
});
