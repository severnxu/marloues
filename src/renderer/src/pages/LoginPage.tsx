export function LoginPage() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <div className="mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-primary to-primary-glow text-primary-foreground text-2xl font-bold mx-auto">
          N
        </div>
        <h1 className="text-2xl font-bold text-foreground">Marloues</h1>
        <p className="mt-2 text-sm text-muted-foreground">多内核 Agent 桌面工作台</p>
        <button
          className="mt-6 rounded-lg bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:brightness-110"
          onClick={() => void window.marloues.auth.openLogin()}
        >
          登录
        </button>
      </div>
    </div>
  );
}
