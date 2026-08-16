import { create } from "zustand";
import type {
  AppVersionInfo,
  UpdatePreferences,
  UpdateState,
} from "@shared/types";
import { ipc } from "@/lib/ipc-client";

interface UpdateStore {
  state: UpdateState | null;
  versionInfo: AppVersionInfo | null;
  preferences: UpdatePreferences | null;
  isChecking: boolean;
  isDownloading: boolean;
  applyState: (state: UpdateState) => void;
  load: () => Promise<void>;
  savePreferences: (next: UpdatePreferences) => Promise<UpdatePreferences>;
  ignoreVersion: (version: string) => Promise<void>;
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
  versionInfo: null,
  preferences: null,
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
    await Promise.all([
      ipc.update
        .getState()
        .then((state) => get().applyState(state))
        .catch((error) => get().applyState(toErrorState(error))),
      ipc.app.getVersionInfo().then(
        (versionInfo) => set({ versionInfo }),
        () => set({ versionInfo: null }),
      ),
      ipc.update.getPreferences().then(
        (preferences) => set({ preferences }),
        () => undefined,
      ),
    ]);
  },

  savePreferences: async (next) => {
    const saved = await ipc.update.savePreferences(next);
    set({ preferences: saved });
    return saved;
  },

  ignoreVersion: async (version) => {
    await get().savePreferences({
      ...(get().preferences ?? {
        channel: "stable",
        autoCheck: true,
        autoDownload: false,
        autoApplyUi: false,
      }),
      ignoredVersion: version,
    });
    get().applyState({ status: "idle" });
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
