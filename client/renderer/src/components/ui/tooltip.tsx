import * as React from "react";
import { cn } from "@/lib/utils";

export interface TooltipProps {
  /** Text or node shown in the tooltip bubble. */
  content: React.ReactNode;
  /** Side the bubble attaches to. */
  side?: "top" | "bottom" | "left" | "right";
  /** Delay before showing (ms). */
  delay?: number;
  children: React.ReactNode;
  className?: string;
}

type Side = NonNullable<TooltipProps["side"]>;

const POSITIONS: Record<Side, React.CSSProperties> = {
  top: {
    bottom: "100%",
    left: "50%",
    transform: "translateX(-50%)",
    marginBottom: 6,
  },
  bottom: {
    top: "100%",
    left: "50%",
    transform: "translateX(-50%)",
    marginTop: 6,
  },
  left: {
    right: "100%",
    top: "50%",
    transform: "translateY(-50%)",
    marginRight: 6,
  },
  right: {
    left: "100%",
    top: "50%",
    transform: "translateY(-50%)",
    marginLeft: 6,
  },
};

/**
 * Lightweight CSS-only-state tooltip (hover/focus to show). No portal —
 * keep ancestor positioned. For complex needs prefer a popper library.
 */
export function Tooltip({
  content,
  side = "top",
  delay = 100,
  children,
  className,
}: TooltipProps) {
  const [visible, setVisible] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = React.useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(true), delay);
  }, [delay]);

  const hide = React.useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
  }, []);

  React.useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const bubbleStyle: React.CSSProperties = {
    position: "absolute",
    zIndex: 50,
    pointerEvents: "none",
    maxWidth: 240,
    padding: "var(--space-1) var(--space-2)",
    background: "var(--panel-2)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
    fontSize: "var(--text-sm)",
    whiteSpace: "nowrap",
    ...POSITIONS[side],
  };

  return (
    <span
      className={cn("relative inline-flex", className)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {visible && content != null ? (
        <span role="tooltip" style={bubbleStyle}>
          {content}
        </span>
      ) : null}
    </span>
  );
}
Tooltip.displayName = "Tooltip";
