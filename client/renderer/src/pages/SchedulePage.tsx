import { useEffect } from "react";
import { useScheduleStore } from "@/stores/schedule-store";
import { useScheduleViewStore } from "@/stores/schedule-view-store";
import {
  ScheduleFormDialog,
  ScheduleListView,
  ScheduleRecordsView,
} from "@/components/schedule";
import styles from "@/components/schedule/SchedulePage.module.css";

interface SchedulePageProps {
  onOpenSession: (sessionId: string) => void;
}

const TABS = [
  { id: "list" as const, label: "任务面板" },
  { id: "records" as const, label: "执行记录" },
];

/**
 * 定时任务整页
 *  - 顶部：页面自己的居中段控件（不进入 WindowChrome）
 *  - 中部：两个面板常驻，只切换可见性
 *  - 浮层：ScheduleFormDialog 接管 create / edit
 */
export function SchedulePage({ onOpenSession }: SchedulePageProps) {
  const tab = useScheduleViewStore((s) => s.tab);
  const setTab = useScheduleViewStore((s) => s.setTab);
  const loaded = useScheduleStore((s) => s.loaded);
  const load = useScheduleStore((s) => s.load);
  const subscribeChanged = useScheduleStore((s) => s.subscribeChanged);

  // 首次进入：拉任务列表 + 订阅推送
  useEffect(() => {
    if (!loaded) {
      void load();
    }
    const unsub = subscribeChanged();
    return () => unsub();
  }, [loaded, load, subscribeChanged]);

  return (
    <section className={styles.scheduledPage}>
      <header className={styles.scheduledPageHeader}>
        <div
          className={styles.scheduledTabs}
          role="tablist"
          aria-label="定时任务视图"
        >
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              role="tab"
              type="button"
              aria-selected={tab === id}
              data-scheduled-tab={id}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <div
        className={styles.scheduledPagePanel}
        hidden={tab !== "list"}
        aria-hidden={tab !== "list"}
      >
        <ScheduleListView onOpenSession={onOpenSession} />
      </div>
      <div
        className={styles.scheduledPagePanel}
        hidden={tab !== "records"}
        aria-hidden={tab !== "records"}
      >
        <ScheduleRecordsView onOpenSession={onOpenSession} />
      </div>

      <ScheduleFormDialog />
    </section>
  );
}
