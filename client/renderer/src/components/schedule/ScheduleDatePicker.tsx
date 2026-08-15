import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import styles from "./SchedulePage.module.css";

export interface ScheduleDateValue {
  start: string;
  end?: string;
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function readDate(value?: string): Date | null {
  const match = value ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  return match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : null;
}

function displayDate(value?: string): string {
  return value ? value.replaceAll("-", "/") : "";
}

export function ScheduleDatePicker({
  mode,
  value,
  onChange,
  ariaLabel,
  placeholder,
  className,
}: {
  mode: "single" | "range";
  value: ScheduleDateValue;
  onChange: (value: ScheduleDateValue) => void;
  ariaLabel: string;
  placeholder: string;
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState("");
  const initial = readDate(value.start) ?? new Date();
  const [viewYear, setViewYear] = useState(initial.getFullYear());
  const [viewMonth, setViewMonth] = useState(initial.getMonth());
  const [position, setPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    const selected = readDate(value.start) ?? new Date();
    setViewYear(selected.getFullYear());
    setViewMonth(selected.getMonth());
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !popupRef.current?.contains(target)
      )
        setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, value.start]);

  useLayoutEffect(() => {
    if (!open) return;
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = popupRef.current?.offsetWidth ?? 336;
    const height = popupRef.current?.offsetHeight ?? 366;
    const left = Math.min(
      Math.max(12, rect.left),
      window.innerWidth - width - 12,
    );
    const below = rect.bottom + 7;
    const top =
      below + height <= window.innerHeight - 12
        ? below
        : Math.max(12, rect.top - height - 7);
    setPosition({ left, top });
  }, [open, viewMonth, viewYear]);

  const days = useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1);
    const mondayOffset = (first.getDay() + 6) % 7;
    const start = new Date(viewYear, viewMonth, 1 - mondayOffset);
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(
        start.getFullYear(),
        start.getMonth(),
        start.getDate() + index,
      );
      return {
        date,
        key: dateKey(date),
        outside: date.getMonth() !== viewMonth,
      };
    });
  }, [viewMonth, viewYear]);

  const label =
    mode === "single"
      ? displayDate(value.start) || placeholder
      : value.start
        ? `${displayDate(value.start)} — ${displayDate(value.end) || "选择结束日期"}`
        : placeholder;
  const today = dateKey(new Date());
  const visualStart =
    mode === "range" &&
    value.start &&
    !value.end &&
    hover &&
    hover < value.start
      ? hover
      : value.start;
  const visualEnd =
    mode === "range" && value.start && !value.end && hover
      ? hover < value.start
        ? value.start
        : hover
      : value.end;

  const select = (key: string) => {
    if (mode === "single") {
      onChange({ start: key });
      setOpen(false);
      return;
    }
    if (!value.start || value.end) onChange({ start: key });
    else if (key < value.start) onChange({ start: key, end: value.start });
    else onChange({ start: value.start, end: key });
    setHover("");
  };

  const shiftView = (months: number, years = 0) => {
    const next = new Date(viewYear + years, viewMonth + months, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  };

  const calendar = open ? (
    <div
      ref={popupRef}
      className={styles.scheduledCalendarPopover}
      role="dialog"
      aria-label={`${ariaLabel}日历`}
      style={position ? position : { left: 0, top: 0, visibility: "hidden" }}
      onMouseLeave={() => setHover("")}
    >
      <header className={styles.scheduledCalendarHeader}>
        <button
          type="button"
          aria-label="上一年"
          onClick={() => shiftView(0, -1)}
        >
          <ChevronsLeft size={14} />
        </button>
        <button type="button" aria-label="上个月" onClick={() => shiftView(-1)}>
          <ChevronLeft size={14} />
        </button>
        <strong>
          {viewYear}年{viewMonth + 1}月
        </strong>
        <button type="button" aria-label="下个月" onClick={() => shiftView(1)}>
          <ChevronRight size={14} />
        </button>
        <button
          type="button"
          aria-label="下一年"
          onClick={() => shiftView(0, 1)}
        >
          <ChevronsRight size={14} />
        </button>
      </header>
      <div className={styles.scheduledCalendarWeekdays} aria-hidden="true">
        {(["一", "二", "三", "四", "五", "六", "日"] as const).map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className={styles.scheduledCalendarGrid}>
        {days.map((day) => {
          const disabled = day.outside || day.key < today;
          const selected = day.key === value.start || day.key === value.end;
          const previewSelected =
            mode === "range" && !value.end && day.key === hover;
          const inRange = Boolean(
            visualStart &&
            visualEnd &&
            day.key > visualStart &&
            day.key < visualEnd,
          );
          return (
            <button
              key={day.key}
              type="button"
              className={styles.scheduledCalendarDay}
              aria-disabled={disabled}
              tabIndex={disabled ? -1 : 0}
              data-outside={day.outside || undefined}
              data-past={day.key < today || undefined}
              data-today={day.key === today || undefined}
              data-selected={selected || undefined}
              data-preview-selected={previewSelected || undefined}
              data-in-range={inRange || undefined}
              data-range-start={day.key === visualStart || undefined}
              data-range-end={day.key === visualEnd || undefined}
              aria-label={displayDate(day.key)}
              aria-pressed={selected}
              onMouseEnter={() => {
                if (mode === "range" && value.start && !value.end && !disabled)
                  setHover(day.key);
              }}
              onClick={(event) => {
                if (disabled) {
                  event.preventDefault();
                  event.stopPropagation();
                  return;
                }
                select(day.key);
              }}
            >
              <span>{day.date.getDate()}</span>
            </button>
          );
        })}
      </div>
      <footer className={styles.scheduledCalendarFooter}>
        <span>
          {mode === "single"
            ? displayDate(value.start) || "请选择日期"
            : label.replace("选择生效日期", "请选择开始日期")}
        </span>
        <button type="button" onClick={() => select(today)}>
          今天
        </button>
      </footer>
    </div>
  ) : null;

  return (
    <div
      ref={rootRef}
      className={`${styles.scheduledDatePicker} ${className ?? ""}`}
    >
      <button
        type="button"
        className={styles.scheduledDateRangeTrigger}
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => {
          if (!open) setPosition(null);
          setOpen((current) => !current);
        }}
      >
        <span>{label}</span>
        <CalendarDays size={15} />
      </button>
      {calendar ? createPortal(calendar, document.body) : null}
    </div>
  );
}
