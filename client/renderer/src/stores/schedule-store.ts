/**
 * Schedule store — tasks + run history for the schedule dialog.
 *
 * Loads the full task list and per-task run histories from the main process,
 * and applies incremental updates pushed via `onChanged`.
 */

import { create } from "zustand";
import type {
  ScheduleChangedPayload,
  ScheduledTaskInput,
  ScheduledTaskRecord,
  ScheduledTaskRunRecord,
} from "@shared/types";
import { ipc } from "@/lib/ipc-client";

interface ScheduleStore {
  tasks: ScheduledTaskRecord[];
  runs: Record<string, ScheduledTaskRunRecord[]>;
  loaded: boolean;
  load: () => Promise<void>;
  create: (input: ScheduledTaskInput) => Promise<ScheduledTaskRecord>;
  update: (
    taskId: string,
    input: Partial<ScheduledTaskInput>,
  ) => Promise<ScheduledTaskRecord>;
  remove: (taskId: string) => Promise<void>;
  toggle: (taskId: string) => Promise<ScheduledTaskRecord>;
  runNow: (taskId: string) => Promise<void>;
  loadRuns: (taskId: string) => Promise<void>;
  /** 一次性加载所有任务的执行记录（records tab 用）。 */
  loadAllRuns: () => Promise<void>;
  /** 订阅主进程变更推送，返回退订函数。 */
  subscribeChanged: () => () => void;
  applyChanged: (payload: ScheduleChangedPayload) => void;
}

export const useScheduleStore = create<ScheduleStore>((set, get) => ({
  tasks: [],
  runs: {},
  loaded: false,

  load: async () => {
    const tasks = await ipc.schedule.list();
    set({ tasks, loaded: true });
  },

  create: async (input) => {
    const record = await ipc.schedule.create(input);
    set((state) => ({
      tasks: [
        ...state.tasks.filter((task) => task.id !== record.id),
        record,
      ].sort((a, b) => a.createdAt - b.createdAt),
    }));
    return record;
  },

  update: async (taskId, input) => {
    const record = await ipc.schedule.update(taskId, input);
    set((state) => ({
      tasks: state.tasks.map((task) => (task.id === taskId ? record : task)),
    }));
    return record;
  },

  remove: async (taskId) => {
    await ipc.schedule.remove(taskId);
    set((state) => {
      const runs = { ...state.runs };
      delete runs[taskId];
      return { tasks: state.tasks.filter((task) => task.id !== taskId), runs };
    });
  },

  toggle: async (taskId) => {
    const record = await ipc.schedule.toggle(taskId);
    set((state) => ({
      tasks: state.tasks.map((task) => (task.id === taskId ? record : task)),
    }));
    return record;
  },

  runNow: async (taskId) => {
    await ipc.schedule.runNow(taskId);
    await get().loadRuns(taskId);
  },

  loadRuns: async (taskId) => {
    const runs = await ipc.schedule.listRuns(taskId, 50);
    set((state) => ({ runs: { ...state.runs, [taskId]: runs } }));
  },

  loadAllRuns: async () => {
    const { tasks } = get();
    const results = await Promise.all(
      tasks.map(async (t) => {
        const runs = await ipc.schedule.listRuns(t.id, 50);
        return [t.id, runs] as const;
      }),
    );
    set((state) => ({
      runs: { ...state.runs, ...Object.fromEntries(results) },
    }));
  },

  subscribeChanged: () => {
    return ipc.schedule.onChanged((payload) => get().applyChanged(payload));
  },

  applyChanged: (payload) => {
    const { record, run } = payload;
    if (payload.kind === "remove") {
      set((state) => {
        if (!record) return state;
        const runs = { ...state.runs };
        delete runs[record.id];
        return {
          tasks: state.tasks.filter((task) => task.id !== record.id),
          runs,
        };
      });
      return;
    }
    if (record) {
      // last-write-wins：先剔除同 id 再插入，避免竞态下重复；保持 createdAt 升序
      set((state) => {
        const others = state.tasks.filter((task) => task.id !== record.id);
        return {
          tasks: [...others, record].sort((a, b) => a.createdAt - b.createdAt),
        };
      });
    }
    if (run) {
      const taskId = run.taskId;
      set((state) => {
        const existing = state.runs[taskId] ?? [];
        const next = [run, ...existing.filter((item) => item.id !== run.id)]
          .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
          .slice(0, 50);
        return { runs: { ...state.runs, [taskId]: next } };
      });
      // #4：主进程 run 事件已携带最新 record（就地替换过 tasks）；
      // 仅当 record 缺失（旧版本主进程）时兜底全量刷新。
      if (!record) {
        void ipc.schedule.list().then((tasks) => set({ tasks }));
      }
    }
  },
}));

export const scheduleStoreActions = {
  load: () => useScheduleStore.getState().load(),
  loadRuns: (taskId: string) => useScheduleStore.getState().loadRuns(taskId),
  loadAllRuns: () => useScheduleStore.getState().loadAllRuns(),
};
