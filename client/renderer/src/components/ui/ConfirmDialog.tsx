/**
 * ConfirmDialog - VSCode-style confirmation dialog
 * Ported from project-gui and styled with Marloues's CSS variables.
 */

import { useEffect } from "react";
import { createPortal } from "react-dom";

interface ConfirmDialogProps {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: "danger" | "warning" | "default";
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  variant = "danger",
}: ConfirmDialogProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const isInputFocused = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
      if (isInputFocused) return;

      if (event.key === "Escape") {
        onCancel();
      } else if (event.key === "Enter") {
        onConfirm();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel, onConfirm]);

  const confirmButtonClass =
    variant === "danger"
      ? "bg-destructive text-destructive-foreground hover:bg-red-500"
      : variant === "warning"
        ? "bg-amber-600 text-white hover:bg-amber-500"
        : "bg-primary text-primary-foreground hover:bg-blue-500";

  return createPortal(
    <div
      className="fixed inset-0 z-[12000] flex items-center justify-center bg-black/60 p-6 backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={onCancel}
    >
      <div
        className="relative grid w-full max-w-md gap-6 overflow-hidden rounded-xl border border-border bg-popover p-6 text-foreground shadow-marloues-lg"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby={message ? "confirm-dialog-message" : undefined}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="grid gap-2 whitespace-pre-wrap">
          <p id="confirm-dialog-title" className="m-0 text-sm leading-6 text-foreground">
            {title}
          </p>
          {message ? (
            <p id="confirm-dialog-message" className="m-0 text-xs leading-5 text-muted-foreground">
              {message}
            </p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg bg-transparent px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`rounded-lg px-4 py-1.5 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${confirmButtonClass}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
