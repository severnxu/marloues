/**
 * LoginPage — standalone auth gate rendered before the workbench mounts.
 * Not part of the `Page` routing system (chat / settings / replay / plugins);
 * it is shown exclusively when the auth store has no valid session.
 */
import { useAuthStore } from "@/stores/auth-store";

export function LoginPage() {
  const error = useAuthStore((state) => state.error);
  const openLogin = useAuthStore((state) => state.openLogin);

  return (
    <div className="login-page">
      <div className="login-window-actions">
        <button
          onClick={() => window.marloues.window.minimize()}
          aria-label="最小化"
        >
          -
        </button>
        <button
          onClick={() => window.marloues.window.maximize()}
          aria-label="最大化"
        >
          □
        </button>
        <button
          onClick={() => window.marloues.window.close()}
          aria-label="关闭"
        >
          ×
        </button>
      </div>
      <div className="text-center">
        <div className="mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-primary to-primary-glow text-primary-foreground text-2xl font-bold mx-auto">
          N
        </div>
        <h1 className="text-2xl font-bold text-foreground">Marloues</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          AI Agent 桌面工作台
        </p>
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        <button
          className="mt-6 rounded-lg bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:brightness-110"
          onClick={() => void openLogin()}
        >
          SSO 登录
        </button>
        <button
          className="mt-3 block w-full text-sm text-muted-foreground hover:text-foreground"
          onClick={() => window.marloues.window.close()}
        >
          退出 Marloues
        </button>
      </div>
    </div>
  );
}
