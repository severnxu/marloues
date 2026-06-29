import { create } from "zustand";

/* PRD 5.10 — Onboarding 持久化状态。首次启动显示未完成步骤，完成后不再弹出。 */
const STORAGE_KEY = "marloues.onboarding.v1";

export interface OnboardingState {
  completed: boolean;
  selectedRuntime: boolean;
  configuredModel: boolean;
  selectedWorkspace: boolean;
  complete: () => void;
  markStep: (step: "selectedRuntime" | "configuredModel" | "selectedWorkspace", done: boolean) => void;
  reset: () => void;
}

function readStored(): Pick<OnboardingState, "completed" | "selectedRuntime" | "configuredModel" | "selectedWorkspace"> {
  if (typeof window === "undefined") {
    return { completed: false, selectedRuntime: false, configuredModel: false, selectedWorkspace: false };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<OnboardingState>;
      return {
        completed: Boolean(parsed.completed),
        selectedRuntime: Boolean(parsed.selectedRuntime),
        configuredModel: Boolean(parsed.configuredModel),
        selectedWorkspace: Boolean(parsed.selectedWorkspace),
      };
    }
  } catch {
    // localStorage may be unavailable or corrupted
  }
  return { completed: false, selectedRuntime: false, configuredModel: false, selectedWorkspace: false };
}

function save(state: Pick<OnboardingState, "completed" | "selectedRuntime" | "configuredModel" | "selectedWorkspace">): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage may be unavailable
  }
}

const initial = readStored();

export const useOnboardingStore = create<OnboardingState>((set, get) => ({
  ...initial,
  complete: () => {
    const next = { ...get(), completed: true };
    save(next);
    set({ completed: true });
  },
  markStep: (step, done) => {
    set((state) => {
      const next = { ...state, [step]: done };
      save({
        completed: next.completed,
        selectedRuntime: next.selectedRuntime,
        configuredModel: next.configuredModel,
        selectedWorkspace: next.selectedWorkspace,
      });
      return { [step]: done };
    });
  },
  reset: () => {
    const cleared = { completed: false, selectedRuntime: false, configuredModel: false, selectedWorkspace: false };
    save(cleared);
    set(cleared);
  },
}));
