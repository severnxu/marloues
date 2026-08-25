import {
  useEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { Check, ChevronDown } from "lucide-react";

export function SettingsCard({
  title,
  description,
  icon,
  action,
  children,
  surface = "list",
}: {
  title: string;
  description: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  surface?: "list" | "plain";
}) {
  return (
    <div className={`settings-card settings-card--${surface}`}>
      <div className="settings-card-head">
        <div className="settings-card-title">
          {icon ? <span className="settings-card-icon">{icon}</span> : null}
          <div>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
        </div>
        {action ? <div className="settings-card-action">{action}</div> : null}
      </div>
      <div className="settings-fields">{children}</div>
    </div>
  );
}

export function SettingRow({
  description,
  icon,
  title,
  trailing,
}: {
  description: string;
  icon: ReactNode;
  title: string;
  trailing: ReactNode;
}) {
  return (
    <div className="settings-row-inline">
      <span className="settings-row-icon">{icon}</span>
      <span className="settings-row-copy">
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <span className="settings-row-trailing">{trailing}</span>
    </div>
  );
}

export function ToggleSwitch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      className={`settings-switch ${checked ? "active" : ""}`}
      onClick={disabled ? undefined : onChange}
      type="button"
      aria-pressed={checked}
      disabled={disabled}
    >
      <span />
    </button>
  );
}

export function SegmentedOptions({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{
    value: string;
    title: string;
    description: string;
    icon: ReactNode;
  }>;
}) {
  return (
    <div className="settings-segmented-options">
      {options.map((option) => (
        <button
          key={option.value}
          className={value === option.value ? "active" : ""}
          onClick={() => onChange(option.value)}
          type="button"
        >
          <span>{value === option.value ? <Check size={14} /> : null}</span>
          <strong>{option.title}</strong>
          <small>{option.description}</small>
        </button>
      ))}
    </div>
  );
}

export function SettingsSelect({
  ariaLabel,
  value,
  options,
  onChange,
}: {
  ariaLabel: string;
  value: string;
  options: Array<{ value: string; label: string }>;
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
    if (rect) {
      const menuHeight = Math.min(options.length * 34 + 10, 240);
      setOpenUp(window.innerHeight - rect.bottom < menuHeight + 8);
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
      className="settings-select"
      data-open={open || undefined}
      data-open-up={open && openUp ? "true" : undefined}
    >
      <button
        type="button"
        className="settings-select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (
            event.key === "ArrowDown" ||
            event.key === "Enter" ||
            event.key === " "
          ) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="settings-select-value">{selected?.label}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open ? (
        <div
          className="settings-select-menu"
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

export function SettingsTextField({
  label,
  onValueChange,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "onChange"> & {
  label: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <label className="settings-field">
      <span>{label}</span>
      <input
        {...props}
        onChange={(event) => onValueChange(event.target.value)}
      />
    </label>
  );
}

export function SettingsTextarea({
  fieldClassName,
  hideLabel = false,
  label,
  onValueChange,
  ...props
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange"> & {
  fieldClassName?: string;
  hideLabel?: boolean;
  label: string;
  onValueChange?: (value: string) => void;
}) {
  return (
    <label
      className={`settings-field settings-field--textarea ${fieldClassName ?? ""}`}
    >
      <span className={hideLabel ? "settings-field-label--hidden" : undefined}>
        {label}
      </span>
      <textarea
        {...props}
        onChange={
          onValueChange
            ? (event) => onValueChange(event.target.value)
            : undefined
        }
      />
    </label>
  );
}

export function EmptySettingsState({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <div className="settings-empty-state">
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

export function SettingsStat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="settings-stat-card">
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}
