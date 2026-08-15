/**
 * Preset frequency presets shared by the renderer form and the main-process
 * scheduler. Every preset normalizes to a 5-field cron expression so the
 * storage layer only ever sees cron.
 */

export type SchedulePresetKind = "interval" | "daily" | "weekly" | "monthly";

export interface SchedulePresetValues {
  kind: SchedulePresetKind;
  /** interval: every N minutes (1-59). */
  everyMinutes?: number;
  /** daily/weekly/monthly: hour of day (0-23). */
  hour?: number;
  /** daily/weekly/monthly: minute of hour (0-59). */
  minute?: number;
  /** weekly: day of week (0=Sunday .. 6=Saturday). */
  weekday?: number;
  /** monthly: day of month (1-31). */
  dayOfMonth?: number;
}

/** Build a cron expression from preset values. Returns null on invalid input. */
export function presetToCron(values: SchedulePresetValues): string | null {
  const hour = values.hour ?? 0;
  const minute = values.minute ?? 0;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  switch (values.kind) {
    case "interval": {
      const every = values.everyMinutes ?? 30;
      if (every < 1 || every > 59) return null;
      return `*/${every} * * * *`;
    }
    case "daily":
      return `${minute} ${hour} * * *`;
    case "weekly": {
      const weekday = values.weekday ?? 0;
      if (weekday < 0 || weekday > 6) return null;
      return `${minute} ${hour} * * ${weekday}`;
    }
    case "monthly": {
      const day = values.dayOfMonth ?? 1;
      if (day < 1 || day > 31) return null;
      return `${minute} ${hour} ${day} * *`;
    }
    default:
      return null;
  }
}

/** Inverse: best-effort classify a cron expression back into preset values. */
export function cronToPreset(
  expr: string,
): { kind: SchedulePresetKind; values: SchedulePresetValues } | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minField, hourField, dayField, monthField, dowField] = parts;
  const single = (field: string): number | null =>
    /^\d+$/.test(field) ? Number(field) : null;
  const step = (field: string): number | null => {
    const match = field.match(/^\*\/(\d+)$/);
    return match ? Number(match[1]) : null;
  };

  const min = single(minField);
  const hour = single(hourField);
  const day = single(dayField);
  const dow = single(dowField);
  const monthAll = monthField === "*";
  const dayAll = dayField === "*";
  const dowAll = dowField === "*";

  if (
    step(minField) !== null &&
    hourField === "*" &&
    dayAll &&
    monthAll &&
    dowAll
  ) {
    const everyMinutes = step(minField);
    if (everyMinutes !== null) {
      return { kind: "interval", values: { kind: "interval", everyMinutes } };
    }
  }
  if (min !== null && hour !== null && dayAll && monthAll && dowAll) {
    return { kind: "daily", values: { kind: "daily", hour, minute: min } };
  }
  if (min !== null && hour !== null && dayAll && monthAll && dow !== null) {
    return {
      kind: "weekly",
      values: { kind: "weekly", hour, minute: min, weekday: dow },
    };
  }
  if (min !== null && hour !== null && day !== null && monthAll && dowAll) {
    return {
      kind: "monthly",
      values: { kind: "monthly", hour, minute: min, dayOfMonth: day },
    };
  }
  return null;
}
