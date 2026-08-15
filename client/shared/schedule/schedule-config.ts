import type {
  ScheduledTaskEffectiveRange,
  ScheduledTaskMetadata,
  ScheduledTaskScheduleConfig,
} from "../types";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAY_NAMES = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function parseLocalDate(value: string, endOfDay = false): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = endOfDay
    ? new Date(year, month, day, 23, 59, 59, 999)
    : new Date(year, month, day, 0, 0, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date.getTime();
}

function rangeBounds(range?: ScheduledTaskEffectiveRange): {
  start: number;
  end: number;
} {
  return {
    start: range
      ? (parseLocalDate(range.start) ?? Number.NEGATIVE_INFINITY)
      : Number.NEGATIVE_INFINITY,
    end: range
      ? (parseLocalDate(range.end, true) ?? Number.POSITIVE_INFINITY)
      : Number.POSITIVE_INFINITY,
  };
}

function nextCycleRun(
  schedule: Extract<ScheduledTaskScheduleConfig, { mode: "cycle" }>,
  after: number,
  range?: ScheduledTaskEffectiveRange,
): number | null {
  const bounds = rangeBounds(range);
  const cursor = new Date(Math.max(after + 1, bounds.start));
  cursor.setHours(0, 0, 0, 0);

  for (let offset = 0; offset < 366 * 6; offset += 1) {
    const day = new Date(cursor);
    day.setDate(cursor.getDate() + offset);
    const candidate = new Date(day);
    candidate.setHours(schedule.time.hour, schedule.time.minute, 0, 0);
    const timestamp = candidate.getTime();
    if (timestamp <= after || timestamp < bounds.start) continue;
    if (timestamp > bounds.end) return null;

    if (schedule.cycleType === "daily") return timestamp;
    if (
      schedule.cycleType === "weekly" &&
      schedule.weekdays.includes(candidate.getDay())
    ) {
      return timestamp;
    }
    if (schedule.cycleType === "monthly") {
      const month = candidate.getMonth() + 1;
      if (!schedule.months.includes(month)) continue;
      const lastDay = new Date(
        candidate.getFullYear(),
        candidate.getMonth() + 1,
        0,
      ).getDate();
      const targetDay =
        schedule.dayOfMonth === "last"
          ? lastDay
          : Math.min(schedule.dayOfMonth, lastDay);
      if (candidate.getDate() === targetDay) return timestamp;
    }
  }
  return null;
}

function nextIntervalRun(
  schedule: Extract<ScheduledTaskScheduleConfig, { mode: "interval" }>,
  after: number,
  range?: ScheduledTaskEffectiveRange,
): number | null {
  const bounds = rangeBounds(range);
  const unitMs =
    schedule.unit === "hours"
      ? 60 * 60 * 1000
      : schedule.unit === "days"
        ? DAY_MS
        : 7 * DAY_MS;
  const step = Math.max(1, Math.floor(schedule.every)) * unitMs;
  const baseline = Math.max(after + 1, bounds.start);
  const elapsed = baseline - schedule.anchorAt;
  const periods = elapsed <= 0 ? 0 : Math.ceil(elapsed / step);
  const candidate = schedule.anchorAt + periods * step;
  return candidate <= bounds.end ? candidate : null;
}

export function nextRunFromMetadata(
  metadata: ScheduledTaskMetadata,
  after = Date.now(),
): number | null {
  const { schedule } = metadata;
  if (schedule.mode === "once") {
    return schedule.runAt > after ? schedule.runAt : null;
  }
  if (schedule.mode === "interval") {
    return nextIntervalRun(schedule, after, metadata.effectiveRange);
  }
  return nextCycleRun(schedule, after, metadata.effectiveRange);
}

export function describeScheduleConfig(
  schedule: ScheduledTaskScheduleConfig,
): string {
  if (schedule.mode === "once") {
    const date = new Date(schedule.runAt);
    return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  if (schedule.mode === "interval") {
    const unit =
      schedule.unit === "hours"
        ? "小时"
        : schedule.unit === "days"
          ? "天"
          : "周";
    return `每隔 ${schedule.every} ${unit}`;
  }

  const time = `${pad(schedule.time.hour)}:${pad(schedule.time.minute)}`;
  if (schedule.cycleType === "daily") return `每天 ${time}`;
  if (schedule.cycleType === "weekly") {
    const days = [...schedule.weekdays]
      .sort((a, b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b))
      .map((day) => WEEKDAY_NAMES[day] ?? String(day))
      .join("、");
    return `每${days} ${time}`;
  }
  const months = [...schedule.months].sort((a, b) => a - b);
  const monthLabel = months.length === 12 ? "每月" : `${months.join("、")}月`;
  const dayLabel =
    schedule.dayOfMonth === "last" ? "月底" : `${schedule.dayOfMonth}日`;
  return `${monthLabel}${dayLabel} ${time}`;
}
