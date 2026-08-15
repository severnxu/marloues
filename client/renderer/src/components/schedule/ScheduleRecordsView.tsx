import { useEffect, useMemo, useState } from "react";
import type {
  ScheduledTaskRecord,
  ScheduledTaskRunRecord,
  ScheduledTaskRunStatus,
} from "@shared/types";
import { useScheduleStore } from "@/stores/schedule-store";
import { useScheduleRecordsFilter } from "@/stores/schedule-view-store";
import { ScheduleSelect } from "./ScheduleSelect";
import styles from "./SchedulePage.module.css";

type StatusFilter = "all" | ScheduledTaskRunStatus;
type EnrichedRun = ScheduledTaskRunRecord & { task?: ScheduledTaskRecord };

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "running", label: "运行中" },
  { value: "success", label: "成功" },
  { value: "failed", label: "失败" },
  { value: "missed", label: "错过" },
  { value: "no_window", label: "无窗口" },
];

function statusToVariant(
  status: ScheduledTaskRunStatus,
): "ok" | "err" | "warn" | "run" {
  if (status === "success") return "ok";
  if (status === "failed") return "err";
  if (status === "running") return "run";
  return "warn";
}

function statusLabel(status: ScheduledTaskRunStatus): string {
  switch (status) {
    case "success":
      return "成功";
    case "failed":
      return "失败";
    case "running":
      return "运行中";
    case "missed":
      return "错过";
    case "no_window":
      return "无窗口";
  }
}

function formatRunTime(timestamp: number | undefined): string {
  if (!timestamp) return "—";
  const date = new Date(timestamp);
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const dayStart = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
  const time = date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  if (dayStart === startOfToday) return `今天 ${time}`;
  if (dayStart === startOfToday - 86_400_000) return `昨天 ${time}`;
  return `${date.getMonth() + 1}/${date.getDate()} ${time}`;
}

export function ScheduleRecordsView({
  onOpenSession,
}: {
  onOpenSession: (sessionId: string) => void;
}) {
  const tasks = useScheduleStore((state) => state.tasks);
  const runs = useScheduleStore((state) => state.runs);
  const loadAllRuns = useScheduleStore((state) => state.loadAllRuns);
  const filterTaskId = useScheduleRecordsFilter((state) => state.taskId);
  const setFilterTaskId = useScheduleRecordsFilter((state) => state.set);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  useEffect(() => {
    if (tasks.length > 0) void loadAllRuns();
  }, [tasks.length, loadAllRuns]);

  useEffect(() => () => setFilterTaskId(null), [setFilterTaskId]);

  const allRuns = useMemo(() => {
    const taskMap = new Map(tasks.map((task) => [task.id, task]));
    const result: EnrichedRun[] = [];
    for (const taskId in runs) {
      for (const run of runs[taskId]) {
        result.push({ ...run, task: taskMap.get(run.taskId) });
      }
    }
    return result.sort(
      (left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0),
    );
  }, [tasks, runs]);

  const filtered = useMemo(
    () =>
      allRuns.filter((run) => {
        if (filterTaskId && run.taskId !== filterTaskId) return false;
        return statusFilter === "all" || run.status === statusFilter;
      }),
    [allRuns, filterTaskId, statusFilter],
  );

  const openRun = (run: EnrichedRun) => {
    if (run.sessionId) onOpenSession(run.sessionId);
  };

  return (
    <div className={styles.scheduledPanel} data-scheduled-panel="records">
      <header className={styles.scheduledRecordHeader}>
        <div>
          <strong>全部执行记录</strong>
          <span>按执行时间倒序，跨任务汇总</span>
        </div>
        <ScheduleSelect
          ariaLabel="按执行结果筛选"
          prefix="结果"
          value={statusFilter}
          options={STATUS_OPTIONS}
          className={styles.scheduledFilter}
          onChange={(value) => setStatusFilter(value as StatusFilter)}
        />
      </header>

      <div className={styles.scheduledRecordList}>
        {filtered.length === 0 ? (
          <div className={styles.scheduledEmpty}>
            <strong>暂无执行记录</strong>
            <span>任务执行后，记录会按时间倒序显示在这里。</span>
          </div>
        ) : (
          filtered.map((run) => {
            const variant = statusToVariant(run.status);
            return (
              <button
                key={run.id}
                type="button"
                disabled={!run.sessionId}
                onClick={() => openRun(run)}
                aria-label={`${run.task?.name ?? "已删除任务"}，${statusLabel(run.status)}，${formatRunTime(run.startedAt ?? run.createdAt)}`}
              >
                {run.status === "running" ? (
                  <span className={styles.scheduledRecordSpinner} />
                ) : run.status === "failed" ? (
                  <span className={styles.scheduledRecordFailed}>×</span>
                ) : (
                  <span
                    className={styles.scheduledRecordTaskDot}
                    data-status={variant}
                  />
                )}
                <span className={styles.scheduledRecordTaskName}>
                  {run.task?.name ?? "（已删除任务）"}
                </span>
                <span
                  className={styles.scheduledRecordStatus}
                  data-status={variant}
                >
                  {statusLabel(run.status)}
                </span>
                <time className={styles.scheduledRecordTime}>
                  {formatRunTime(run.startedAt ?? run.createdAt)}
                </time>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
