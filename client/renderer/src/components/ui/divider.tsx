import * as React from "react";
import { cn } from "@/lib/utils";

export type DividerOrientation = "horizontal" | "vertical";

export interface DividerProps {
  orientation?: DividerOrientation;
  className?: string;
}

/**
 * Thin separator using the theme border token.
 * horizontal: full-width line. vertical: full-height line (give the
 * ancestor a defined height / flex layout).
 */
export function Divider({
  orientation = "horizontal",
  className,
}: DividerProps) {
  const style: React.CSSProperties =
    orientation === "horizontal"
      ? { width: "100%", height: 1, display: "block" }
      : {
          height: "100%",
          width: 1,
          display: "inline-block",
          alignSelf: "stretch",
        };

  return (
    <span
      role="separator"
      aria-orientation={orientation}
      style={{ ...style, background: "var(--border)", border: "none" }}
      className={cn("shrink-0", className)}
    />
  );
}
Divider.displayName = "Divider";
