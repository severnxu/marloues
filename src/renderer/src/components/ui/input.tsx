import * as React from "react";
import { cn } from "@/lib/utils";

export type InputVariant = "default" | "error";
export type InputSize = "sm" | "md";
export type InputType = "text" | "password" | "search" | "number";

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size" | "type"> {
  variant?: InputVariant;
  inputSize?: InputSize;
  type?: InputType;
}

const sizeStyles: Record<InputSize, string> = {
  sm: "text-xs",
  md: "text-sm",
};

const variantStyles: Record<InputVariant, string> = {
  default: "",
  error: "",
};

/**
 * Primitive text input. Uses CSS variables for theming so it adapts to
 * the active light/dark/grayscale theme. Variant/error state is applied
 * via inline styles so it works without additional global classes.
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    { className, variant = "default", inputSize = "md", type = "text", ...props },
    ref,
  ) => {
    const isError = variant === "error";
    const style: React.CSSProperties = {
      background: "var(--panel-2)",
      color: "var(--text)",
      borderColor: isError ? "var(--danger)" : "var(--border)",
      borderRadius: "var(--radius-md)",
      paddingInline: "var(--space-2)",
      height: inputSize === "sm" ? 28 : 36,
    };
    return (
      <input
        ref={ref}
        type={type}
        style={style}
        className={cn(
          "w-full border transition-colors outline-none",
          "focus:border-[var(--accent)]",
          "placeholder:text-[var(--muted)]",
          sizeStyles[inputSize],
          variantStyles[variant],
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";
