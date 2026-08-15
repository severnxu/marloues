import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { AuxiliarySidebar } from "./auxiliary-sidebar";
import type { AuxiliaryMode, ResizeTarget } from "./layout-model";
import { ResizeHandle } from "./ResizeHandle";
import {
  AuxiliaryLayoutPlaceholder,
  AuxiliarySidebarShell,
} from "./WorkbenchRegions";

export interface WorkbenchAuxiliaryHostProps {
  mode: AuxiliaryMode;
  width: number;
  busy?: boolean;
  onTogglePrimary: () => void;
  onStartResize: (
    target: ResizeTarget,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => void;
  regionRef?: (node: HTMLDivElement | null) => void;
  children?: ReactNode;
}

/** The auxiliary tree stays mounted so tab and panel state survives closing. */
export function WorkbenchAuxiliaryHost({
  mode,
  width,
  busy = false,
  onTogglePrimary,
  onStartResize,
  regionRef,
  children,
}: WorkbenchAuxiliaryHostProps) {
  return (
    <>
      {mode === "open" ? (
        <ResizeHandle
          target="auxiliary"
          ariaLabel="调整右侧辅助栏宽度"
          onPointerDown={(event) => onStartResize("auxiliary", event)}
        />
      ) : null}

      {mode === "primary-overlay" ? (
        <AuxiliaryLayoutPlaceholder width={width} />
      ) : null}

      <AuxiliarySidebarShell
        mode={mode}
        width={width}
        busy={busy}
        regionRef={regionRef}
      >
        {children ?? (
          <AuxiliarySidebar
            open={mode !== "closed"}
            primary={mode === "primary-overlay"}
            onTogglePrimary={onTogglePrimary}
          />
        )}
      </AuxiliarySidebarShell>
    </>
  );
}
