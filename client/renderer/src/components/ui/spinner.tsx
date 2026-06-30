import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type SpinnerSize = "sm" | "md" | "lg";

export interface SpinnerProps {
  size?: SpinnerSize;
  className?: string;
  label?: string;
}

const ICON_SIZE: Record<SpinnerSize, number> = {
  sm: 14,
  md: 18,
  lg: 24,
};

/** Loading indicator using the lucide Loader2 icon with a spin animation. */
export function Spinner({ size = "md", className, label }: SpinnerProps) {
  return (
    <Loader2
      size={ICON_SIZE[size]}
      className={cn("animate-spin", className)}
      style={{ color: "var(--accent)" }}
      aria-label={label}
      role={label ? "status" : undefined}
    />
  );
}
Spinner.displayName = "Spinner";
