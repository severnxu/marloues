import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { ScheduleSelectOption } from "./ScheduleSelect";
import styles from "./SchedulePage.module.css";

export function ScheduleMultiSelect({
  ariaLabel,
  value,
  options,
  minSelected = 1,
  onChange,
}: {
  ariaLabel: string;
  value: string[];
  options: ScheduleSelectOption[];
  minSelected?: number;
  onChange: (value: string[]) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  useEffect(() => {
    if (!open) return;
    const rect = rootRef.current?.getBoundingClientRect();
    const boundary = rootRef.current
      ?.closest(`.${styles.modalBody}`)
      ?.getBoundingClientRect();
    if (rect) {
      const menuHeight = Math.min(options.length * 30 + 12, 238);
      setOpenUp(
        (boundary
          ? boundary.bottom - rect.bottom
          : window.innerHeight - rect.bottom) <
          menuHeight + 6,
      );
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
  }, [open, options.length]);

  const labels = options
    .filter((option) => value.includes(option.value))
    .map((option) => option.label);
  const summary =
    labels.length > 3
      ? `${labels.slice(0, 2).join("、")} 等 ${labels.length} 项`
      : labels.join("、");

  return (
    <div
      ref={rootRef}
      className={styles.scheduledMultiSelect}
      data-open={open || undefined}
      data-open-up={open && openUp ? "true" : undefined}
    >
      <button
        type="button"
        className={styles.scheduledMultiTrigger}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{summary}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open ? (
        <div
          className={styles.scheduledMultiOptions}
          role="listbox"
          aria-multiselectable="true"
        >
          {options.map((option) => {
            const checked = value.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={checked}
                onClick={() => {
                  if (checked && value.length <= minSelected) return;
                  onChange(
                    checked
                      ? value.filter((item) => item !== option.value)
                      : [...value, option.value],
                  );
                }}
              >
                <span>{option.label}</span>
                {checked ? <Check size={13} aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
