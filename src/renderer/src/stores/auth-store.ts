import { create } from "zustand";
import type { AuthSession } from "@shared/types";

type AuthPhase = "checking" | "anonymous" | "authenticated";

interface AuthStore {
  phase: AuthPhase;
  hasAccount: boolean;
  session: AuthSession | null;
  error: string | null;
  restore: () => Promise<void>;
  openLogin: () => Promise<void>;
  openRegister: () => Promise<void>;
  applyStatus: (status: { isAuthenticated: boolean; hasAccount: boolean; session?: AuthSession }) => void;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthStore>((set) => ({
  phase: "checking",
  hasAccount: false,
  session: null,
  error: null,
  restore: async () => {
    const status = await window.marloues.auth.getStatus();
    set({
      phase: status.isAuthenticated ? "authenticated" : "anonymous",
      hasAccount: status.hasAccount,
      session: status.session ?? null,
      error: null,
    });
  },
  openLogin: async () => {
    const result = await window.marloues.auth.openLogin();
    set({
      phase: result.isAuthenticated ? "authenticated" : "anonymous",
      hasAccount: result.hasAccount,
      session: result.session ?? null,
      error: result.isAuthenticated ? null : (result.message ?? "登录失败。"),
    });
  },
  openRegister: async () => {
    const result = await window.marloues.auth.openRegister();
    set({
      phase: result.isAuthenticated ? "authenticated" : "anonymous",
      hasAccount: result.hasAccount,
      session: result.session ?? null,
      error: result.isAuthenticated ? null : (result.message ?? "注册入口打开失败。"),
    });
  },
  applyStatus: (status) => {
    set({
      phase: status.isAuthenticated ? "authenticated" : "anonymous",
      hasAccount: status.hasAccount,
      session: status.session ?? null,
      error: null,
    });
  },
  logout: async () => {
    await window.marloues.auth.logout();
    set({ phase: "anonymous", session: null, error: null, hasAccount: true });
  },
}));
