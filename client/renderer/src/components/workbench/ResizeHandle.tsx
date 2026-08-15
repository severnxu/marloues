import { type PointerEvent as ReactPointerEvent } from "react";
import { WORKBENCH_GEOMETRY, type ResizeTarget } from "./layout-model";

const TARGET_CLASS: Record<ResizeTarget, string> = {
  primary: "frame-resize-handle",
  auxiliary: "inspector-resize-handle",
};

export function ResizeHandle({
  target,
  ariaLabel,
  onPointerDown,
}: {
  target: ResizeTarget;
  ariaLabel: string;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const bounds =
    target === "primary"
      ? {
          min: WORKBENCH_GEOMETRY.primaryMin,
          max: WORKBENCH_GEOMETRY.primaryMax,
        }
      : {
          min: WORKBENCH_GEOMETRY.auxiliaryMin,
          max: WORKBENCH_GEOMETRY.auxiliaryMax,
        };

  return (
    <div
      className={`workbench-resize-handle is-${target} ${TARGET_CLASS[target]}`}
      data-resize-target={target}
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      aria-valuemin={bounds.min}
      aria-valuemax={bounds.max}
      onPointerDown={onPointerDown}
    />
  );
}
