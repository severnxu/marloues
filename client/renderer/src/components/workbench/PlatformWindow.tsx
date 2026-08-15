import type { CSSProperties, ReactNode } from "react";
import type { Page } from "./types";
import type {
  AuxiliaryMode,
  PrimaryTransition,
  WorkbenchPlatform,
} from "./layout-model";

export interface PlatformWindowProps {
  platform: WorkbenchPlatform;
  page: Page;
  primaryOpen: boolean;
  primaryPeeking: boolean;
  primaryTransition: PrimaryTransition;
  auxiliaryMode: AuxiliaryMode;
  auxiliarySwitching?: boolean;
  reviewAcceptance?: boolean;
  style?: CSSProperties;
  children: ReactNode;
}

/** Owns platform chrome and layout state markers for the full workbench. */
export function PlatformWindow({
  platform,
  page,
  primaryOpen,
  primaryPeeking,
  primaryTransition,
  auxiliaryMode,
  auxiliarySwitching = false,
  reviewAcceptance = false,
  style,
  children,
}: PlatformWindowProps) {
  const auxiliaryPrimary = auxiliaryMode === "primary-overlay";
  const classes = [
    "app-shell",
    "platform-window",
    `platform-${platform}`,
    platform === "macos" ? "platform-layout-macos" : "platform-layout-standard",
    primaryOpen
      ? "primary-open sidebar-expanded"
      : "primary-collapsed sidebar-collapsed",
    primaryPeeking ? "primary-peeking sidebar-peeking" : "",
    primaryTransition !== "idle"
      ? "primary-transitioning sidebar-transitioning"
      : "",
    primaryTransition !== "idle" ? `sidebar-${primaryTransition}` : "",
    auxiliaryPrimary ? "auxiliary-primary-overlay" : "",
    auxiliarySwitching ? "is-auxiliary-switching" : "",
    auxiliaryMode === "closed" ? "auxiliary-closed" : "auxiliary-open",
    reviewAcceptance ? "review-acceptance" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classes}
      data-platform={platform}
      data-page={page}
      data-primary-state={primaryOpen ? "open" : "closed"}
      data-primary-peeking={primaryPeeking || undefined}
      data-primary-transition={primaryTransition}
      data-auxiliary-mode={auxiliaryMode}
      data-auxiliary-switching={auxiliarySwitching || undefined}
      data-review={reviewAcceptance ? "acceptance" : undefined}
      style={style}
    >
      {children}
    </div>
  );
}
