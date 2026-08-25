import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  OutputContentSection,
  WorkspaceContextSection,
} from "../../../../../../../client/renderer/src/components/workflow-chat/task-context/TaskContextSections";
import type { TaskPresentationModel } from "../../../../../../../client/renderer/src/components/workflow-chat/task-context/task-presentation-model";

describe("WorkspaceContextSection", () => {
  it("shows workspace and git state without change rows for a non-git workspace", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceContextSection
        sessionId="session-1"
        model={modelFixture({
          git: {
            isRepository: false,
            ahead: 0,
            behind: 0,
            changedFiles: 0,
            insertions: 0,
            deletions: 0,
          },
          changes: null,
        })}
        gitLoading={false}
        onOpenWorkspace={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    for (const label of ["本地", "Git", "模型", "权限"]) {
      expect(markup).toContain(label);
    }
    expect(markup).not.toContain("变更");
    expect(markup).not.toContain("分支");
    expect(markup).toContain("未初始化");
  });

  it("adds branch and changes context for a git workspace with changes", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceContextSection
        sessionId="session-1"
        model={modelFixture({
          git: {
            isRepository: true,
            branch: "main",
            upstream: "origin/main",
            ahead: 1,
            behind: 2,
            changedFiles: 3,
            insertions: 10,
            deletions: 4,
          },
          changes: {
            filesChanged: 3,
            insertions: 10,
            deletions: 4,
          },
        })}
        gitLoading={false}
        onOpenWorkspace={vi.fn()}
        onOpenChanges={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    for (const label of ["变更", "本地", "分支", "模型", "权限"]) {
      expect(markup).toContain(label);
    }
    expect(markup).toContain("main ↑1 ↓2");
    expect(markup).toContain("3 个文件");
  });
});

describe("OutputContentSection", () => {
  it("renders agent message output content", () => {
    const markup = renderToStaticMarkup(
      <OutputContentSection
        sessionId="session-1"
        outputContent={[
          {
            id: "agent-reply",
            label: "最终回复",
            detail: "已完成摘要按钮修复。",
          },
        ]}
      />,
    );

    expect(markup).toContain("输出内容");
    expect(markup).toContain("最终回复");
    expect(markup).toContain("已完成摘要按钮修复。");
  });
});

function modelFixture({
  git,
  changes,
}: {
  git: NonNullable<TaskPresentationModel["workspace"]>["git"];
  changes: TaskPresentationModel["changes"];
}): TaskPresentationModel {
  return {
    sessionId: "session-1",
    hasData: true,
    workspace: {
      id: "workspace-1",
      name: "marloues",
      path: "C:/workspace/marloues",
      lastOpenedAt: 1,
      git,
    },
    changes,
    modelName: "Marloues 5",
    securityMode: "request",
    outputContent: [],
    tasks: [],
    processes: [],
    sources: [],
  };
}
