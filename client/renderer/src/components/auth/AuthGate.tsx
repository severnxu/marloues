import { useEffect, useRef, useState } from "react";
import { useAuthStore } from "@/stores/auth-store";
import { LoginPage } from "@/pages/LoginPage";
import { ConfirmDialog } from "@/components/ui";

/**
 * Auth gate - checks existing SSO state and auto-opens SSO when needed.
 *
 * Flow:
 * 1. On mount, restore() checks SSO login state via checkSSOLogin()
 * 2. If already logged in → phase = "authenticated" → show app
 * 3. If not logged in → auto-trigger SSO login once
 * 4. If login is cancelled or fails → show LoginPage as fallback
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const phase = useAuthStore((state) => state.phase);
  const restore = useAuthStore((state) => state.restore);
  const openLogin = useAuthStore((state) => state.openLogin);
  const permissionDenied = useAuthStore((state) => state.permissionDenied);
  const autoLoginAttempted = useRef(false);
  const [autoLoginInProgress, setAutoLoginInProgress] = useState(false);

  // Check auth status on mount (fast path: local store first, then background SSO verify)
  useEffect(() => {
    void restore();
  }, [restore]);

  // Listen for auth status changes from main process (background SSO verify failure, idle timeout)
  useEffect(() => {
    return window.marloues.auth.onStatusChanged((status) => {
      useAuthStore.getState().applyStatus(status);
      // Reset auto-login flag so SSO can re-open after idle timeout or session expiry
      if (!status.isAuthenticated) {
        autoLoginAttempted.current = false;
      }
    });
  }, []);

  // Auto-trigger SSO login when anonymous (first time only).
  useEffect(() => {
    if (
      phase === "anonymous" &&
      !autoLoginAttempted.current &&
      !permissionDenied
    ) {
      autoLoginAttempted.current = true;
      setAutoLoginInProgress(true);
      void openLogin().finally(() => setAutoLoginInProgress(false));
    }
  }, [phase, openLogin, permissionDenied]);

  // Still checking existing login state or opening SSO.
  if (phase === "checking" || autoLoginInProgress) {
    return (
      <div className="auth-loading-screen">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
          <span className="text-sm text-muted-foreground">
            {phase === "checking"
              ? "正在检查登录状态..."
              : "正在打开 SSO 登录..."}
          </span>
        </div>
      </div>
    );
  }

  // Permission denied — block access, show contact dialog
  if (permissionDenied) {
    return (
      <ConfirmDialog
        title="暂无使用权限"
        message="您没有 Marloues 的访问权限，如需申请请联系 yufeizhou(周宇飞)/danronghong(洪丹容)/tbabzhao(赵阳)。"
        confirmLabel="关闭应用"
        cancelLabel="关闭应用"
        variant="danger"
        onConfirm={() => window.marloues.window.close()}
        onCancel={() => window.marloues.window.close()}
      />
    );
  }

  if (phase === "anonymous") return <LoginPage />;

  return <>{children}</>;
}
