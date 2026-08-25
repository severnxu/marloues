import type { TaskPresentationModel } from "./task-presentation-model";
import { CONVERSATION_ICONS } from "../conversation-icon-contract";
import {
  ThreadSummaryExpandableList,
  ThreadSummarySection,
} from "./ThreadSummaryPrimitives";

const SUMMARY_ICONS = CONVERSATION_ICONS.summary;

export function WorkspaceContextSection({
  sessionId,
  model,
  gitLoading,
  onOpenWorkspace,
  onOpenChanges,
  onRefresh,
}: {
  sessionId: string | null;
  model: TaskPresentationModel;
  gitLoading: boolean;
  onOpenWorkspace: () => void;
  onOpenChanges?: () => void;
  onRefresh: () => void;
}) {
  const workspace = model.workspace;
  const git = workspace?.git;
  const showGitRow = gitLoading || Boolean(git);
  const gitRowLabel = git?.isRepository ? "分支" : "Git";
  const gitDetail = gitLoading
    ? "检测中"
    : git?.isRepository
      ? git.branch || "未检测到分支"
      : "未初始化";
  const branchSyncDetail =
    git?.isRepository && (git.ahead || git.behind)
      ? `${git.ahead ? `↑${git.ahead}` : ""}${
          git.ahead && git.behind ? " " : ""
        }${git.behind ? `↓${git.behind}` : ""}`
      : undefined;
  const showChanges = Boolean(model.changes || git?.isRepository);
  return (
    <ThreadSummarySection
      sectionKey="workspace"
      sessionId={sessionId}
      title={workspace?.name ?? "工作区"}
      after={
        <button
          type="button"
          className="thread-summary-icon-button"
          onClick={onRefresh}
          aria-label="刷新工作区状态"
          title="刷新工作区状态"
        >
          <SUMMARY_ICONS.refresh
            className={gitLoading ? "is-spinning" : ""}
            size={14}
            data-icon-contract="summary-refresh"
          />
        </button>
      }
    >
      {showChanges ? (
        <button
          type="button"
          className="task-context-row task-context-change-row"
          onClick={onOpenChanges}
          disabled={!model.changes?.reviewTarget || !onOpenChanges}
        >
          <SUMMARY_ICONS.changes
            size={15}
            data-icon-contract="summary-changes"
          />
          <span>变更</span>
          {model.changes ? (
            <ChangeStats changes={model.changes} />
          ) : (
            <small className="task-context-row-detail">无变更</small>
          )}
        </button>
      ) : null}
      {workspace ? (
        <button
          type="button"
          className="task-context-row"
          onClick={onOpenWorkspace}
          title={workspace.path}
        >
          <SUMMARY_ICONS.workspace
            size={15}
            data-icon-contract="summary-workspace"
          />
          <span>本地</span>
          <small className="task-context-row-detail">{workspace.path}</small>
        </button>
      ) : null}
      {showGitRow ? (
        <div className="task-context-row" title={git?.upstream}>
          <SUMMARY_ICONS.branch size={15} data-icon-contract="summary-branch" />
          <span>{gitRowLabel}</span>
          <small className="task-context-row-detail">
            {gitDetail}
            {branchSyncDetail ? ` ${branchSyncDetail}` : ""}
          </small>
        </div>
      ) : null}
      {model.modelName ? (
        <div className="task-context-row">
          <SUMMARY_ICONS.model size={15} data-icon-contract="summary-model" />
          <span>模型</span>
          <small className="task-context-row-detail">{model.modelName}</small>
        </div>
      ) : null}
      {model.permissionMode ? (
        <div className="task-context-row">
          <SUMMARY_ICONS.permission
            size={15}
            data-icon-contract="summary-permission"
          />
          <span>权限</span>
          <small className="task-context-row-detail">
            {permissionModeLabel(model.permissionMode)}
          </small>
        </div>
      ) : null}
    </ThreadSummarySection>
  );
}

