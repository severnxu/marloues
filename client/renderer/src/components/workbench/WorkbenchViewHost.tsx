import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { PermissionRequestOverlay } from "@/components/layout/PermissionRequestOverlay";
import type { Page, SettingsSection } from "@/components/layout/types";
import { SettingsPage } from "@/pages/SettingsPage";
import type { PermissionDialogRequest } from "@shared/types";
import type {
  AuxiliaryMode,
  ResizeTarget,
  WorkbenchPlatform,
} from "./layout-model";
import { WorkbenchChatLayout } from "./WorkbenchChatLayout";

export function WorkbenchViewHost({
  page,
  platform,
  primaryOpen,
  auxiliaryMode,
  auxiliaryWidth,
  auxiliarySwitching,
  isRunning,
  settingsSection,
  permissionRequest,
  contentFrameRef,
  onSettingsSection,
  onPermissionRespond,
  onStartResize,
  onAuxiliaryMode,
}: {
  page: Page;
  platform: WorkbenchPlatform;
  primaryOpen: boolean;
  auxiliaryMode: AuxiliaryMode;
  auxiliaryWidth: number;
  auxiliarySwitching: boolean;
  isRunning: boolean;
  settingsSection: SettingsSection;
  permissionRequest?: PermissionDialogRequest;
  contentFrameRef: RefObject<HTMLDivElement>;
  onSettingsSection: (section: SettingsSection) => void;
  onPermissionRespond: (
    approved: boolean,
    scope?: "once" | "session",
    reason?: string,
  ) => void;
  onStartResize: (
    target: ResizeTarget,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => void;
  onAuxiliaryMode: (mode: AuxiliaryMode) => void;
}) {
  const auxiliaryPrimary = auxiliaryMode === "primary-overlay";

  return (
    <div
      className={`content-frame ${auxiliaryPrimary ? "auxiliary-overlay-active" : ""}`}
      ref={contentFrameRef}
    >
      {page === "chat" ? (
        <WorkbenchChatLayout
          platform={platform}
          primaryOpen={primaryOpen}
          auxiliaryMode={auxiliaryMode}
          auxiliaryWidth={auxiliaryWidth}
          auxiliarySwitching={auxiliarySwitching}
          isRunning={isRunning}
          permissionRequest={permissionRequest}
          onPermissionRespond={onPermissionRespond}
          onStartResize={onStartResize}
          onAuxiliaryMode={onAuxiliaryMode}
        />
      ) : (
        <div className="settings-region">
          <SettingsPage
            section={settingsSection}
            onSection={onSettingsSection}
          />
          <PermissionRequestOverlay
            request={permissionRequest}
            onRespond={onPermissionRespond}
          />
        </div>
      )}
    </div>
  );
}
