import { describe, expect, it } from "vitest";
import type { ScheduledTaskMetadata } from "../../../../client/shared/types";
import {
  describeScheduleConfig,
  nextRunFromMetadata,
} from "../../../../client/shared/schedule/schedule-config";

function metadata(
  schedule: ScheduledTaskMetadata["schedule"],
): ScheduledTaskMetadata {
  return { tags: [], schedule, notificationChannels: ["app"] };
}

describe("schedule config", () => {
  it("computes multi-weekday schedules", () => {
    const config = metadata({
      mode: "cycle",
      cycleType: "weekly",
      weekdays: [1, 5],
      time: { hour: 9, minute: 30 },
    });
    const after = new Date(2026, 7, 12, 10, 0).getTime(); // 周三
    expect(nextRunFromMetadata(config, after)).toBe(
      new Date(2026, 7, 14, 9, 30).getTime(),
    );
    expect(describeScheduleConfig(config.schedule)).toBe("每周一、周五 09:30");
  });

  it("uses the actual last day for monthly schedules", () => {
    const config = metadata({
      mode: "cycle",
      cycleType: "monthly",
      months: [2],
      dayOfMonth: "last",
      time: { hour: 18, minute: 0 },
    });
    const next = nextRunFromMetadata(config, new Date(2027, 0, 1).getTime());
    expect(next).toBe(new Date(2027, 1, 28, 18, 0).getTime());
  });

  it("respects the effective end date", () => {
    const config: ScheduledTaskMetadata = {
      ...metadata({
        mode: "cycle",
        cycleType: "daily",
        time: { hour: 9, minute: 0 },
      }),
      effectiveRange: { start: "2026-08-12", end: "2026-08-14" },
    };
    expect(
      nextRunFromMetadata(config, new Date(2026, 7, 14, 10, 0).getTime()),
    ).toBeNull();
  });

  it("keeps an interval anchored across edits", () => {
    const anchorAt = new Date(2026, 7, 12, 8, 0).getTime();
    const config = metadata({
      mode: "interval",
      every: 6,
      unit: "hours",
      anchorAt,
    });
    expect(
      nextRunFromMetadata(config, new Date(2026, 7, 12, 9, 0).getTime()),
    ).toBe(new Date(2026, 7, 12, 14, 0).getTime());
  });
});
