/**
 * Lightweight 5-field cron parser (zero dependencies).
 *
 * Supported syntax per field:
 *   *        any value
 *   N        single value
 *   a-b      range
 *   a,b,c    list (ranges allowed: 1,3-5)
 *   * /n     step over the full range (e.g. * /5)
 *   a-b/n    step within a range
 *
 * Fields: minute(0-59) hour(0-23) day-of-month(1-31) month(1-12) day-of-week(0-6, 0=Sunday, 7=Sunday)
 *
 * DOM/DOW semantics follow vixie cron: when both fields are restricted, a
 * date matches when EITHER field matches (the "or" convention); when only
 * one is restricted it decides alone. Unsupported extensions (?, L, W, #)
 * are rejected by returning null from parseCron.
 */

export interface CronField {
  min: number;
  max: number;
  /** Expanded set of allowed values. */
  values: ReadonlySet<number>;
}

export interface CronSchedule {
  minute: CronField;
  hour: CronField;
  day: CronField;
  month: CronField;
  weekday: CronField;
  /** Raw normalized expression (single spaces) for display/round-trip. */
  expr: string;
}

/** Parse a single cron field into a CronField (expanded value set). */
function parseField(raw: string, min: number, max: number): CronField | null {
  if (!raw) return null;
  const values = new Set<number>();

  const parts = raw.split(",");
  for (const part of parts) {
    if (!part) return null;

    let step = 1;
    let range: string;
    const slashIndex = part.indexOf("/");
    if (slashIndex !== -1) {
      const stepRaw = part.slice(slashIndex + 1);
      if (!/^\d+$/.test(stepRaw)) return null;
      step = Number(stepRaw);
      if (step < 1) return null;
      range = part.slice(0, slashIndex);
    } else {
      range = part;
    }

    let start: number;
    let end: number;
    if (range === "*") {
      start = min;
      end = max;
    } else {
      const dashIndex = range.indexOf("-");
      if (dashIndex === -1) {
        if (!/^\d+$/.test(range)) return null;
        start = Number(range);
        end = start;
      } else {
        const startRaw = range.slice(0, dashIndex);
        const endRaw = range.slice(dashIndex + 1);
        if (!/^\d+$/.test(startRaw) || !/^\d+$/.test(endRaw)) return null;
        start = Number(startRaw);
        end = Number(endRaw);
      }
    }

    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < min ||
      end > max ||
      start > end
    ) {
      return null;
    }

    for (let value = start; value <= end; value += step) {
      values.add(value);
    }
  }

  // Normalize day-of-week: 7 (Sunday) is treated as 0.
  if (min === 0 && max === 7) {
    const normalized = new Set<number>();
    for (const value of values) {
      normalized.add(value === 7 ? 0 : value);
    }
    return { min, max, values: normalized };
  }

  return { min, max, values };
}

function normalizeExpression(expr: string): string {
  return expr.trim().split(/\s+/).join(" ");
}

/**
 * Parse a 5-field cron expression. Returns null when invalid.
 */
export function parseCron(expr: string): CronSchedule | null {
  if (typeof expr !== "string") return null;
  const normalized = normalizeExpression(expr);
  const fields = normalized.split(" ");
  if (fields.length !== 5) return null;

  const minute = parseField(fields[0], 0, 59);
  const hour = parseField(fields[1], 0, 23);
  const day = parseField(fields[2], 1, 31);
  const month = parseField(fields[3], 1, 12);
  const weekday = parseField(fields[4], 0, 7);
  if (!minute || !hour || !day || !month || !weekday) return null;

  return { minute, hour, day, month, weekday, expr: normalized };
}

/** Day-of-week accessor: JS getDay() 0=Sunday matches cron 0=Sunday. */
function isWeekdayMatch(schedule: CronSchedule, date: Date): boolean {
  return schedule.weekday.values.has(date.getDay());
}

function isDomMatch(schedule: CronSchedule, date: Date): boolean {
  return schedule.day.values.has(date.getDate());
}

/**
 * DOM/DOW use the "or" convention (vixie cron): if both are restricted,
 * a date matches when either matches.
 */
