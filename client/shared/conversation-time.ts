/** Today -> time, last seven days -> weekday + time, older -> month/day + time. */
export function formatConversationTime(
  value: number | string,
  nowValue: number | Date = Date.now(),
): string {
  const date = new Date(value);
  const now = nowValue instanceof Date ? nowValue : new Date(nowValue);
  if (!Number.isFinite(date.getTime())) return "";
  const time = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  if (date.toDateString() === now.toDateString()) return time;
  const days = Math.floor((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days >= 0 && days < 7) {
    const weekday = new Intl.DateTimeFormat("zh-CN", {
      weekday: "short",
    }).format(date);
    return `${weekday} ${time}`;
  }
  const day = new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
  }).format(date);
  return `${day} ${time}`;
}

function startOfDay(value: Date): number {
  return new Date(
    value.getFullYear(),
    value.getMonth(),
    value.getDate(),
  ).getTime();
}
