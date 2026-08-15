/**
 * WorkflowChatHeader — the compact title bar shown above the workflow chat area.
 * Extracted from WorkflowChatPage so that WorkbenchViewHost can import it
 * independently without pulling in the entire page.
 */

import { Folder, type LucideIcon } from "lucide-react";
import { useUnifiedChatStore } from "@/stores/unified-chat-store";

function formatSessionTitle(title?: string): string {
  const value = title?.trim();
  if (!value || value === "New chat" || value === "Untitled") {
    return "New chat";
  }
  return value;
}

export function WorkflowChatHeader({
  titleHidden = false,
  title,
  icon: HeaderIcon = Folder,
  className = "",
  threadSummary,
}: {
  titleHidden?: boolean;
  title?: string;
  icon?: LucideIcon;
  className?: string;
  threadSummary?: WorkflowChatHeaderThreadSummary;
}) {
  const activeSessionTitle = useUnifiedChatStore(
    (state) =>
      state.sessions.find((session) => session.id === state.activeSessionId)
        ?.title,
  );

  return (
    <div
      className={`chat-header${titleHidden ? " title-hidden" : ""}${className ? ` ${className}` : ""}`}
    >
      <span className="chat-header-title">
        <HeaderIcon size={15} aria-hidden="true" />
        {titleHidden
          ? ""
          : title === undefined
            ? formatSessionTitle(activeSessionTitle)
            : title}
      </span>
      {threadSummary?.available ? (
        <button
          type="button"
          className={`thread-summary-toggle${threadSummary.open ? " is-active" : ""}`}
          data-thread-summary-toggle
          aria-label={threadSummary.open ? "隐藏固定摘要" : "显示固定摘要"}
          aria-pressed={threadSummary.open}
          title={threadSummary.open ? "隐藏固定摘要" : "显示固定摘要"}
          onClick={threadSummary.onToggle}
        >
          <PinnedSummaryIcon />
        </button>
      ) : null}
    </div>
  );
}

export interface WorkflowChatHeaderThreadSummary {
  available: boolean;
  open: boolean;
  onToggle: () => void;
}

/** Exact path used by Codex Desktop 26.803.10989 for togglePinnedSummary. */
function PinnedSummaryIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      fill="currentColor"
      viewBox="0 0 20 20"
      aria-hidden="true"
      data-icon-contract="pinned-summary"
    >
      <path d="M5.693 11.056a2.71 2.71 0 0 1 2.432 2.694l-.015.277a2.71 2.71 0 0 1-2.694 2.432l-.276-.015a2.71 2.71 0 0 1-2.418-2.417l-.014-.277a2.709 2.709 0 0 1 2.708-2.708l.277.014Zm-.277 1.316a1.378 1.378 0 1 0 0 2.757 1.378 1.378 0 0 0 0-2.757Zm11.384.727a.665.665 0 0 1 0 1.302l-.134.014h-5.833a.665.665 0 0 1 0-1.33h5.833l.135.014ZM5.693 3.556A2.71 2.71 0 0 1 8.125 6.25l-.015.277A2.71 2.71 0 0 1 5.416 8.96l-.276-.015a2.71 2.71 0 0 1-2.418-2.417l-.014-.277a2.709 2.709 0 0 1 2.708-2.708l.277.014Zm-.277 1.316a1.378 1.378 0 1 0 .001 2.757 1.378 1.378 0 0 0-.001-2.757Zm11.384.727a.665.665 0 0 1 0 1.302l-.134.014h-5.833a.665.665 0 0 1 0-1.33h5.833l.135.014Z" />
    </svg>
  );
}