/**
 * DOM/DOW follow vixie cron semantics:
 * - both restricted -> match when EITHER matches ("or" convention)
 * - only DOM restricted -> match by DOM only
 * - only DOW restricted -> match by DOW only
 * - neither restricted -> always matches
 */
function isDayMatch(schedule: CronSchedule, date: Date): boolean {
  const domRestricted = schedule.day.values.size < 31;
  const dowRestricted = schedule.weekday.values.size < 7;
  const dom = isDomMatch(schedule, date);
  const dow = isWeekdayMatch(schedule, date);
  if (domRestricted && dowRestricted) return dom || dow;
  if (domRestricted) return dom;
  if (dowRestricted) return dow;
  return true;
}

/**
 * Check whether a specific date matches the schedule.
 */
export function isMatch(schedule: CronSchedule, date: Date): boolean {
  if (!schedule.month.values.has(date.getMonth() + 1)) return false;
  if (!isDayMatch(schedule, date)) return false;
  if (!schedule.hour.values.has(date.getHours())) return false;
  if (!schedule.minute.values.has(date.getMinutes())) return false;
  return true;
}

/**
 * Compute the next run time strictly after `from` (rounded to the next
 * minute). Returns null when no match exists within the horizon.
 *
 * Iterates minute-by-minute; worst case ~2.6M iterations over 5 years,
 * which completes in well under 50ms on Node — acceptable since this runs
 * once per task change/startup, not per tick.
 */
export function nextRunAfter(
  schedule: CronSchedule,
  from: Date,
  horizonYears = 5,
): Date | null {
  const candidate = new Date(from);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  const horizonMs = from.getTime() + horizonYears * 365 * 24 * 60 * 60 * 1000;
  if (candidate.getTime() > horizonMs) return null;

  while (candidate.getTime() <= horizonMs) {
    if (isMatch(schedule, candidate)) return candidate;
    candidate.setMinutes(candidate.getMinutes() + 1);
  }
  return null;
}

/**
 * Human-readable summary for UI display, e.g. "每天 09:00" for 0 9 * * *.
 * Falls back to the raw expression when no preset pattern matches.
 */
export function describeCron(expr: string): string {
  const schedule = parseCron(expr);
  if (!schedule) return expr;

  const mins = Array.from(schedule.minute.values).sort((a, b) => a - b);
  const hours = Array.from(schedule.hour.values).sort((a, b) => a - b);
  const days = Array.from(schedule.day.values).sort((a, b) => a - b);
  const months = Array.from(schedule.month.values).sort((a, b) => a - b);
  const weekdays = Array.from(schedule.weekday.values).sort((a, b) => a - b);

  const isEveryMinute = mins.length === 60;
  const isEveryHour = hours.length === 24 && mins.length === 1 && mins[0] === 0;
  const isEveryDay =
    days.length === 31 && months.length === 12 && weekdays.length === 7;
  const isEveryMonth = days.length === 1 && months.length === 12;

  const WEEKDAY_NAMES = ["日", "一", "二", "三", "四", "五", "六"];
  const time = `${String(hours[0] ?? 0).padStart(2, "0")}:${String(mins[0] ?? 0).padStart(2, "0")}`;

  if (isEveryMinute) return "每分钟";
  if (isEveryHour && isEveryDay) return `每小时（${time} 分）`;
  if (isEveryDay && hours.length === 1 && mins.length === 1)
    return `每天 ${time}`;
  if (hours.length === 1 && mins.length === 1 && days.length === 31) {
    if (weekdays.length === 5 && weekdays.every((d) => d >= 1 && d <= 5))
      return `工作日 ${time}`;
    if (weekdays.length === 2 && weekdays.includes(0) && weekdays.includes(6))
      return `周末 ${time}`;
    if (weekdays.length === 1)
      return `每周${WEEKDAY_NAMES[weekdays[0]]} ${time}`;
  }
  if (isEveryMonth && hours.length === 1 && mins.length === 1)
    return `每月 ${days[0]} 日 ${time}`;

  return expr;
}
