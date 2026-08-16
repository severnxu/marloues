import { describe, expect, it } from "vitest";
import {
  parseCron,
  isMatch,
  nextRunAfter,
  describeCron,
} from "../../../../client/shared/schedule/cron-parser";
import {
  presetToCron,
  cronToPreset,
} from "../../../../client/shared/schedule/cron-presets";

describe("parseCron", () => {
  it("parses simple expressions", () => {
    expect(parseCron("* * * * *")).not.toBeNull();
    expect(parseCron("0 9 * * 1-5")).not.toBeNull();
    expect(parseCron("*/5 * * * *")).not.toBeNull();
    expect(parseCron("0,30 8-10 * * *")).not.toBeNull();
    expect(parseCron("15 3 1 1 *")).not.toBeNull();
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseCron("  0 9 * * *  ")).not.toBeNull();
    expect(parseCron("0\t9 * * *")).not.toBeNull();
  });

  it("rejects invalid expressions", () => {
    expect(parseCron("")).toBeNull();
    expect(parseCron("* * * *")).toBeNull(); // 4 fields
    expect(parseCron("* * * * * *")).toBeNull(); // 6 fields
    expect(parseCron("60 * * * *")).toBeNull(); // minute out of range
    expect(parseCron("* 24 * * *")).toBeNull(); // hour out of range
    expect(parseCron("* * 0 * *")).toBeNull(); // day of month 0
    expect(parseCron("* * 32 * *")).toBeNull(); // day of month > 31
    expect(parseCron("* * * 13 *")).toBeNull(); // month out of range
    expect(parseCron("* * * * 8")).toBeNull(); // weekday > 7
    expect(parseCron("? * * * *")).toBeNull(); // unsupported token
    expect(parseCron("a * * * *")).toBeNull(); // non-numeric
    expect(parseCron("*/0 * * * *")).toBeNull(); // zero step
    expect(parseCron("5-2 * * * *")).toBeNull(); // inverted range
    expect(parseCron("1,,2 * * * *")).toBeNull(); // empty list item
    expect(parseCron("1,2, * * * *")).toBeNull(); // trailing comma
  });

  it("normalizes weekday 7 to Sunday", () => {
    const schedule = parseCron("0 0 * * 7");
    expect(schedule).not.toBeNull();
    expect(schedule!.weekday.values.has(0)).toBe(true);
    expect(schedule!.weekday.values.has(7)).toBe(false);
  });
});

describe("isMatch", () => {
  it("matches minute-level schedules", () => {
    const schedule = parseCron("*/5 * * * *")!;
    expect(isMatch(schedule, new Date(2026, 7, 7, 10, 0))).toBe(true);
    expect(isMatch(schedule, new Date(2026, 7, 7, 10, 5))).toBe(true);
    expect(isMatch(schedule, new Date(2026, 7, 7, 10, 3))).toBe(false);
  });

  it("matches weekday-restricted schedules", () => {
    // 0 9 * * 1-5 : 09:00 Mon-Fri
    const schedule = parseCron("0 9 * * 1-5")!;
    // 2026-08-10 is a Monday
    expect(isMatch(schedule, new Date(2026, 7, 10, 9, 0))).toBe(true);
    // 2026-08-09 is a Sunday
    expect(isMatch(schedule, new Date(2026, 7, 9, 9, 0))).toBe(false);
    expect(isMatch(schedule, new Date(2026, 7, 10, 10, 0))).toBe(false);
  });

  it("applies DOM/DOW or semantics", () => {
    // 0 0 13 * 5 : 13th of month OR Friday
    const schedule = parseCron("0 0 13 * 5")!;
    // 2026-03-13 is a Friday (both match)
    expect(isMatch(schedule, new Date(2026, 2, 13, 0, 0))).toBe(true);
    // 2026-03-14 is a Saturday but the 13th does not match — false
    expect(isMatch(schedule, new Date(2026, 2, 14, 0, 0))).toBe(false);
    // 2026-02-06 is a Friday (DOM not 13) — true via DOW
    expect(isMatch(schedule, new Date(2026, 1, 6, 0, 0))).toBe(true);
    // 2026-03-13 01:00 — hour mismatch
    expect(isMatch(schedule, new Date(2026, 2, 13, 1, 0))).toBe(false);
  });

  it("matches monthly schedules", () => {
    const schedule = parseCron("0 9 1 * *")!;
    expect(isMatch(schedule, new Date(2026, 7, 1, 9, 0))).toBe(true);
    expect(isMatch(schedule, new Date(2026, 7, 2, 9, 0))).toBe(false);
  });
});

