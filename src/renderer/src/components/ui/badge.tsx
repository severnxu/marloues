import * as React from "react";
import { cn } from "@/lib/utils";

export type BadgeVariant =
  | "default"
  | "success"
  | "warning"
  | "danger"
  | "info";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

/**
 * Small status/label pill. Uses theme tokens; soft backgrounds are derived
 * from the semantic color via color-mix (falls back gracefully).
 */
export function Badge({
  variant = "default",
  className,
  style,
  ...props
}: BadgeProps) {
  const variantStyle = React.useMemo<React.CSSProperties>(() => {
    switch (variant) {
      case "success":
        return {
          color: "var(--success)",
          background: "color-mix(in srgb, var(--success) 14%, transparent)",
        };
      case "warning":
        return {
          color: "var(--warning)",
          background: "var(--warning-soft)",
        };
      case "danger":
        return {
          color: "var(--danger)",
          background: "color-mix(in srgb, var(--danger) 14%, transparent)",
        };
      case "info":
        return {
          color: "var(--info)",
          background: "color-mix(in srgb, var(--info) 14%, transparent)",
        };
      default:
        return {
          color: "var(--text)",
          background: "var(--panel-2)",
        };
    }
  }, [variant]);

  return (
    <span
      style={{ ...variantStyle, ...style }}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap",
        "px-2 py-0.5 text-xs font-medium",
        "rounded-[var(--radius-sm)] border border-[var(--border)]",
        className,
      )}
      {...props}
    />
  );
}
Badge.displayName = "Badge";
