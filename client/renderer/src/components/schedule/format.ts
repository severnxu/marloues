/**
 * Schedule 视图层共享的格式化工具。
 */

export function formatRelativeFuture(ts: number | undefined): string {
  if (!ts) return "—";
  const diff = ts - Date.now();
  if (diff <= 0) return "已过期";
  const m = Math.round(diff / 60_000);
  if (m < 1) return "即将执行";
  if (m < 60) return `${m} 分钟后`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时后`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} 天后`;
  return new Date(ts).toLocaleDateString("zh-CN");
}

export function formatRelativePast(ts: number | undefined): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  const m = Math.round(diff / 60_000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} 天前`;
  return new Date(ts).toLocaleDateString("zh-CN");
}

export function formatDateTime(ts: number | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function formatTimeShort(ts: number | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatDuration(
  startedAt: number,
  finishedAt: number | undefined,
): number {
  if (!finishedAt) return 0;
  return Math.max(0, Math.round((finishedAt - startedAt) / 1000));
}

export function toLocalInputValue(ts: number | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
