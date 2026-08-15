import type { CSSProperties, PointerEventHandler, ReactNode } from "react";
import type { AuxiliaryMode } from "./layout-model";

type RegionRef = (node: HTMLDivElement | null) => void;

export function WorkbenchLayout({
  settingsPage = false,
  children,
}: {
  settingsPage?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`workspace workbench-layout ${settingsPage ? "settings-paper-workspace" : ""}`}
    >
      {children}
    </div>
  );
}

export function PrimarySidebarShell({
  open,
  peeking,
  width,
  onPointerEnter,
  onPointerLeave,
  regionRef,
  children,
}: {
  open: boolean;
  peeking: boolean;
  width: number;
  onPointerEnter?: PointerEventHandler<HTMLElement>;
  onPointerLeave?: PointerEventHandler<HTMLElement>;
  regionRef?: RegionRef;
  children: ReactNode;
}) {
  const interactive = open || peeking;

  return (
    <div
      ref={(node) => {
        regionRef?.(node);
        if (node) node.inert = !interactive;
      }}
      className={`sidebar-region primary-sidebar ${open ? "open" : "closed"} ${peeking ? "is-peeking" : ""}`}
      data-state={open ? "open" : "closed"}
      aria-hidden={!interactive}
      style={{ width }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <div
        className="sidebar-size-lock primary-sidebar-size-lock"
        style={{ width }}
      >
        {children}
      </div>
    </div>
  );
}

export function WorkbenchMainColumns({
  regionRef,
  children,
}: {
  regionRef?: RegionRef;
  children: ReactNode;
}) {
  return (
    <div className="workbench-main-columns" ref={regionRef}>
      {children}
    </div>
  );
}

export function WorkbenchOverlayHost({ children }: { children: ReactNode }) {
  return <div className="workbench-overlay-host">{children}</div>;
}

export function MainWorkspaceShell({
  settingsPage,
  obscured = false,
  children,
}: {
  settingsPage: boolean;
  obscured?: boolean;
  children: ReactNode;
}) {
  return (
    <main
      ref={(node) => {
        if (node) node.inert = obscured;
      }}
      className={`main-panel main-workspace ${settingsPage ? "settings-paper-main" : ""}`}
      aria-hidden={obscured || undefined}
    >
      <div className="content-frame">{children}</div>
    </main>
  );
}

export function AuxiliarySidebarShell({
  mode,
  width,
  busy = false,
  regionRef,
  children,
}: {
  mode: AuxiliaryMode;
  width: number;
  busy?: boolean;
  regionRef?: RegionRef;
  children: ReactNode;
}) {
  const closed = mode === "closed";
  const primary = mode === "primary-overlay";
  const inaccessible = closed || busy;
  const style = {
    width: mode === "open" ? width : closed ? 0 : undefined,
  } satisfies CSSProperties;

  return (
    <div
      ref={(node) => {
        regionRef?.(node);
        if (node) node.inert = inaccessible;
      }}
      className={`inspector-region auxiliary-sidebar ${closed ? "closed" : "open"} ${primary ? "is-primary is-primary-overlay" : ""}`}
      data-mode={mode}
      aria-hidden={inaccessible}
      aria-busy={busy || undefined}
      style={style}
    >
      <div
        className="inspector-size-lock auxiliary-size-lock"
        style={{ width: primary ? "100%" : width }}
      >
        {children}
      </div>
    </div>
  );
}

export function AuxiliaryLayoutPlaceholder({ width }: { width: number }) {
  return (
    <div
      className="auxiliary-layout-placeholder"
      aria-hidden="true"
      style={{ width }}
    />
  );
}
