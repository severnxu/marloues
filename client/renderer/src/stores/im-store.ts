import { create } from "zustand";
import type {
  ImChannelId,
  ImChannelStatus,
  RendererImSession,
} from "@shared/im/im-types";

interface ImStoreState {
  statuses: Partial<Record<ImChannelId, ImChannelStatus>>;
  sessions: RendererImSession[];
  loaded: boolean;
  loadSessions: () => Promise<void>;
  subscribe: () => () => void;
}

export const useImStore = create<ImStoreState>((set, get) => ({
  statuses: {},
  sessions: [],
  loaded: false,

  loadSessions: async () => {
    try {
      const imApi = window.marloues.im;
      if (!imApi) {
        set({ loaded: true });
        return;
      }
      const result = await imApi.listSessions();
      set({ sessions: result.sessions, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  subscribe: () => {
    const imApi = window.marloues.im;
    if (!imApi) return () => undefined;

    const offStatus = imApi.onStatus((status) => {
      set((state) => ({
        statuses: { ...state.statuses, [status.channel]: status },
      }));
    });
    const offSessions = imApi.onSessionsChanged(() => {
      void get().loadSessions();
    });
    return () => {
      offStatus();
      offSessions();
    };
  },
}));

export function useImChannelStatus(
  channel: ImChannelId,
): ImChannelStatus | undefined {
  return useImStore((state) => state.statuses[channel]);
}
