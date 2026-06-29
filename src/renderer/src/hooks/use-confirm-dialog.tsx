/**
 * useConfirmDialog - Hook for showing confirmation dialogs.
 * Ported from project-gui for promise-based async/await usage.
 */

import { useCallback, useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel?: string;
  variant?: "danger" | "warning" | "default";
}

export function useConfirmDialog() {
  const [dialog, setDialog] = useState<
    | (ConfirmOptions & {
        cancelLabel: string;
        onConfirm: () => void;
        onCancel: () => void;
      })
    | null
  >(null);

  const showConfirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setDialog({
        ...options,
        cancelLabel: options.cancelLabel ?? "取消",
        onConfirm: () => {
          setDialog(null);
          resolve(true);
        },
        onCancel: () => {
          setDialog(null);
          resolve(false);
        },
      });
    });
  }, []);

  const DialogComponent = dialog ? <ConfirmDialog {...dialog} /> : null;

  return { showConfirm, DialogComponent };
}
