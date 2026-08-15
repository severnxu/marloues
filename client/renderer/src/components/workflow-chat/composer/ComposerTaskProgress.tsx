import {
  CheckCircle2,
  CircleDashed,
  ListChecks,
  LoaderCircle,
  XCircle,
} from "lucide-react";
import type { ExecutionTaskRecord } from "@/stores/unified-chat-store";

export function ComposerTaskProgress({
  tasks = [],
  fileChangeSummary,
  onFileChangeSummaryClick,
}: {
  tasks?: ExecutionTaskRecord[];
  fileChangeSummary?: {
    filesChanged: number;
    insertions?: number;
    deletions?: number;
  };
  onFileChangeSummaryClick?: () => void;
}) {
  const hasTasks = tasks.length > 0;
  const activeIndex = tasks.findIndex(
    (task) => task.status === "creating" || task.status === "running",
  );
  const currentIndex = activeIndex >= 0 ? activeIndex : tasks.length - 1;

  return (
    <div className="composer-task-progress-anchor">
      <button
        type="button"
        className={`composer-task-progress ${hasTasks ? "is-task-progress" : "is-result-summary"}`}
        aria-haspopup={hasTasks ? "true" : undefined}
        aria-label={
          hasTasks
            ? `第 ${currentIndex + 1} / ${tasks.length} 步`
            : `查看 ${fileChangeSummary?.filesChanged ?? 0} 个已更改文件`
        }
        disabled={!hasTasks && !onFileChangeSummaryClick}
        onClick={onFileChangeSummaryClick}
      >
        {activeIndex >= 0 ? (
          <LoaderCircle
            size={13}
            className="composer-task-progress-spinner animate-spin"
            aria-hidden="true"
          />
        ) : null}
        {hasTasks ? (
          <span>
            第 {currentIndex + 1} / {tasks.length} 步
          </span>
        ) : null}
        {fileChangeSummary?.filesChanged ? (
          <>
            {hasTasks ? (
              <span className="composer-task-progress-dot">·</span>
            ) : null}
            <span>{fileChangeSummary.filesChanged} 个文件已更改</span>
            {fileChangeSummary.insertions ? (
              <strong className="composer-task-progress-added">
                +{fileChangeSummary.insertions}
              </strong>
            ) : null}
            {fileChangeSummary.deletions ? (
              <strong className="composer-task-progress-removed">
                -{fileChangeSummary.deletions}
              </strong>
            ) : null}
          </>
        ) : null}
      </button>
      {hasTasks ? (
        <div
          className="composer-task-popover"
          role="dialog"
          aria-label="任务列表"
        >
          <div className="composer-task-popover-head">
            <span>
              <ListChecks size={14} aria-hidden="true" />
              <strong>任务列表</strong>
            </span>
            <small>
              {tasks.filter((task) => task.status === "completed").length}/
              {tasks.length}
            </small>
          </div>
          <div className="composer-task-list" role="list">
            {tasks.map((task, index) => (
              <ComposerTaskTodoItem key={task.id} task={task} index={index} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ComposerTaskTodoItem({
  task,
  index,
}: {
  task: ExecutionTaskRecord;
  index: number;
}) {
  const StatusIcon =
    task.status === "completed"
      ? CheckCircle2
      : task.status === "failed"
        ? XCircle
        : task.status === "running"
          ? LoaderCircle
          : CircleDashed;

  return (
    <div
      className={`composer-task-item ${task.status}`}
      role="listitem"
      title={task.detail ?? task.title}
    >
      <StatusIcon
        size={15}
        className={task.status === "running" ? "animate-spin" : undefined}
        aria-hidden="true"
      />
      <span className="composer-task-item-index">{index + 1}</span>
      <span className="composer-task-item-copy">
        <strong>{task.title}</strong>
        {task.detail ? <small>{task.detail}</small> : null}
      </span>
      <span className="composer-task-item-status">
        {composerTaskStatusLabel(task.status)}
      </span>
    </div>
  );
}

function composerTaskStatusLabel(
  status: ExecutionTaskRecord["status"],
): string {
  if (status === "completed") return "已完成";
  if (status === "failed") return "失败";
  if (status === "running") return "进行中";
  return "待处理";
}
