import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CalendarClock,
  Copy,
  Edit3,
  Play,
  Repeat,
  Search,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import type {
  ScheduledTaskRecord,
  ScheduledTaskRunRecord,
  ScheduledTaskRunStatus,
} from "@shared/types";
import { describeCron, describeScheduleConfig } from "@shared/schedule";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useScheduleStore } from "@/stores/schedule-store";
import {
  scheduleViewActions,
  useScheduleViewStore,
} from "@/stores/schedule-view-store";
import {
  formatRelativeFuture,
  formatRelativePast,
  formatTimeShort,
} from "./format";
import { ScheduleSelect } from "./ScheduleSelect";
import { scheduleCopyInputFromTask } from "./schedule-form-model";
import styles from "./SchedulePage.module.css";

/* ─────────────────────────────────────────────────────
   状态语义：最近一次执行 / 任务开关
   ───────────────────────────────────────────────────── */
type StatusKind = "ok" | "err" | "warn" | "run" | "neutral";

function statusOf(task: ScheduledTaskRecord): {
  kind: StatusKind;
  label: string;
} {
  if (!task.enabled) {
    if (task.lastRunStatus === "missed")
      return { kind: "warn", label: "已错过" };
    if ((task.failCount ?? 0) >= 5) return { kind: "err", label: "失败暂停" };
    return { kind: "neutral", label: "已暂停" };
  }
  if (task.lastRunStatus === "success")
    return { kind: "ok", label: "最近成功" };
  if (task.lastRunStatus === "failed")
    return { kind: "err", label: "最近失败" };
  if (task.lastRunStatus === "missed")
    return { kind: "warn", label: "最近错过" };
  if (task.lastRunStatus === "no_window")
    return { kind: "warn", label: "无窗口" };
  if (task.lastRunStatus === "running") return { kind: "run", label: "运行中" };
  return { kind: "neutral", label: "待运行" };
}

function statusToVariant(s: ScheduledTaskRunStatus | undefined): StatusKind {
  if (s === "success") return "ok";
  if (s === "failed") return "err";
  if (s === "running") return "run";
  return "warn";
}

function StatusChip({ kind, label }: { kind: StatusKind; label: string }) {
  return (
    <span className={styles.scheduledStatus} data-variant={kind}>
      {label}
    </span>
  );
}

function formatRunTimeLabel(timestamp: number | undefined): string {
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

/* ─────────────────────────────────────────────────────
   状态筛选（4 选 1）
   ───────────────────────────────────────────────────── */
type StatusFilter = "all" | "enabled" | "disabled" | "success" | "failed";

const STATUS_FILTER_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "enabled", label: "已启用" },
  { value: "disabled", label: "已停用" },
  { value: "success", label: "成功" },
  { value: "failed", label: "失败" },
];

function matchesFilter(t: ScheduledTaskRecord, f: StatusFilter): boolean {
  switch (f) {
    case "all":
      return true;
    case "enabled":
      return t.enabled;
    case "disabled":
      return !t.enabled;
    case "success":
      return t.lastRunStatus === "success";
    case "failed":
      return t.lastRunStatus === "failed";
  }
}

function matchesSearch(t: ScheduledTaskRecord, q: string): boolean {
  if (!q.trim()) return true;
  const needle = q.trim().toLowerCase();
  return (
    t.name.toLowerCase().includes(needle) ||
    t.instruction.toLowerCase().includes(needle) ||
    t.workspacePath.toLowerCase().includes(needle) ||
    (t.metadata?.tags ?? []).some((tag) => tag.toLowerCase().includes(needle))
  );
}

/* ─────────────────────────────────────────────────────
   任务卡
   ───────────────────────────────────────────────────── */
