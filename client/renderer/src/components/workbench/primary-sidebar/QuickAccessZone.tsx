import {
  ArchiveRestore,
  Blocks,
  CalendarClock,
  SquarePen,
  type LucideIcon,
} from "lucide-react";
import type { Page } from "../types";

interface QuickAccessEntry {
  id: "schedules" | "plugins" | "replay";
  label: string;
  page: Page;
  icon: LucideIcon;
}

const QUICK_ACCESS_ENTRIES: readonly QuickAccessEntry[] = [
  {
    id: "schedules",
    label: "定时任务",
    page: "schedules",
    icon: CalendarClock,
  },
  { id: "plugins", label: "插件", page: "plugins", icon: Blocks },
  { id: "replay", label: "会话回放", page: "replay", icon: ArchiveRestore },
];

export function QuickAccessZone({
  page,
  isMacOS,
  showReplay = true,
  onNewConversation,
  onPage,
}: {
  page: Page;
  isMacOS: boolean;
  showReplay?: boolean;
  onNewConversation: () => void | Promise<void>;
  onPage: (page: Page) => void;
}) {
  const entries = showReplay
    ? QUICK_ACCESS_ENTRIES
    : QUICK_ACCESS_ENTRIES.filter((entry) => entry.id !== "replay");

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

      {entries.map((entry) => {
        const Icon = entry.icon;
        const active = page === entry.page;
        return (
          <button
            key={entry.id}
            className={`sidebar-command quick-access-entry ${active ? "active" : ""}`}
            type="button"
            data-quick-access={entry.id}
            aria-current={active ? "page" : undefined}
            onClick={() => onPage(entry.page)}
          >
            <Icon size={15} />
            <span>{entry.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