describe("nextRunAfter", () => {
  it("computes the next minute", () => {
    const schedule = parseCron("* * * * *")!;
    const from = new Date(2026, 7, 7, 10, 0, 30);
    const next = nextRunAfter(schedule, from)!;
    expect(next.getMinutes()).toBe(1);
    expect(next.getSeconds()).toBe(0);
  });

  it("rolls over to the next hour", () => {
    const schedule = parseCron("0 9 * * *")!;
    const from = new Date(2026, 7, 7, 8, 45);
    const next = nextRunAfter(schedule, from)!;
    expect(next.getHours()).toBe(9);
    expect(next.getMinutes()).toBe(0);
    expect(next.getDate()).toBe(7);
  });

  it("rolls over to the next day", () => {
    const schedule = parseCron("30 8 * * *")!;
    const from = new Date(2026, 7, 7, 9, 0);
    const next = nextRunAfter(schedule, from)!;
    expect(next.getDate()).toBe(8);
    expect(next.getHours()).toBe(8);
    expect(next.getMinutes()).toBe(30);
  });

  it("rolls over to the next weekday", () => {
    // 2026-08-07 is a Friday; next Mon-Fri 09:00 is Monday 2026-08-10
    const schedule = parseCron("0 9 * * 1-5")!;
    const from = new Date(2026, 7, 7, 10, 0);
    const next = nextRunAfter(schedule, from)!;
    expect(next.getDay()).toBe(1);
    expect(next.getDate()).toBe(10);
    expect(next.getHours()).toBe(9);
  });

  it("rolls over to the next month", () => {
    const schedule = parseCron("0 9 1 * *")!;
    const from = new Date(2026, 7, 2, 0, 0);
    const next = nextRunAfter(schedule, from)!;
    expect(next.getMonth()).toBe(8); // September
    expect(next.getDate()).toBe(1);
  });

  it("rolls over to the next year", () => {
    const schedule = parseCron("0 0 1 1 *")!;
    const from = new Date(2026, 11, 31, 12, 0);
    const next = nextRunAfter(schedule, from)!;
    expect(next.getFullYear()).toBe(2027);
    expect(next.getMonth()).toBe(0);
    expect(next.getDate()).toBe(1);
  });

  it("handles February 29 leap years", () => {
    const schedule = parseCron("0 0 29 2 *")!;
    const from = new Date(2026, 7, 7, 0, 0);
    const next = nextRunAfter(schedule, from)!;
    expect(next.getFullYear()).toBe(2028); // next leap year
    expect(next.getMonth()).toBe(1);
    expect(next.getDate()).toBe(29);
  });

  it("returns null when no match within horizon", () => {
    const schedule = parseCron("0 0 31 2 *")!; // Feb 31 never exists
    const from = new Date(2026, 0, 1);
    expect(nextRunAfter(schedule, from, 1)).toBeNull();
  });

  it("respects the horizon", () => {
    const schedule = parseCron("0 0 1 1 *")!;
    const from = new Date(2026, 0, 1, 0, 1);
    // horizon of one day cannot reach 2027-01-01
    expect(nextRunAfter(schedule, from, 0)).toBeNull();
  });
});

describe("describeCron", () => {
  it("describes preset-like expressions in Chinese", () => {
    expect(describeCron("* * * * *")).toBe("每分钟");
    expect(describeCron("0 9 * * *")).toBe("每天 09:00");
    expect(describeCron("30 8 * * 1")).toBe("每周一 08:30");
    expect(describeCron("0 9 * * 1-5")).toBe("工作日 09:00");
    expect(describeCron("0 10 1 * *")).toBe("每月 1 日 10:00");
  });

  it("falls back to raw expression", () => {
    expect(describeCron("5,35 9,17 * * *")).toBe("5,35 9,17 * * *");
  });

  it("returns input for invalid expressions", () => {
    expect(describeCron("not a cron")).toBe("not a cron");
  });
});

describe("presetToCron / cronToPreset round-trip", () => {
  it("interval", () => {
    const cron = presetToCron({ kind: "interval", everyMinutes: 15 })!;
    expect(cron).toBe("*/15 * * * *");
    expect(cronToPreset(cron)).toEqual({
      kind: "interval",
      values: { kind: "interval", everyMinutes: 15 },
    });
  });

  it("daily", () => {
    const cron = presetToCron({ kind: "daily", hour: 9, minute: 30 })!;
    expect(cron).toBe("30 9 * * *");
    expect(cronToPreset(cron)).toEqual({
      kind: "daily",
      values: { kind: "daily", hour: 9, minute: 30 },
    });
  });

  it("weekly", () => {
    const cron = presetToCron({
      kind: "weekly",
      hour: 8,
      minute: 0,
      weekday: 5,
    })!;
    expect(cron).toBe("0 8 * * 5");
    expect(cronToPreset(cron)).toEqual({
      kind: "weekly",
      values: { kind: "weekly", hour: 8, minute: 0, weekday: 5 },
    });
  });

  it("monthly", () => {
    const cron = presetToCron({
      kind: "monthly",
      hour: 10,
      minute: 15,
      dayOfMonth: 1,
    })!;
    expect(cron).toBe("15 10 1 * *");
    expect(cronToPreset(cron)).toEqual({
      kind: "monthly",
      values: { kind: "monthly", hour: 10, minute: 15, dayOfMonth: 1 },
    });
  });

  it("rejects invalid preset values", () => {
    expect(presetToCron({ kind: "interval", everyMinutes: 0 })).toBeNull();
    expect(presetToCron({ kind: "interval", everyMinutes: 60 })).toBeNull();
    expect(presetToCron({ kind: "daily", hour: 24 })).toBeNull();
    expect(presetToCron({ kind: "monthly", dayOfMonth: 32 })).toBeNull();
    expect(presetToCron({ kind: "weekly", weekday: 7 })).toBeNull();
  });

  it("returns null for unrecognized expressions", () => {
    expect(cronToPreset("0 0 13 * 5")).toBeNull();
    expect(cronToPreset("garbage")).toBeNull();
  });
});
