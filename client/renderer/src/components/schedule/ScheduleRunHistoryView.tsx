import { useEffect, useMemo } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  Check,
  CircleDashed,
  Clock,
  ExternalLink,
  History,
  X,
} from "lucide-react";
import type {
  ScheduledTaskRunRecord,
  ScheduledTaskRunStatus,
} from "@shared/types";
import { SettingsCard } from "@/components/settings";
import { useScheduleStore } from "@/stores/schedule-store";
import { scheduleViewActions } from "@/stores/schedule-view-store";
import { useUnifiedChatStore } from "@/stores/unified-chat-store";
import styles from "./SchedulePage.module.css";

interface ScheduleRunHistoryViewProps {
  taskId: string;
  /** 跳转到 chat 页时回调（打开会话） */
  onClose?: () => void;
}

interface StatusVisual {
  icon: React.ReactNode;
  className: string;
  label: string;
}

const STATUS_VISUAL: Record<ScheduledTaskRunStatus, StatusVisual> = {
  success: {
    icon: <Check size={14} />,
    className: "success",
    label: "成功",
  },
  failed: {
    icon: <X size={14} />,
    className: "failed",
    label: "失败",
  },
  missed: {
    icon: <AlertTriangle size={14} />,
    className: "missed",
    label: "错过",
  },
  no_window: {
    icon: <AlertTriangle size={14} />,
    className: "no_window",
    label: "无窗口",
  },
  running: {
    icon: <CircleDashed size={14} />,
    className: "running",
    label: "运行中",
  },
};

