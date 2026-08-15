/**
 * Schedule view store — 页面级 tab + 选中态 + 模态态
 *
 * - `tab`: 顶部 "任务列表" / "执行记录" 大 tab
 * - `selectedTaskId`: 列表里当前选中的任务（驱动右侧详情面板）
 * - `form`: create / edit 两态共用一个模态；复制由卡片命令直接创建
 */

import { create } from "zustand";

export type ScheduleTab = "list" | "records";
export type ScheduleFormMode = "create" | "edit" | null;

interface ScheduleFormState {
  mode: ScheduleFormMode;
  /** edit 时的源任务 id；create 时为 null */
  sourceId: string | null;
}

interface ScheduleViewState {
  tab: ScheduleTab;
  selectedTaskId: string | null;
  form: ScheduleFormState;

  // tab
  setTab: (tab: ScheduleTab) => void;
  showList: () => void;
  showRecords: () => void;

  // 选中任务
  selectTask: (taskId: string | null) => void;
  /** 跳到执行记录 tab 并预过滤到指定任务 */
  jumpToRecords: (taskId: string) => void;

  // 模态
  openCreate: () => void;
  openEdit: (taskId: string) => void;
  closeForm: () => void;
}

const initialForm: ScheduleFormState = { mode: null, sourceId: null };

export const useScheduleViewStore = create<ScheduleViewState>((set) => ({
  tab: "list",
  selectedTaskId: null,
  form: initialForm,

  setTab: (tab) => set({ tab, selectedTaskId: null }),
  showList: () => set({ tab: "list" }),
  showRecords: () => set({ tab: "records", selectedTaskId: null }),

  selectTask: (taskId) => set({ selectedTaskId: taskId }),
  jumpToRecords: (_taskId) =>
    set({
      tab: "records",
      selectedTaskId: null /* 预过滤 taskId 由组件层读取 */,
    }),

  openCreate: () => set({ form: { mode: "create", sourceId: null } }),
  openEdit: (taskId) => set({ form: { mode: "edit", sourceId: taskId } }),
  closeForm: () => set({ form: initialForm }),
}));

/** 给"跳到执行记录 + 预过滤某个任务"用的临时存根。 */
export const useScheduleRecordsFilter = create<{
  taskId: string | null;
  set: (id: string | null) => void;
}>((set) => ({
  taskId: null,
  set: (taskId) => set({ taskId }),
}));

export const scheduleViewActions = {
  setTab: (tab: ScheduleTab) => useScheduleViewStore.getState().setTab(tab),
  showList: () => useScheduleViewStore.getState().showList(),
  showRecords: () => useScheduleViewStore.getState().showRecords(),
  selectTask: (id: string | null) =>
    useScheduleViewStore.getState().selectTask(id),
  jumpToRecords: (id: string) => {
    useScheduleRecordsFilter.getState().set(id);
    useScheduleViewStore.getState().jumpToRecords(id);
  },
  openCreate: () => useScheduleViewStore.getState().openCreate(),
  openEdit: (id: string) => useScheduleViewStore.getState().openEdit(id),
  closeForm: () => useScheduleViewStore.getState().closeForm(),
};
