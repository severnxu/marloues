import { create } from "zustand";
import type { AuthSession } from "@shared/types";
import { syncAnalyticsUser } from "@/lib/analytics";
import { STRINGS } from "@shared/strings.zh";

type AuthPhase = "checking" | "anonymous" | "authenticated";

interface AuthStore {
  phase: AuthPhase;
  hasAccount: boolean;
  session: AuthSession | null;
  error: string | null;
  permissionDenied: boolean;
  restore: () => Promise<void>;
  openLogin: () => Promise<void>;
  openRegister: () => Promise<void>;
  applyStatus: (status: {
    isAuthenticated: boolean;
    hasAccount: boolean;
    session?: AuthSession;
  }) => void;
  logout: () => Promise<void>;
}

function syncUserFromSession(session: AuthSession | null | undefined): void {
  if (session) {
    syncAnalyticsUser({
      userId: session.userId || session.username,
      env: session.env,
    });
  } else {
    syncAnalyticsUser(null);
  }
}

export const useAuthStore = create<AuthStore>((set) => ({
  phase: "checking",
  hasAccount: false,
  session: null,
  error: null,
  permissionDenied: false,
  restore: async () => {
    const status = await window.marloues.auth.getStatus();
    set({
      phase: status.isAuthenticated ? "authenticated" : "anonymous",
      hasAccount: status.hasAccount,
      session: status.session ?? null,
      error: null,
      permissionDenied: false,
    });
    syncUserFromSession(status.session);
  },
  openLogin: async () => {
    const result = await window.marloues.auth.openLogin();
    set({
      phase: result.isAuthenticated ? "authenticated" : "anonymous",
      hasAccount: result.hasAccount,
      session: result.session ?? null,
      error: result.isAuthenticated
        ? null
        : (result.message ?? STRINGS.auth.loginFailed),
      permissionDenied: false,
    });
    syncUserFromSession(result.session);
  },
  openRegister: async () => {
    const result = await window.marloues.auth.openRegister();
    set({
      phase: result.isAuthenticated ? "authenticated" : "anonymous",
      hasAccount: result.hasAccount,
      session: result.session ?? null,
      error: result.isAuthenticated
        ? null
        : (result.message ?? STRINGS.auth.registerOpenFailed),
      permissionDenied: false,
    });
    syncUserFromSession(result.session);
  },
  applyStatus: (status) => {
    set({
      phase: status.isAuthenticated ? "authenticated" : "anonymous",
      hasAccount: status.hasAccount,
      session: status.session ?? null,
      error: null,
    });
    syncUserFromSession(status.session);
  },
  logout: async () => {
    await window.marloues.auth.logout();
    set({
      phase: "anonymous",
      session: null,
      error: null,
      hasAccount: true,
      permissionDenied: false,
    });
    syncUserFromSession(null);
  },
}));