function TaskCard({
  task,
  selected,
  onSelect,
  onToggle,
  onEdit,
  onDelete,
  onRunNow,
  onCopy,
  running,
}: {
  task: ScheduledTaskRecord;
  selected: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRunNow: () => void;
  onCopy: () => void;
  running: boolean;
}) {
  const st = statusOf(task);
  const isOnce = task.kind === "once";
  const disabled = !task.enabled;
  const summary = task.metadata
    ? describeScheduleConfig(task.metadata.schedule)
    : isOnce
      ? "一次性任务"
      : describeCron(task.cronExpr ?? "");
  const nextText = task.nextRunAt
    ? formatRelativeFuture(task.nextRunAt)
    : "未安排";
  const lastText = task.lastRunAt
    ? formatRelativePast(task.lastRunAt)
    : "尚未执行";
  const tags = task.metadata?.tags ?? [];
  const KindIcon = isOnce
    ? Zap
    : task.metadata?.schedule.mode === "cycle" &&
        task.metadata.schedule.cycleType !== "daily"
      ? CalendarClock
      : Repeat;

  return (
    <article
      className={styles.scheduledTaskCard}
      data-active={selected || undefined}
      data-disabled={disabled || undefined}
      role="button"
      tabIndex={0}
      aria-label={`查看任务详情：${task.name}`}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <div className={styles.scheduledTaskHead}>
        <span
          className={styles.scheduledTaskIcon}
          data-muted={disabled || undefined}
        >
          <KindIcon size={16} />
        </span>
        <div className={styles.scheduledTaskTitleGroup}>
          <strong>{task.name}</strong>
          <span>{summary}</span>
        </div>
        <StatusChip kind={st.kind} label={st.label} />
      </div>
      <div
        className={styles.scheduledTaskTags}
        data-empty={tags.length === 0 || undefined}
        aria-label="任务标签"
      >
        {tags.map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
      <div className={styles.scheduledTaskMain}>
        <span>
          <small>下次执行</small>
          <strong>{nextText}</strong>
        </span>
        <span>
          <small>上次执行</small>
          <strong>{lastText}</strong>
        </span>
      </div>
      <div
        className={styles.scheduledTaskActions}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label="编辑任务"
          title="编辑"
          onClick={onEdit}
        >
          <Edit3 size={13} />
        </button>
        <button
          type="button"
          aria-label="立即执行"
          title="立即运行"
          disabled={running}
          onClick={onRunNow}
        >
          <Play size={13} />
        </button>
        <button
          type="button"
          aria-label="复制任务"
          title="复制"
          onClick={onCopy}
        >
          <Copy size={13} />
        </button>
        <button
          type="button"
          aria-label="删除任务"
          title="删除"
          onClick={onDelete}
        >
          <Trash2 size={13} />
        </button>
        <button
          type="button"
          className={styles.scheduledSwitch}
          role="switch"
          aria-checked={task.enabled}
          aria-label={task.enabled ? "已启用，点击停用" : "已停用，点击启用"}
          title={task.enabled ? "已启用" : "已停用"}
          onClick={onToggle}
        >
          <span />
        </button>
      </div>
    </article>
  );
}

/* ─────────────────────────────────────────────────────
   详情面板
   ───────────────────────────────────────────────────── */
function DetailPanel({
  taskId,
  onClose,
  onOpenSession,
}: {
  taskId: string;
  onClose: () => void;
  onOpenSession: (sessionId: string) => void;
}) {
  const task = useScheduleStore((s) => s.tasks.find((t) => t.id === taskId));
  const runs = useScheduleStore((s) => s.runs[taskId]);
  const loadRuns = useScheduleStore((s) => s.loadRuns);

  // 首次打开时拉一次
  useEffect(() => {
    if (runs === undefined) {
      void loadRuns(taskId);
    }
  }, [taskId, runs, loadRuns]);

  if (!task) return null;

  return (
    <section className={styles.scheduledDetailPanel} aria-label="定时任务详情">
      <header className={styles.scheduledDetailPanelHeader}>
        <div className={styles.scheduledDetailTitleRow}>
          <strong>{task.name}</strong>
          <button
            type="button"
            className={styles.scheduledDetailClose}
            aria-label="关闭详情"
            title="关闭"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>
      </header>

      <div className={styles.scheduledDetailBody}>
        <div className={styles.scheduledDetailSection}>
          <small>基础信息</small>
          <dl>
            <dt>类型</dt>
            <dd>
              {task.metadata?.schedule.mode === "interval"
                ? "间隔任务"
                : task.kind === "once"
                  ? "一次性"
                  : "周期任务"}
            </dd>
            <dt>{task.kind === "once" ? "执行时间" : "执行周期"}</dt>
            <dd>
              {task.metadata
                ? describeScheduleConfig(task.metadata.schedule)
                : task.kind === "once"
                  ? formatTimeShort(task.runAt)
                  : describeCron(task.cronExpr ?? "")}
            </dd>
            <dt>标签</dt>
            <dd>
              <span className={styles.scheduledDetailTags}>
                {(task.metadata?.tags ?? []).length ? (
                  task.metadata!.tags.map((tag) => <span key={tag}>{tag}</span>)
                ) : (
                  <span className={styles.scheduledTagEmpty}>无</span>
                )}
              </span>
            </dd>
            <dt>下次执行</dt>
            <dd>
              {task.nextRunAt
                ? `${formatTimeShort(task.nextRunAt)}（${formatRelativeFuture(task.nextRunAt)}）`
                : "—"}
            </dd>
            <dt>状态</dt>
            <dd>
              <span className={styles.scheduledDetailState}>
                <span>{task.enabled ? "已启用" : "已停用"}</span>
              </span>
            </dd>
          </dl>
          {task.instruction ? (
            <div className={styles.scheduledDetailPromptField}>
              <small>任务指令</small>
              <div className={styles.scheduledPromptPreview}>
                {task.instruction}
              </div>
            </div>
          ) : null}
        </div>

        <div className={styles.scheduledDetailSection}>
          <div className={styles.scheduledHistoryHeading}>
            <small>执行历史</small>
            <button
              type="button"
              className={styles.scheduledHistoryLink}
              aria-label="查看全部执行记录"
              title="查看全部"
              data-scheduled-command="records"
              onClick={() => scheduleViewActions.jumpToRecords(taskId)}
            >
              <ArrowRight size={13} />
            </button>
          </div>
          <RunList runs={runs} onOpenSession={onOpenSession} />
        </div>
      </div>
    </section>
  );
}

function RunList({
  runs,
  onOpenSession,
}: {
  runs: ScheduledTaskRunRecord[] | undefined;
  onOpenSession: (id: string) => void;
}) {
  if (!runs || runs.length === 0) {
    return <div className={styles.scheduledHistoryEmpty}>暂无执行记录</div>;
  }
  return (
    <div className={styles.scheduledHistory}>
      {runs.slice(0, 10).map((r) => {
        const dotKind = statusToVariant(r.status);
        const label =
          r.status === "success"
            ? "成功"
            : r.status === "failed"
              ? "失败"
              : r.status === "running"
                ? "运行中"
                : r.status === "missed"
                  ? "错过"
                  : r.status === "no_window"
                    ? "无窗口"
                    : r.status;
        return (
          <button
            key={r.id}
            type="button"
            className={styles.scheduledHistoryItem}
            disabled={!r.sessionId}
            onClick={() => {
              if (r.sessionId) onOpenSession(r.sessionId);
            }}
          >
            <span
              className={styles.scheduledHistoryDot}
              data-status={dotKind}
            />
            <span className={styles.scheduledHistoryLabel}>{label}</span>
            <time className={styles.scheduledHistoryTime}>
              {formatRunTimeLabel(r.startedAt ?? r.createdAt)}
            </time>
          </button>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────────────────────────────
   主列表视图
   ───────────────────────────────────────────────────── */
export function ScheduleListView({
  onOpenSession,
}: {
  onOpenSession: (sessionId: string) => void;
}) {
  const tasks = useScheduleStore((s) => s.tasks);
  const create = useScheduleStore((s) => s.create);
  const runNow = useScheduleStore((s) => s.runNow);
  const selectedTaskId = useScheduleViewStore((s) => s.selectedTaskId);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [runningId, setRunningId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ScheduledTaskRecord | null>(null);

  const filtered = useMemo(
    () =>
      tasks.filter((t) => matchesFilter(t, filter) && matchesSearch(t, search)),
    [tasks, filter, search],
  );

  const handleRunNow = async (taskId: string) => {
    setRunningId(taskId);
    try {
      await runNow(taskId);
    } catch (err) {
      console.error("[schedule] runNow failed", err);
    } finally {
      setRunningId(null);
    }
  };

  const handleCopy = async (task: ScheduledTaskRecord) => {
    try {
      await create(scheduleCopyInputFromTask(task));
    } catch (err) {
      console.error("[schedule] copy failed", err);
    }
  };

  const handleSelect = (taskId: string) => {
    if (selectedTaskId === taskId) {
      scheduleViewActions.selectTask(null);
    } else {
      scheduleViewActions.selectTask(taskId);
    }
  };

  return (
    <div className={styles.scheduledPanel} data-scheduled-panel="tasks">
      <div className={styles.scheduledToolbar}>
        <label className={styles.scheduledSearch}>
          <Search size={13} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索任务名称、指令或工作区"
            data-role="scheduled-search"
          />
          <kbd data-shortcut="search">⌘K</kbd>
        </label>
        <ScheduleSelect
          ariaLabel="筛选任务状态"
          prefix="状态"
          value={filter}
          options={STATUS_FILTER_OPTIONS}
          className={styles.scheduledFilter}
          onChange={(value) => setFilter(value as StatusFilter)}
        />
        <div className={styles.scheduledToolbarSpacer} />
        <button
          type="button"
          className={styles.scheduledCreate}
          data-action="open-scheduled-modal"
          data-scheduled-mode="create"
          onClick={scheduleViewActions.openCreate}
        >
          <CalendarClock size={14} />
          <span>新建任务</span>
        </button>
      </div>

      <div className={styles.scheduledTaskScroll}>
        {filtered.length === 0 ? (
          <div className={styles.scheduledEmpty}>
            {tasks.length === 0 ? (
              <CalendarClock size={22} />
            ) : (
              <Search size={22} />
            )}
            <strong>
              {tasks.length === 0 ? "还没有定时任务" : "没有匹配的定时任务"}
            </strong>
            <span>
              {tasks.length === 0
                ? "到点自动跑指令：日报、检查、提醒、定时总结——通通交给 Agent。"
                : "换个关键词或调整状态筛选。"}
            </span>
            {tasks.length === 0 ? (
              <button type="button" onClick={scheduleViewActions.openCreate}>
                <CalendarClock size={12} />
                新建第一个任务
              </button>
            ) : null}
          </div>
        ) : (
          <div className={styles.scheduledCardList}>
            {filtered.map((t) => (
              <TaskCard
                key={t.id}
                task={t}
                selected={selectedTaskId === t.id}
                onSelect={() => handleSelect(t.id)}
                onToggle={() => {
                  void useScheduleStore.getState().toggle(t.id);
                }}
                onEdit={() => scheduleViewActions.openEdit(t.id)}
                onCopy={() => void handleCopy(t)}
                onDelete={() => setDeleting(t)}
                onRunNow={() => void handleRunNow(t.id)}
                running={runningId === t.id}
              />
            ))}
          </div>
        )}
      </div>

      {selectedTaskId ? (
        <>
          <button
            type="button"
            className={styles.scheduledDetailDismiss}
            aria-label="关闭任务详情"
            onClick={() => scheduleViewActions.selectTask(null)}
          />
          <DetailPanel
            taskId={selectedTaskId}
            onClose={() => scheduleViewActions.selectTask(null)}
            onOpenSession={onOpenSession}
          />
        </>
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title={`删除定时任务「${deleting.name}」？`}
          message="任务及其执行历史将被删除，此操作不可撤销。"
          confirmLabel="删除"
          cancelLabel="取消"
          onConfirm={() => {
            void useScheduleStore.getState().remove(deleting.id);
            setDeleting(null);
            if (selectedTaskId === deleting.id) {
              scheduleViewActions.selectTask(null);
            }
          }}
          onCancel={() => setDeleting(null)}
        />
      ) : null}
    </div>
  );
}
