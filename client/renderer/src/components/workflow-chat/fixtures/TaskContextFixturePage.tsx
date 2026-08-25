import { useMemo, useState } from "react";
import { WorkflowChatHeader } from "@/pages/WorkflowChatHeader";
import {
  TaskContextPanel,
  type TaskContextMode,
  type TaskPresentationModel,
} from "../task-context";

export function TaskContextFixturePage() {
  const params = new URLSearchParams(window.location.search);
  const requestedMode = (params.get("taskContextMode") ?? "docked") as
    "docked" | "floating";
  const empty = params.get("taskContextData") === "empty";
  const [visible, setVisible] = useState(true);
  const [notice, setNotice] = useState("");
  const model = useMemo(() => fixtureModel(!empty), [empty]);
  const mode: TaskContextMode =
    visible && model.hasData ? requestedMode : "hidden";
  const docked = mode === "docked";

  return (
    <section
      className={`chat-page has-inline-header${docked ? " task-context-docked" : ""}`}
      data-kind="task-context-fixture"
    >
      <WorkflowChatHeader
        title="重构任务页面侧栏"
        threadSummary={{
          available: model.hasData,
          open: mode !== "hidden",
          onToggle: () => setVisible((current) => !current),
        }}
      />
      <TaskContextPanel
        model={model}
        mode={mode}
        gitLoading={false}
        onRefresh={() => setNotice("工作区状态已刷新")}
        onCloseFloating={() => setVisible(false)}
        onOpenChanges={() => setNotice("已打开变更")}
      />
      <div className="messages-scroll scrollbar-thin">
        <main className="messages-inner task-context-fixture-document">
          <p className="task-context-fixture-kicker">契约核验</p>
          <h1>固定摘要属于主会话面</h1>
          <p>
            宽屏时固定在正文右侧，窄屏时由标题栏按钮打开为浮层；两种模式都避让
            输入组件，并保持内部独立滚动。
          </p>
          <h2>这次包含的内容</h2>
          <ul>
            <li>工作区、分支、变更与运行权限</li>
            <li>本轮 agent 回复对应的输出内容</li>
            <li>当前任务进度和仍在运行的后台命令</li>
            <li>网页搜索与 MCP 等本轮来源</li>
          </ul>
          {notice ? (
            <p className="task-context-fixture-notice">{notice}</p>
          ) : null}
        </main>
      </div>
    </section>
  );
}

function fixtureModel(hasData: boolean): TaskPresentationModel {
  return {
    sessionId: hasData ? "fixture-session" : "empty-session",
    hasData: true,
    workspace: {
      id: "fixture-workspace",
      name: hasData ? "marloues" : "tmp",
      path: hasData ? "C:\\workspace\\marloues" : "C:\\tmp",
      lastOpenedAt: Date.now(),
      git: hasData
        ? {
            isRepository: true,
            branch: "codex/task-context",
            upstream: "origin/codex/task-context",
            ahead: 2,
            behind: 0,
            changedFiles: 8,
            insertions: 523,
            deletions: 41,
          }
        : {
            isRepository: false,
            ahead: 0,
            behind: 0,
            changedFiles: 0,
            insertions: 0,
            deletions: 0,
          },
    },
    changes: hasData
      ? {
          filesChanged: 8,
          insertions: 523,
          deletions: 41,
          reviewTarget: { path: "src/renderer/src/App.tsx", diff: "+fixture" },
        }
      : null,
    modelName: hasData ? "Marloues 5.6" : undefined,
    permissionMode: hasData ? "bypassPermissions" : undefined,
    outputContent: hasData
      ? [
          {
            id: "agent-reply",
            label: "最终回复",
            detail:
              "已完成摘要按钮布局修正，并保留展开时辅助区按钮的原有逻辑。",
          },
        ]
      : [],
    tasks: hasData
      ? [
          {
            id: "task-1",
            ordinal: 1,
            title: "实现任务上下文投影",
            status: "completed",
            createdAt: 1,
            updatedAt: 2,
          },
          {
            id: "task-2",
            ordinal: 2,
            title: "核验响应式布局",
            status: "running",
            createdAt: 2,
            updatedAt: 3,
          },
        ]
      : [],
    processes: hasData
      ? [
          {
            id: "process-1",
            command: "npm run verify:workflow-visual",
            status: "running",
          },
        ]
      : [],
    sources: hasData
      ? [
          {
            id: "web-search",
            kind: "web",
            label: "网页搜索",
            detail: "Codex task context panel",
            count: 2,
          },
        ]
      : [],
  };
}