function formatTime(ts: number | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function startOfDay(d: Date): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

function dayLabel(ts: number): { label: string; key: string } {
  const d = new Date(ts);
  const today = startOfDay(new Date());
  const yest = today - 24 * 60 * 60 * 1000;
  const t = startOfDay(d);
  if (t === today) return { label: "今天", key: "today" };
  if (t === yest) return { label: "昨天", key: "yesterday" };
  return {
    label: d.toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    key: String(t),
  };
}

function groupByDay(runs: ScheduledTaskRunRecord[]) {
  const groups = new Map<
    string,
    { label: string; runs: ScheduledTaskRunRecord[] }
  >();
  for (const r of runs) {
    const { key, label } = dayLabel(r.createdAt ?? 0);
    if (!groups.has(key)) groups.set(key, { label, runs: [] });
    groups.get(key)!.runs.push(r);
  }
  return Array.from(groups.entries()).map(([key, value]) => ({
    key,
    ...value,
  }));
}

export function ScheduleRunHistoryView({
  taskId,
  onClose,
}: ScheduleRunHistoryViewProps) {
  const task = useScheduleStore((s) => s.tasks.find((t) => t.id === taskId));
  const runs = useScheduleStore((s) => s.runs[taskId]);
  const loadRuns = useScheduleStore((s) => s.loadRuns);

  useEffect(() => {
    void loadRuns(taskId);
  }, [taskId, loadRuns]);

  const grouped = useMemo(() => (runs ? groupByDay(runs) : []), [runs]);
  const totalCount = runs?.length ?? 0;
  const successCount = runs?.filter((r) => r.status === "success").length ?? 0;
  const failedCount = runs?.filter((r) => r.status === "failed").length ?? 0;

  const openSession = (sessionId: string | undefined) => {
    if (!sessionId) return;
    useUnifiedChatStore.getState().setActiveSession(sessionId);
    onClose?.();
  };

  return (
    <>
      <button
        type="button"
        className={styles.backButton}
        onClick={scheduleViewActions.showList}
      >
        <ArrowLeft size={13} />
        返回任务列表
      </button>

      <SettingsCard
        title={`执行历史 — ${task?.name ?? taskId.slice(0, 8)}`}
        description="每次执行都会新建会话，可跳回查看完整过程。"
        icon={<History size={16} />}
      >
        {!runs || runs.length === 0 ? (
          <EmptyHistoryState />
        ) : (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gap: 10,
                marginBottom: 14,
              }}
            >
              <HistoryStat
                icon={<CalendarClock size={13} />}
                label="总执行"
                value={String(totalCount)}
              />
              <HistoryStat
                icon={<Check size={13} />}
                label="成功"
                value={String(successCount)}
                tone="ok"
              />
              <HistoryStat
                icon={<X size={13} />}
                label="失败"
                value={String(failedCount)}
                tone={failedCount > 0 ? "error" : "neutral"}
              />
            </div>

            {grouped.map((group) => (
              <div key={group.key} className={styles.historyGroup}>
                <div className={styles.historyGroupLabel}>
                  {group.label}
                  <span className={styles.historyGroupCount}>
                    {group.runs.length} 次
                  </span>
                </div>
                <div className={styles.historyList}>
                  {group.runs.map((run) => {
                    const v = STATUS_VISUAL[run.status] ?? STATUS_VISUAL.failed;
                    return (
                      <div key={run.id} className={styles.historyItem}>
                        <div
                          className={styles.historyStatus}
                          data-status={v.className}
                        >
                          {v.icon}
                        </div>
                        <div className={styles.historyBody}>
                          <div className={styles.historyTitle}>
                            <span>{v.label}</span>
                            <span className={styles.historyTitleDot} />
                            <span>{formatTime(run.createdAt)}</span>
                            {run.finishedAt ? (
                              <>
                                <span className={styles.historyTitleDot} />
                                <span style={{ color: "var(--muted)" }}>
                                  用时{" "}
                                  {Math.max(
                                    0,
                                    Math.round(
                                      (run.finishedAt -
                                        (run.startedAt ?? run.createdAt ?? 0)) /
                                        1000,
                                    ),
                                  )}
                                  s
                                </span>
                              </>
                            ) : null}
                          </div>
                          {run.error ? (
                            <div className={styles.historyError}>
                              {run.error}
                            </div>
                          ) : null}
                        </div>
                        {run.sessionId ? (
                          <button
                            type="button"
                            className={styles.historyLink}
                            onClick={() => openSession(run.sessionId)}
                          >
                            <ExternalLink size={12} />
                            打开会话
                          </button>
                        ) : (
                          <span
                            style={{
                              color: "var(--muted)",
                              fontSize: 11,
                              padding: "0 8px",
                            }}
                          >
                            无关联会话
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </>
        )}
      </SettingsCard>
    </>
  );
}

/* ── 子组件：空态 ──────────────────────────────────────── */

function EmptyHistoryState() {
  return (
    <div className={styles.emptyState}>
      <div className={styles.emptyStateIcon}>
        <Clock size={26} />
      </div>
      <strong className={styles.emptyStateTitle}>暂无执行记录</strong>
      <p className={styles.emptyStateBody}>
        任务触发后，运行结果会出现在这里。每个执行都会创建独立会话，可直接跳转查看。
      </p>
    </div>
  );
}

/* ── 子组件：统计卡 ────────────────────────────────────── */

function HistoryStat({
  icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "ok" | "error" | "neutral";
}) {
  const colorMap = {
    ok: "var(--success)",
    error: "var(--danger)",
    neutral: "var(--text)",
  } as const;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        border: "1px solid var(--border)",
        borderRadius: 10,
        background: "var(--settings-surface, var(--panel-soft))",
        padding: "10px 14px",
      }}
    >
      <span
        style={{
          display: "flex",
          width: 28,
          height: 28,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 8,
          background: "var(--raised-1)",
          color: "var(--muted)",
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
        <span
          style={{
            color: "var(--muted)",
            fontSize: 11,
            lineHeight: 1.2,
          }}
        >
          {label}
        </span>
        <span
          style={{
            color: colorMap[tone],
            fontSize: 18,
            fontWeight: 650,
            lineHeight: 1.2,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {value}
        </span>
      </div>
    </div>
  );
}
