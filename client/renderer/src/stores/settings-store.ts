import { create } from "zustand";
import type {
  AgentSettings,
  ModelOption,
  RuntimeKind,
  RuntimeState,
} from "@shared/types";
import { ipc } from "@/lib/ipc-client";

interface SettingsStore {
  settings: AgentSettings | null;
  models: ModelOption[];
  runtimeState: RuntimeState | null;
  switchingRuntimeId: RuntimeKind | null;
  load: () => Promise<void>;
  save: (settings: AgentSettings) => Promise<void>;
  listModels: () => Promise<void>;
  setModel: (providerId: string, modelId: string) => Promise<void>;
  switchRuntime: (runtimeId: RuntimeKind) => Promise<RuntimeState>;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: null,
  models: [],
  runtimeState: null,
  switchingRuntimeId: null,

  load: async () => {
    const [settings, runtimeState] = await Promise.all([
      ipc.config.getAgentSettings(),
      ipc.runtime.getState(),
    ]);
    set({ settings, runtimeState });
    await get().listModels();
  },
  save: async (settings) => {
    await ipc.config.saveAgentSettings(settings);
    const saved = await ipc.config.getAgentSettings();
    set({ settings: saved });
  },
  listModels: async () => {
    const models = await ipc.runtime.listModels();
    set({ models });
  },
  setModel: async (providerId, modelId) => {
    // Optimistic: reflect the user's choice immediately so the input box model
    // chip cannot lag behind or be reverted by turn-completion data flows. The
    // main-process round-trip below confirms (and is the source of truth).
    set((state) =>
      state.settings
        ? {
            settings: {
              ...state.settings,
              defaultModel: { providerId, modelId },
            },
          }
        : {},
    );
    try {
      await ipc.runtime.setModel(providerId, modelId);
    } catch (error) {
      console.warn("[settings-store] runtime.setModel failed", {
        providerId,
        modelId,
        error,
      });
    }
    // Re-read the persisted source of truth. If the main process accepted the
    // switch this is a no-op; if it rejected/normalised it, the chip corrects.
    const [settings, models] = await Promise.all([
      ipc.config.getAgentSettings(),
      ipc.runtime.listModels(),
    ]);
    set({ settings, models });
  },
  switchRuntime: async (runtimeId) => {
    const current = get().runtimeState;
    if (current?.activeRuntimeId === runtimeId) return current;
    set({ switchingRuntimeId: runtimeId });
    try {
      const runtimeState = await ipc.runtime.switch(runtimeId);
      const [settings, models] = await Promise.all([
        ipc.config.getAgentSettings(),
        ipc.runtime.listModels(),
      ]);
      set({ settings, models, runtimeState, switchingRuntimeId: null });
      return runtimeState;
    } catch (error) {
      set({ switchingRuntimeId: null });
      throw error;
    }
  },
}));
