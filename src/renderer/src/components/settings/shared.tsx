import type { ReactNode } from "react";
import { Check } from "lucide-react";

export function SettingsCard({
  title,
  description,
  icon,
  action,
  children,
}: {
  title: string;
  description: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="settings-card">
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
  options: Array<{ value: string; title: string; description: string; icon: ReactNode }>;
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

export function EmptySettingsState({ title, body }: { title: string; body: string }) {
  return (
    <div className="settings-empty-state">
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

export function SettingsStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="settings-stat-card">
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}