export function TaskProgressSection({
  sessionId,
  tasks,
}: {
  sessionId: string | null;
  tasks: TaskPresentationModel["tasks"];
}) {
  if (!tasks.length) return null;
  const complete = tasks.every((task) => task.status === "completed");
  return (
    <ThreadSummarySection
      sectionKey="tasks"
      sessionId={sessionId}
      title="任务进度"
      count={tasks.length}
      autoCollapse={complete}
    >
      <ThreadSummaryExpandableList
        items={tasks}
        scopeKey={`${sessionId ?? "none"}:tasks`}
        ariaLabel="任务进度"
        getKey={(task) => task.id}
        renderItem={(task) => {
          const completed = task.status === "completed";
          const Icon = completed
            ? SUMMARY_ICONS.taskCompleted
            : SUMMARY_ICONS.taskPending;
          return (
            <div className={`task-context-row task-status-${task.status}`}>
              <Icon
                className={task.status === "running" ? "is-spinning" : ""}
                size={15}
                data-icon-contract={
                  completed ? "summary-task-completed" : "summary-task-pending"
                }
              />
              <span title={task.detail ?? task.title}>{task.title}</span>
            </div>
          );
        }}
      />
    </ThreadSummarySection>
  );
}

export function OutputContentSection({
  sessionId,
  outputContent,
}: {
  sessionId: string | null;
  outputContent: TaskPresentationModel["outputContent"];
}) {
  if (!outputContent.length) return null;
  return (
    <ThreadSummarySection
      sectionKey="output-content"
      sessionId={sessionId}
      title="输出内容"
      count={outputContent.length}
    >
      <ThreadSummaryExpandableList
        items={outputContent}
        scopeKey={`${sessionId ?? "none"}:output-content`}
        ariaLabel="输出内容"
        getKey={(item) => item.id}
        renderItem={(item) => (
          <div className="task-context-row" title={item.detail}>
            <SUMMARY_ICONS.outputContent
              size={15}
              data-icon-contract="summary-output-content"
            />
            <span>{item.label}</span>
            <small className="task-context-row-detail">{item.detail}</small>
          </div>
        )}
      />
    </ThreadSummarySection>
  );
}

export function BackgroundProcessesSection({
  sessionId,
  processes,
}: {
  sessionId: string | null;
  processes: TaskPresentationModel["processes"];
}) {
  if (!processes.length) return null;
  return (
    <ThreadSummarySection
      sectionKey="processes"
      sessionId={sessionId}
      title="后台进程"
      count={processes.length}
    >
      <ThreadSummaryExpandableList
        items={processes}
        scopeKey={`${sessionId ?? "none"}:processes`}
        ariaLabel="后台进程"
        getKey={(process) => process.id}
        renderItem={(process) => (
          <div className="task-context-row is-running">
            <SUMMARY_ICONS.process
              size={15}
              data-icon-contract="summary-process"
            />
            <span title={process.command}>{process.command}</span>
          </div>
        )}
      />
    </ThreadSummarySection>
  );
}

export function SourcesSection({
  sessionId,
  sources,
}: {
  sessionId: string | null;
  sources: TaskPresentationModel["sources"];
}) {
  if (!sources.length) return null;
  return (
    <ThreadSummarySection
      sectionKey="sources"
      sessionId={sessionId}
      title="来源"
      count={sources.length}
    >
      <ThreadSummaryExpandableList
        items={sources}
        scopeKey={`${sessionId ?? "none"}:sources`}
        ariaLabel="来源"
        getKey={(source) => source.id}
        renderItem={(source) => {
          const Icon =
            source.kind === "web"
              ? SUMMARY_ICONS.webSource
              : SUMMARY_ICONS.mcpSource;
          return (
            <div className="task-context-row" title={source.detail}>
              <Icon
                size={15}
                data-icon-contract={
                  source.kind === "web"
                    ? "summary-web-source"
                    : "summary-mcp-source"
                }
              />
              <span>{source.label}</span>
              {source.count > 1 ? (
                <small className="task-context-row-detail">
                  {source.count} 次
                </small>
              ) : null}
            </div>
          );
        }}
      />
    </ThreadSummarySection>
  );
}

function ChangeStats({
  changes,
}: {
  changes: NonNullable<TaskPresentationModel["changes"]>;
}) {
  return (
    <small className="task-context-change-stats">
      <span>{changes.filesChanged} 个文件</span>
      {changes.insertions ? (
        <b className="is-addition">+{changes.insertions}</b>
      ) : null}
      {changes.deletions ? (
        <b className="is-deletion">-{changes.deletions}</b>
      ) : null}
    </small>
  );
}

function permissionModeLabel(mode: string): string {
  if (mode === "bypassPermissions") return "完全访问";
  if (mode === "acceptEdits") return "自动编辑";
  return "按需批准";
}
