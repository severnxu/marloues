import type { PointerEvent } from "react";
import type { ResizeTarget } from "./layout-model";

export function ResizeHandle({
  target,
  disabled = false,
  onPointerDown,
}: {
  target: ResizeTarget;
  disabled?: boolean;
  onPointerDown: (
    target: ResizeTarget,
    event: PointerEvent<HTMLDivElement>,
  ) => void;
}) {
  return (
    <div
      className={`workbench-resize-handle is-${target}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={
        target === "primary" ? "调整左侧边栏宽度" : "调整右侧辅助区宽度"
      }
      aria-disabled={disabled}
      onPointerDown={
        disabled ? undefined : (event) => onPointerDown(target, event)
      }
    />
  );
}
