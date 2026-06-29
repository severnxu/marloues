import * as React from "react";
import { cn } from "@/lib/utils";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Reusable confirm dialog with glass effect.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "确认",
  cancelLabel = "取消",
  variant = "default",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        role="presentation"
        className="fixed inset-0 bg-background/60 backdrop-blur-md"
        onClick={onCancel}
      />
      <div className="relative z-10 w-full max-w-sm overflow-hidden rounded-2xl border border-white/10 bg-card/95 shadow-2xl shadow-black/30 backdrop-blur-xl animate-in fade-in zoom-in-95 duration-200">
        <div className="px-5 py-4">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-white/5 bg-white/[0.02] px-5 py-3">
          <button
            className="h-8 rounded-md px-3 text-sm text-muted-foreground hover:bg-secondary"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            className={cn(
              "h-8 rounded-md px-3 text-sm font-medium transition-colors",
              variant === "danger"
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : "bg-primary text-primary-foreground hover:brightness-110",
            )}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
