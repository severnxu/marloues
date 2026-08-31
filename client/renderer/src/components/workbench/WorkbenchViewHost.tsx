import { memo, useCallback, useRef, type ReactNode } from "react";
import { WorkflowChatHeader } from "@/pages/WorkflowChatHeader";
import { WorkflowChatPage } from "@/pages/WorkflowChatPage";
import type { PermissionDialogRequest } from "@shared/types";
import { PermissionRequestPanel } from "./interaction";
import type { Page } from "./types";
import {
  useTaskContextLayout,
  useTaskPresentationModel,
} from "@/components/workflow-chat/task-context";
import { shouldPlaceThreadSummaryInWindowTitlebar } from "./layout-model";

export interface WorkbenchViewHostProps {
  page: Page;
  isMacOS: boolean;
  sidebarOpen: boolean;
  auxiliaryOpen: boolean;
  hideChatTitle: boolean;
  auxiliaryObscuresMain: boolean;
  permissionRequest?: PermissionDialogRequest;
  onPermissionRespond: (
    approved: boolean,
    scope?: "once" | "session",
    reason?: string,
  ) => void;
}

interface KeepAliveViewProps {
  name: Page;
  active: boolean;
  obscured?: boolean;
  className?: string;
  children: ReactNode;
}

/** Hides inactive pages without unmounting their business state. */
export function KeepAliveWorkbenchView({
  name,
  active,
  obscured = false,
  className = "",
  children,
}: KeepAliveViewProps) {
  const interactive = active && !obscured;
  const setRegionRef = useCallback(
    (node: HTMLElement | null) => {
      if (node) node.inert = !interactive;
    },
    [interactive],
  );

  return (
    <section
      ref={setRegionRef}
      className={`workspace-view workspace-view-${name} ${className}`}
      data-view={name}
      data-active={active || undefined}
      hidden={!active}
      aria-hidden={!interactive}
    >
      {children}
    </section>
  );
}

interface PersistentChatWorkspaceProps {
  isMacOS: boolean;
  sidebarOpen: boolean;
  auxiliaryOpen: boolean;
  hideChatTitle: boolean;
  permissionRequest?: PermissionDialogRequest;
  onPermissionRespond: WorkbenchViewHostProps["onPermissionRespond"];
}

/**
 * The chat business tree is intentionally isolated from quick-page routing.
 * Switching to a quick page only hides its outer region; unchanged chat props
 * do not cause WorkflowChatPage to render again.
 */
const PersistentChatWorkspace = memo(function PersistentChatWorkspace({
  isMacOS,
  sidebarOpen,
  auxiliaryOpen,
  hideChatTitle,
  permissionRequest,
  onPermissionRespond,
}: PersistentChatWorkspaceProps) {
  const { model, gitLoading, refreshGitContext } = useTaskPresentationModel();
  const taskContext = useTaskContextLayout({
    available: model.hasData,
    sessionId: model.sessionId,
  });
  const headerTaskContext = {
    available: model.hasData,
    open: taskContext.open,
    onToggle: taskContext.toggle,
  };

  return (
    <>
      {!isMacOS ? (
        <WorkflowChatHeader
          titleHidden={hideChatTitle}
          threadSummary={headerTaskContext}
        />
      ) : null}
      <div className="chat-region" ref={taskContext.regionRef}>
        <WorkflowChatPage
          leftCollapsed={isMacOS && !sidebarOpen}
          titleHidden={hideChatTitle}
          showHeader={isMacOS}
          taskPresentation={model}
          taskContextMode={taskContext.mode}
          taskContextControl={headerTaskContext}
          taskContextInWindowTitlebar={shouldPlaceThreadSummaryInWindowTitlebar(
            isMacOS,
            auxiliaryOpen,
          )}
          taskContextGitLoading={gitLoading}
          onTaskContextRefresh={refreshGitContext}
          onTaskContextCloseFloating={taskContext.closeFloating}
          permissionRequest={permissionRequest}
          onPermissionRespond={onPermissionRespond}
        />
      </div>
    </>
  );
});

export function WorkbenchViewHost({
  page,
  isMacOS,
  sidebarOpen,
  auxiliaryOpen,
  hideChatTitle,
  auxiliaryObscuresMain,
  permissionRequest,
  onPermissionRespond,
}: WorkbenchViewHostProps) {
  const mountedViews = useRef(new Set<Page>(["chat", page]));
  mountedViews.current.add(page);

  return (
    <div className="workspace-view-stack">
      <KeepAliveWorkbenchView
        name="chat"
        active={page === "chat"}
        obscured={auxiliaryObscuresMain}
      >
        <PersistentChatWorkspace
          isMacOS={isMacOS}
          sidebarOpen={sidebarOpen}
          auxiliaryOpen={auxiliaryOpen}
          hideChatTitle={hideChatTitle}
          permissionRequest={permissionRequest}
          onPermissionRespond={onPermissionRespond}
        />
      </KeepAliveWorkbenchView>

      {page !== "chat" && permissionRequest ? (
        <div className="permission-page-overlay">
          <PermissionRequestPanel
            request={permissionRequest}
            onRespond={onPermissionRespond}
          />
        </div>
      ) : null}
    </div>
  );
}
