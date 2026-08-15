import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import styles from "./SchedulePage.module.css";

export interface ScheduleSelectOption {
  value: string;
  label: string;
}

export function ScheduleSelect({
  ariaLabel,
  prefix,
  value,
  options,
  className,
  onChange,
}: {
  ariaLabel: string;
  prefix: ReactNode;
  value: string;
  options: ScheduleSelectOption[];
  className?: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected =
    options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const rect = rootRef.current?.getBoundingClientRect();
    const boundary = rootRef.current
      ?.closest(`.${styles.modalBody}`)
      ?.getBoundingClientRect();
    if (rect) {
      const menuHeight = Math.min(options.length * 30 + 10, 240);
      setOpenUp(
        (boundary
          ? boundary.bottom - rect.bottom
          : window.innerHeight - rect.bottom) <
          menuHeight + 6,
      );
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, options.length]);

  return (
    <div
      ref={rootRef}
      className={`${styles.scheduledSelectControl} ${className ?? ""}`}
      data-open={open || undefined}
      data-open-up={open && openUp ? "true" : undefined}
    >
      <button
        type="button"
        className={styles.scheduledSelectTrigger}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className={styles.scheduledSelectPrefix}>{prefix}</span>
        <span className={styles.scheduledSelectValue}>{selected?.label}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open ? (
        <div
          className={styles.scheduledSelectMenu}
          role="listbox"
          aria-label={ariaLabel}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <span>{option.label}</span>
              {option.value === value ? (
                <Check size={13} aria-hidden="true" />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
