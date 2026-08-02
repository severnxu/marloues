import type { CSSProperties, ReactNode } from "react";

export function PrimarySidebarShell({
  width,
  open,
  peeking,
  onPointerEnter,
  onPointerLeave,
  children,
}: {
  width: number;
  open: boolean;
  peeking: boolean;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  children: ReactNode;
}) {
  const interactive = open || peeking;

  return (
    <aside
      ref={(node) => {
        if (node) node.inert = !interactive;
      }}
      className={`sidebar-region primary-sidebar-shell ${open ? "open" : "closed"} ${peeking ? "is-peeking" : ""}`}
      style={{ width }}
      aria-hidden={!interactive}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <div className="sidebar-size-lock" style={{ width }}>
        {children}
      </div>
    </aside>
  );
}

export function MainWorkspaceShell({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <main className={`main-panel main-workspace-shell ${className}`}>
      {children}
    </main>
  );
}

export function AuxiliarySidebarShell({
  width,
  mode,
  busy = false,
  children,
}: {
  width: number;
  mode: "closed" | "open" | "primary-overlay";
  busy?: boolean;
  children: ReactNode;
}) {
  if (mode === "closed") return null;
  return (
    <aside
      className={`inspector-region auxiliary-sidebar-shell open ${mode === "primary-overlay" ? "is-primary-overlay" : ""}`}
      aria-busy={busy}
      style={
        mode === "primary-overlay"
          ? undefined
          : ({ width } satisfies CSSProperties)
      }
    >
      <div
        className="inspector-size-lock"
        style={{ width: mode === "primary-overlay" ? "100%" : width }}
      >
        {children}
      </div>
    </aside>
  );
}
