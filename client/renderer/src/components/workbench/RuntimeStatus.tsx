export function RuntimeStatus({ isRunning }: { isRunning: boolean }) {
  const label = isRunning ? "Codex · 正在工作" : "Codex · 空闲";

  return (
    <span className="window-runtime-status" aria-label={label}>
      <i data-running={isRunning} aria-hidden="true" />
      {label}
    </span>
  );
}
