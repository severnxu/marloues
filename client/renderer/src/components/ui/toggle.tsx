import * as React from "react";
import { cn } from "@/lib/utils";

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Optional accessible label */
  label?: string;
  className?: string;
  id?: string;
}

const TRACK_W = 36;
const TRACK_H = 20;

/**
 * Generic on/off switch. Not tied to settings — use anywhere a boolean
 * toggle is needed. Uses --accent for the on state.
 */
export function Toggle({
  checked,
  onChange,
  disabled = false,
  label,
  className,
  id,
}: ToggleProps) {
  const handleToggle = React.useCallback(() => {
    if (!disabled) onChange(!checked);
  }, [disabled, onChange, checked]);

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        handleToggle();
      }
    },
    [handleToggle],
  );

  const style: React.CSSProperties = {
    width: TRACK_W,
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
    background: checked ? "var(--accent)" : "var(--border)",
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? "not-allowed" : "pointer",
  };

  const thumbStyle: React.CSSProperties = {
    position: "absolute",
    top: 2,
    left: checked ? TRACK_W - (TRACK_H - 2) - 2 : 2,
    width: TRACK_H - 4,
    height: TRACK_H - 4,
    borderRadius: "50%",
    background: "#fff",
    transition: "left 160ms ease",
    boxShadow: "0 1px 2px rgba(0,0,0,0.25)",
  };

  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      style={style}
      className={cn("relative inline-flex shrink-0 border-none p-0", className)}
      onClick={handleToggle}
      onKeyDown={handleKeyDown}
    >
      <span style={thumbStyle} />
    </button>
  );
}
Toggle.displayName = "Toggle";
