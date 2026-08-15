import { useEffect, useMemo, useRef, useState } from "react";
import { Clock } from "lucide-react";
import type { ScheduleTimeSpec } from "@shared/types";
import styles from "./SchedulePage.module.css";

type TimePart = "hour" | "minute";

function wrap(value: number, size: number): number {
  return ((value % size) + size) % size;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function ScheduleTimePicker({
  value,
  onChange,
  ariaLabel,
  className,
}: {
  value: ScheduleTimeSpec;
  onChange: (value: ScheduleTimeSpec) => void;
  ariaLabel: string;
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activePart, setActivePart] = useState<TimePart>("hour");
  const [openUp, setOpenUp] = useState(false);

  useEffect(() => {
    if (!open) return;
    const rect = rootRef.current?.getBoundingClientRect();
    const boundary = rootRef.current
      ?.closest(`.${styles.modalBody}`)
      ?.getBoundingClientRect();
    if (rect) {
      const availableBelow = boundary
        ? boundary.bottom - rect.bottom
        : window.innerHeight - rect.bottom;
      setOpenUp(availableBelow < 178);
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
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
  }, [open]);

  const shift = (part: TimePart, delta: number) => {
    if (part === "hour")
      onChange({ ...value, hour: wrap(value.hour + delta, 24) });
    else onChange({ ...value, minute: wrap(value.minute + delta, 60) });
  };

  const wheels = useMemo(
    () =>
      (["hour", "minute"] as const).map((part) => {
        const current = value[part];
        const size = part === "hour" ? 24 : 60;
        return {
          part,
          options: [-2, -1, 0, 1, 2].map((distance) => ({
            distance,
            value: wrap(current + distance, size),
          })),
        };
      }),
    [value],
  );

  return (
    <div
      ref={rootRef}
      className={`${styles.scheduledTimePicker} ${className ?? ""}`}
      data-open={open || undefined}
      data-open-up={open && openUp ? "true" : undefined}
      role="combobox"
      aria-label={ariaLabel}
      aria-haspopup="dialog"
      aria-expanded={open}
      tabIndex={0}
      onClick={() => setOpen((current) => !current)}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          setActivePart(event.key === "ArrowLeft" ? "hour" : "minute");
        } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          shift(activePart, event.key === "ArrowUp" ? -1 : 1);
        } else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setOpen((current) => !current);
        }
      }}
    >
      <span className={styles.scheduledTimeValue}>
        {pad(value.hour)}:{pad(value.minute)}
      </span>
      <Clock size={15} aria-hidden="true" />
      {open ? (
        <div
          className={styles.scheduledTimePopover}
          role="dialog"
          aria-label={`${ariaLabel}选择器`}
          onClick={(event) => event.stopPropagation()}
        >
          <div className={styles.scheduledTimeWheelPanel}>
            {wheels.map((wheel, index) => (
              <div key={wheel.part} className={styles.scheduledTimeWheelGroup}>
                {index === 1 ? (
                  <span className={styles.scheduledTimeSeparator}>:</span>
                ) : null}
                <div
                  className={styles.scheduledTimeWheel}
                  role="listbox"
                  aria-label={wheel.part === "hour" ? "小时" : "分钟"}
                  onWheel={(event) => {
                    event.preventDefault();
                    setActivePart(wheel.part);
                    shift(wheel.part, event.deltaY > 0 ? 1 : -1);
                  }}
                >
                  {wheel.options.map((option) => (
                    <button
                      key={`${wheel.part}-${option.distance}`}
                      type="button"
                      role="option"
                      aria-selected={option.distance === 0}
                      data-distance={Math.abs(option.distance)}
                      onClick={() => {
                        setActivePart(wheel.part);
                        shift(wheel.part, option.distance);
                      }}
                    >
                      {pad(option.value)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
