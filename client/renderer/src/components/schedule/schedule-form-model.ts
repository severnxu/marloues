import type {
  ScheduleNotificationChannel,
  ScheduledTaskInput,
  ScheduledTaskRecord,
  ScheduledTaskScheduleConfig,
} from "@shared/types";

export type FrequencyMode = "cycle" | "interval" | "once";
export type CycleType = "daily" | "weekly" | "monthly";
export type IntervalUnit = "hours" | "days" | "weeks";

export interface ScheduleFormState {
  name: string;
  tags: string[];
  instruction: string;
  workspacePath: string;
  frequencyMode: FrequencyMode;
  cycleType: CycleType;
  time: { hour: number; minute: number };
  weekdays: number[];
  months: number[];
  dayOfMonth: number | "last";
  intervalValue: number;
  intervalUnit: IntervalUnit;
  intervalAnchorAt: number;
  onceDate: string;
  effectiveStart: string;
  effectiveEnd: string;
  notificationChannels: ScheduleNotificationChannel[];
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function emptyScheduleForm(workspacePath: string): ScheduleFormState {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return {
    name: "",
    tags: [],
    instruction: "",
    workspacePath,
    frequencyMode: "cycle",
    cycleType: "weekly",
    time: { hour: 17, minute: 0 },
    weekdays: [5],
    months: [new Date().getMonth() + 1],
    dayOfMonth: 1,
    intervalValue: 6,
    intervalUnit: "hours",
    intervalAnchorAt: Date.now(),
    onceDate: localDateKey(tomorrow),
    effectiveStart: "",
    effectiveEnd: "",
    notificationChannels: ["app"],
  };
}

export function scheduleFormFromTask(
  task: ScheduledTaskRecord,
  copy: boolean,
): ScheduleFormState {
  const form = emptyScheduleForm(task.workspacePath);
  form.name = copy ? `${task.name} - 副本` : task.name;
  form.instruction = task.instruction;
  const metadata = task.metadata;
  if (!metadata) return form;
  form.tags = [...metadata.tags];
  form.notificationChannels = [...metadata.notificationChannels];
  form.effectiveStart = metadata.effectiveRange?.start ?? "";
  form.effectiveEnd = metadata.effectiveRange?.end ?? "";
  const schedule = metadata.schedule;
  form.frequencyMode = schedule.mode;
  if (schedule.mode === "cycle") {
    form.cycleType = schedule.cycleType;
    form.time = { ...schedule.time };
    if (schedule.cycleType === "weekly") form.weekdays = [...schedule.weekdays];
    if (schedule.cycleType === "monthly") {
      form.months = [...schedule.months];
      form.dayOfMonth = schedule.dayOfMonth;
    }
  } else if (schedule.mode === "interval") {
    form.intervalValue = schedule.every;
    form.intervalUnit = schedule.unit;
    form.intervalAnchorAt = copy ? Date.now() : schedule.anchorAt;
  } else {
    const date = new Date(schedule.runAt);
    form.onceDate = localDateKey(date);
    form.time = { hour: date.getHours(), minute: date.getMinutes() };
  }
  return form;
}

/** Build a valid create payload for the card-level copy command. */
export function scheduleCopyInputFromTask(
  task: ScheduledTaskRecord,
): ScheduledTaskInput {
  const form = scheduleFormFromTask(task, true);
  form.name = form.name.slice(0, 120);

  // A copied one-off task must still be schedulable. Preserve its time of day,
  // but move an elapsed date to tomorrow so the new card is created directly
  // instead of falling into a form-validation dead end.
  if (form.frequencyMode === "once") {
    const selected = dateTime(form.onceDate, form.time.hour, form.time.minute);
    if (selected <= Date.now()) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      form.onceDate = localDateKey(tomorrow);
    }
  }

  const result = scheduleInputFromForm(form);
  if (!result.input) {
    throw new Error(result.error ?? "无法复制定时任务。");
  }
  return result.input;
}

function dateTime(dateKey: string, hour: number, minute: number): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

function cronFor(schedule: ScheduledTaskScheduleConfig): string | undefined {
  if (schedule.mode === "once") return undefined;
  if (schedule.mode === "interval") {
    const step = Math.max(1, Math.floor(schedule.every));
    if (schedule.unit === "hours") return `0 */${step} * * *`;
    if (schedule.unit === "days") return `0 0 */${step} * *`;
    return `0 0 */${step * 7} * *`;
  }
  const { hour, minute } = schedule.time;
  if (schedule.cycleType === "daily") return `${minute} ${hour} * * *`;
  if (schedule.cycleType === "weekly") {
    return `${minute} ${hour} * * ${[...schedule.weekdays].sort((a, b) => a - b).join(",")}`;
  }
  const day = schedule.dayOfMonth === "last" ? 28 : schedule.dayOfMonth;
  return `${minute} ${hour} ${day} ${[...schedule.months].sort((a, b) => a - b).join(",")} *`;
}

export function scheduleInputFromForm(form: ScheduleFormState): {
  input?: ScheduledTaskInput;
  error?: string;
} {
  const name = form.name.trim();
  const instruction = form.instruction.trim();
  if (!name) return { error: "请输入任务名称。" };
  if (!instruction) return { error: "请输入提示词。" };
  if (!form.workspacePath)
    return { error: "当前没有可用工作区，请先添加工作区。" };
  if (Boolean(form.effectiveStart) !== Boolean(form.effectiveEnd)) {
    return { error: "请选择完整的生效日期范围。" };
  }

  let schedule: ScheduledTaskScheduleConfig;
  if (form.frequencyMode === "once") {
    const runAt = dateTime(form.onceDate, form.time.hour, form.time.minute);
    if (!form.onceDate || !Number.isFinite(runAt) || runAt <= Date.now()) {
      return { error: "请选择未来的一次性执行日期和时间。" };
    }
    schedule = { mode: "once", runAt };
  } else if (form.frequencyMode === "interval") {
    if (!Number.isFinite(form.intervalValue) || form.intervalValue < 1) {
      return { error: "间隔数值必须大于 0。" };
    }
    schedule = {
      mode: "interval",
      every: Math.floor(form.intervalValue),
      unit: form.intervalUnit,
      anchorAt: form.intervalAnchorAt,
    };
  } else if (form.cycleType === "weekly") {
    if (!form.weekdays.length) return { error: "请至少选择一个执行星期。" };
    schedule = {
      mode: "cycle",
      cycleType: "weekly",
      weekdays: form.weekdays,
      time: form.time,
    };
  } else if (form.cycleType === "monthly") {
    if (!form.months.length) return { error: "请至少选择一个执行月份。" };
    schedule = {
      mode: "cycle",
      cycleType: "monthly",
      months: form.months,
      dayOfMonth: form.dayOfMonth,
      time: form.time,
    };
  } else {
    schedule = { mode: "cycle", cycleType: "daily", time: form.time };
  }

  const metadata = {
    tags: form.tags,
    schedule,
    ...(form.effectiveStart && form.effectiveEnd
      ? {
          effectiveRange: {
            start: form.effectiveStart,
            end: form.effectiveEnd,
          },
        }
      : {}),
    notificationChannels: form.notificationChannels,
  };
  return {
    input: {
      name,
      instruction,
      workspacePath: form.workspacePath,
      kind: schedule.mode === "once" ? "once" : "cron",
      runAt: schedule.mode === "once" ? schedule.runAt : undefined,
      cronExpr: cronFor(schedule),
      metadata,
    },
  };
}
