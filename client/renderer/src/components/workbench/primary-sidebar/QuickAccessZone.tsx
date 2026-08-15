import { SquarePen } from "lucide-react";

export function QuickAccessZone({
  isMacOS,
  onNewConversation,
}: {
  isMacOS: boolean;
  onNewConversation: () => void | Promise<void>;
}) {
  return (
    <nav
      className="sidebar-command-list quick-access-zone"
      aria-label="常用功能快捷入口"
    >
      <button
        className="sidebar-command quick-access-entry"
        type="button"
        data-quick-access="new-conversation"
        onClick={() => void onNewConversation()}
      >
        <SquarePen size={15} />
        <span>新建会话</span>
        <kbd>{isMacOS ? "⌘N" : "Ctrl+N"}</kbd>
      </button>
    </nav>
  );
}
