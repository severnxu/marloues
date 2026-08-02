import type { PointerEvent as ReactPointerEvent } from "react";
import { RightSidebar } from "@/components/layout/RightSidebar";
import { WorkflowChatPage } from "@/pages/WorkflowChatPage";
import type { PermissionDialogRequest } from "@shared/types";
import type {
  AuxiliaryMode,
  ResizeTarget,
  WorkbenchPlatform,
} from "./layout-model";
import { RuntimeStatus } from "./RuntimeStatus";
import { ResizeHandle } from "./ResizeHandle";
import { AuxiliarySidebarShell } from "./WorkbenchRegions";

export function WorkbenchChatLayout({
  platform,
  primaryOpen,
  auxiliaryMode,
  auxiliaryWidth,
  auxiliarySwitching,
  isRunning,
  permissionRequest,
  onPermissionRespond,
  onStartResize,
  onAuxiliaryMode,
}: {
  platform: WorkbenchPlatform;
  primaryOpen: boolean;
  auxiliaryMode: AuxiliaryMode;
  auxiliaryWidth: number;
  auxiliarySwitching: boolean;
  isRunning: boolean;
  permissionRequest?: PermissionDialogRequest;
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
    <>
      <div
        ref={(node) => {
          if (node) node.inert = auxiliaryPrimary;
        }}
        className="chat-region"
        aria-hidden={auxiliaryPrimary}
      >
        <WorkflowChatPage
          leftCollapsed={!primaryOpen}
          headerTrailing={
            platform === "macos" && !auxiliaryPrimary ? (
              <RuntimeStatus isRunning={isRunning} />
            ) : undefined
          }
          permissionRequest={permissionRequest}
          onPermissionRespond={onPermissionRespond}
        />
      </div>

      {auxiliaryMode === "open" ? (
        <ResizeHandle target="auxiliary" onPointerDown={onStartResize} />
      ) : null}

      {auxiliaryPrimary ? (
        <div
          className="auxiliary-layout-placeholder"
          style={{ width: auxiliaryWidth }}
          aria-hidden="true"
        />
      ) : null}

      <AuxiliarySidebarShell
        width={auxiliaryWidth}
        mode={auxiliaryMode}
        busy={auxiliarySwitching}
      >
        <RightSidebar
          primary={auxiliaryPrimary}
          onTogglePrimary={() =>
            onAuxiliaryMode(auxiliaryPrimary ? "open" : "primary-overlay")
          }
        />
      </AuxiliarySidebarShell>
    </>
  );
}
