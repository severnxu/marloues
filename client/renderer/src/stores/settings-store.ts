import { create } from "zustand";
import type { AgentSettings, ModelOption, RuntimeKind, RuntimeState } from "@shared/types";
import { ipc } from "@/lib/ipc-client";

interface SettingsStore {
  settings: AgentSettings | null;
  runtimeState: RuntimeState | null;
  models: ModelOption[];
  load: () => Promise<void>;
  save: (settings: AgentSettings) => Promise<void>;
  switchRuntime: (runtimeId: RuntimeKind) => Promise<void>;
  listModels: () => Promise<void>;
  setModel: (providerId: string, modelId: string) => Promise<void>;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: null,
  runtimeState: null,
  models: [],

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
    set({ settings });
  },
  switchRuntime: async (runtimeId) => {
    const runtimeState = await ipc.runtime.switch(runtimeId);
    const settings = await ipc.config.getAgentSettings();
    set({ runtimeState, settings });
    await get().listModels();
  },
  listModels: async () => {
    const models = await ipc.runtime.listModels();
    set({ models });
  },
  setModel: async (providerId, modelId) => {
    const runtimeState = await ipc.runtime.setModel(providerId, modelId);
    const settings = await ipc.config.getAgentSettings();
    const models = await ipc.runtime.listModels();
    set({ runtimeState, settings, models });
  },
}));
