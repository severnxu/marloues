import type { ScheduleFormState } from "./schedule-form-model";
import { ScheduleDatePicker } from "./ScheduleDatePicker";
import { ScheduleMultiSelect } from "./ScheduleMultiSelect";
import { ScheduleSelect } from "./ScheduleSelect";
import { ScheduleTimePicker } from "./ScheduleTimePicker";
import styles from "./SchedulePage.module.css";

const CYCLE_OPTIONS = [
  { value: "daily", label: "每日" },
  { value: "weekly", label: "每周" },
  { value: "monthly", label: "每月" },
];
const WEEKDAY_OPTIONS = [
  { value: "1", label: "周一" },
  { value: "2", label: "周二" },
  { value: "3", label: "周三" },
  { value: "4", label: "周四" },
  { value: "5", label: "周五" },
  { value: "6", label: "周六" },
  { value: "0", label: "周日" },
];
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) => ({
  value: String(index + 1),
  label: `${index + 1}月`,
}));
const MONTH_DAY_OPTIONS = [
  ...Array.from({ length: 31 }, (_, index) => ({
    value: String(index + 1),
    label: `${index + 1}日`,
  })),
  { value: "last", label: "月底" },
];
const INTERVAL_UNIT_OPTIONS = [
  { value: "hours", label: "小时" },
  { value: "days", label: "天" },
  { value: "weeks", label: "周" },
];

export function ScheduleFrequencyFields({
  form,
  onPatch,
}: {
  form: ScheduleFormState;
  onPatch: (patch: Partial<ScheduleFormState>) => void;
}) {
  return (
    <fieldset className={styles.scheduledFormField}>
      <legend>执行周期</legend>
      <div
        className={`${styles.scheduledTabs} ${styles.scheduledFrequencyTabs}`}
        role="tablist"
        aria-label="执行周期模式"
      >
        {(
          [
            ["cycle", "周期"],
            ["interval", "间隔"],
            ["once", "一次性"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={form.frequencyMode === value}
            onClick={() => onPatch({ frequencyMode: value })}
          >
            {label}
          </button>
        ))}
      </div>

      {form.frequencyMode === "cycle" ? (
        <div className={styles.scheduledCycleRow}>
          <ScheduleSelect
            ariaLabel="周期类型"
            prefix={null}
            value={form.cycleType}
            options={CYCLE_OPTIONS}
            className={styles.scheduledFormSelect}
            onChange={(value) =>
              onPatch({ cycleType: value as ScheduleFormState["cycleType"] })
            }
          />
          {form.cycleType === "daily" ? (
            <ScheduleTimePicker
              value={form.time}
              ariaLabel="每日执行时间"
              className={styles.scheduledDailyTime}
              onChange={(time) => onPatch({ time })}
            />
          ) : form.cycleType === "weekly" ? (
            <div className={styles.scheduledCycleConfig}>
              <ScheduleMultiSelect
                ariaLabel="每周执行日期"
                value={form.weekdays.map(String)}
                options={WEEKDAY_OPTIONS}
                onChange={(value) => onPatch({ weekdays: value.map(Number) })}
              />
              <ScheduleTimePicker
                value={form.time}
                ariaLabel="每周执行时间"
                onChange={(time) => onPatch({ time })}
              />
            </div>
          ) : (
            <div className={styles.scheduledMonthlyConfig}>
              <ScheduleMultiSelect
                ariaLabel="每月执行月份"
                value={form.months.map(String)}
                options={MONTH_OPTIONS}
                onChange={(value) => onPatch({ months: value.map(Number) })}
              />
              <ScheduleSelect
                ariaLabel="每月执行日期"
                prefix={null}
                value={String(form.dayOfMonth)}
                options={MONTH_DAY_OPTIONS}
                className={styles.scheduledFormSelect}
                onChange={(value) =>
                  onPatch({
                    dayOfMonth: value === "last" ? "last" : Number(value),
                  })
                }
              />
              <ScheduleTimePicker
                value={form.time}
                ariaLabel="每月执行时间"
                onChange={(time) => onPatch({ time })}
              />
              <small>若所选月份天数不足，按该月最后一天执行</small>
            </div>
          )}
        </div>
      ) : null}

      {form.frequencyMode === "interval" ? (
        <div className={styles.scheduledIntervalRow}>
          <span>每隔</span>
          <input
            type="number"
            min={1}
            value={form.intervalValue}
            aria-label="间隔数值"
            onChange={(event) =>
              onPatch({ intervalValue: Number(event.target.value) })
            }
          />
          <ScheduleSelect
            ariaLabel="间隔单位"
            prefix={null}
            value={form.intervalUnit}
            options={INTERVAL_UNIT_OPTIONS}
            className={styles.scheduledFormSelect}
            onChange={(value) =>
              onPatch({
                intervalUnit: value as ScheduleFormState["intervalUnit"],
              })
            }
          />
        </div>
      ) : null}

      {form.frequencyMode === "once" ? (
        <div className={styles.scheduledOnceRow}>
          <ScheduleDatePicker
            mode="single"
            value={{ start: form.onceDate }}
            placeholder="选择执行日期"
            ariaLabel="一次性执行日期"
            onChange={(value) => onPatch({ onceDate: value.start })}
          />
          <ScheduleTimePicker
            value={form.time}
            ariaLabel="一次性执行时间"
            onChange={(time) => onPatch({ time })}
          />
        </div>
      ) : null}
    </fieldset>
  );
}
