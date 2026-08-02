import type { CSSProperties, ReactNode } from "react";
import type { WorkbenchPlatform } from "./layout-model";

export function PlatformWindow({
  platform,
  primaryOpen,
  primaryPeeking,
  auxiliaryMode,
  auxiliarySwitching = false,
  style,
  children,
}: {
  platform: WorkbenchPlatform;
  primaryOpen: boolean;
  primaryPeeking: boolean;
  auxiliaryMode: "closed" | "open" | "primary-overlay";
  auxiliarySwitching?: boolean;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div
      className={`app-shell platform-window platform-${platform} ${primaryOpen ? "primary-expanded" : "primary-collapsed"} ${primaryPeeking ? "primary-peeking" : ""} auxiliary-${auxiliaryMode} ${auxiliarySwitching ? "is-auxiliary-switching" : ""}`}
      data-platform={platform}
      data-auxiliary-mode={auxiliaryMode}
      style={style}
    >
      {children}
    </div>
  );
}
