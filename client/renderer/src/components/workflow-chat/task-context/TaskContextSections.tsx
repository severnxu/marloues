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
  if (!workspace) return null;
  const git = workspace.git;
  return (
    <ThreadSummarySection
      sectionKey="workspace"
      sessionId={sessionId}
      title={workspace.name}
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
      {model.changes ? (
        <button
          type="button"
          className="task-context-row task-context-change-row"
          onClick={onOpenChanges}
          disabled={!onOpenChanges}
        >
          <SUMMARY_ICONS.changes
            size={15}
            data-icon-contract="summary-changes"
          />
          <span>变更</span>
          <ChangeStats changes={model.changes} />
        </button>
      ) : null}
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
      {git?.branch ? (
        <div className="task-context-row" title={git.upstream}>
          <SUMMARY_ICONS.branch size={15} data-icon-contract="summary-branch" />
          <span>{git.branch}</span>
          {git.ahead || git.behind ? (
            <small className="task-context-row-detail">
              {git.ahead ? `↑${git.ahead}` : ""}
              {git.ahead && git.behind ? " " : ""}
              {git.behind ? `↓${git.behind}` : ""}
            </small>
          ) : null}
        </div>
      ) : null}
      {model.modelName ? (
        <div className="task-context-row">
          <SUMMARY_ICONS.model size={15} data-icon-contract="summary-model" />
          <span>模型</span>
          <small className="task-context-row-detail">{model.modelName}</small>
        </div>
      ) : null}
      {model.securityMode ? (
        <div className="task-context-row">
          <SUMMARY_ICONS.permission
            size={15}
            data-icon-contract="summary-permission"
          />
          <span>权限</span>
          <small className="task-context-row-detail">
            {permissionModeLabel(model.securityMode)}
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
  if (mode === "full-access") return "完全访问";
  if (mode === "auto-review") return "帮我批准";
  return "请求批准";
}
