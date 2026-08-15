import { create } from "zustand";
import type { UpdateState } from "@shared/types";
import { ipc } from "@/lib/ipc-client";

interface UpdateStore {
  state: UpdateState | null;
  isChecking: boolean;
  isDownloading: boolean;
  applyState: (state: UpdateState) => void;
  load: () => Promise<void>;
  check: () => Promise<void>;
  download: () => Promise<void>;
  installNow: () => Promise<void>;
}

function toErrorState(error: unknown): UpdateState {
  const message = error instanceof Error ? error.message : String(error);
  return {
    status: "error",
    error: message,
  };
}

/** Shared update lifecycle for the compact control in the sidebar footer. */
export const useUpdateStore = create<UpdateStore>((set, get) => ({
  state: null,
  isChecking: false,
  isDownloading: false,

  applyState: (state) => {
    set({
      state,
      isChecking: false,
      isDownloading: state.status === "downloading",
    });
  },

  load: async () => {
    try {
      get().applyState(await ipc.update.getState());
    } catch (error) {
      get().applyState(toErrorState(error));
    }
  },

  check: async () => {
    set({ isChecking: true });
    try {
      await ipc.update.check();
      // 主进程会推送状态事件；这里再读一次作为兜底，确保按钮文案即时刷新
      get().applyState(await ipc.update.getState());
    } catch (error) {
      get().applyState(toErrorState(error));
    } finally {
      set({ isChecking: false });
    }
  },

  download: async () => {
    set({ isDownloading: true });
    try {
      await ipc.update.download();
      // 主进程会推送状态事件；这里再读取一次作为兜底，确保旋转下载图标
      // 在下载完成后一定切换为"重启并更新"。
      get().applyState(await ipc.update.getState());
    } catch (error) {
      get().applyState(toErrorState(error));
    }
  },

  installNow: async () => {
    try {
      await ipc.update.installNow();
    } catch (error) {
      get().applyState(toErrorState(error));
    }
  },
}));
