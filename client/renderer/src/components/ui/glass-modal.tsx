import type { ReactNode } from "react";

interface GlassModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Shared glassmorphism modal overlay.
 */
export function GlassModal({ open, onClose, children }: GlassModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto pt-[6vh] pb-10">
      <div
        role="presentation"
        className="fixed inset-0 bg-background/60 backdrop-blur-md transition-opacity duration-300"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-lg animate-in fade-in zoom-in-95 duration-200">
        {children}
      </div>
    </div>
  );
}

interface FormGlassCardProps {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * Glass card shell for forms inside a GlassModal.
 */
export function FormGlassCard({ title, icon, children, footer }: FormGlassCardProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-card/95 shadow-2xl shadow-black/30 backdrop-blur-xl">
      {/* Header */}
      <div className="flex items-center gap-2.5 border-b border-white/5 bg-gradient-to-b from-white/[0.06] to-transparent px-5 py-3">
        <div className="grid h-7 w-7 place-items-center rounded-lg bg-primary/15">
          {icon}
        </div>
        <span className="text-[13px] font-semibold text-foreground">{title}</span>
      </div>
      {/* Body */}
      <div className="px-5 py-4">{children}</div>
      {/* Footer */}
      {footer && (
        <div className="flex items-center justify-end gap-2 border-t border-white/5 bg-white/[0.02] px-5 py-3">
          {footer}
        </div>
      )}
    </div>
  );
}
