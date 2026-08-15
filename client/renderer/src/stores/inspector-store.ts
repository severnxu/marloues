/**
 * 右侧边栏审核面板的全局触发 store。
 *
 * 对话中的文件卡片点击"审核"后写入 reviewTarget，右侧审核 tab
 * 会自动创建/激活并展示对应 diff；WorkspaceLayout 据此展开边栏。
 */

import { create } from "zustand";

export interface ReviewTarget {
  path: string;
  rawDiff: string;
  seq: number;
}

interface InspectorState {
  reviewTarget: ReviewTarget | null;
  /** 打开右侧审核面板并展示指定文件的 diff；若边栏收起会自动展开。 */
  openReview: (path: string, rawDiff: string) => void;
  /** 清空当前审核目标（不关闭标签页，仅清空内容）。 */
  clearReview: () => void;
}

let reviewSeq = 0;

export const useInspectorStore = create<InspectorState>((set) => ({
  reviewTarget: null,

  openReview: (path, rawDiff) =>
    set({ reviewTarget: { path, rawDiff, seq: ++reviewSeq } }),

  clearReview: () => set({ reviewTarget: null }),
}));
