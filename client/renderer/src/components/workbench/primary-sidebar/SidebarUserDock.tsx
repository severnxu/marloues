import { useCallback, useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { useAuthStore } from "@/stores/auth-store";
import { useUnifiedChatStore } from "@/stores/unified-chat-store";
import { useThemeStore } from "@/stores/theme-store";
import { useSettingsPageStore } from "@/stores/settings-page-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import * as SidebarParts from "./SidebarParts";
import { SidebarUpdateBadge } from "./SidebarUpdateBadge";

export function SidebarUserDock() {
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const session = useAuthStore((state) => state.session);
  const logout = useAuthStore((state) => state.logout);
  const themeMode = useThemeStore((state) => state.mode);
  const setThemeMode = useThemeStore((state) => state.setMode);
  const workspace = useWorkspaceStore((state) => state.current);
  const openSettingsPage = useSettingsPageStore((s) => s.openSection);
  const streamingSessionIds = useUnifiedChatStore(
    (state) => state.streamingSessionIds,
  );

  const displayName =
    session?.displayName ||
    session?.username ||
    session?.email ||
    "Marloues User";
  const displayDetail = workspace
    ? "本地工作台"
    : session?.email || "未选择工作区";
  const avatarInitial = getAvatarInitials(displayName);

  const hasRunningTasks = Object.values(streamingSessionIds).some(Boolean);

  const stopRunningTasksForUpdate = useCallback(async () => {
    const chatStore = useUnifiedChatStore.getState();
    const activeSessionIds = Object.entries(chatStore.streamingSessionIds)
      .filter(([, active]) => Boolean(active))
      .map(([sessionId]) => sessionId);
    await Promise.all(
      activeSessionIds.map((sessionId) => chatStore.abort(sessionId)),
    );
  }, []);

  useEffect(() => {
    if (!userMenuOpen) return;

    const close = (event: MouseEvent) => {
      if (userMenuRef.current?.contains(event.target as Node)) return;
      if ((event.target as HTMLElement).closest("[data-sidebar-theme-menu]"))
        return;
      setUserMenuOpen(false);
    };

    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [userMenuOpen]);

  return (
    <div className="sidebar-user-dock" ref={userMenuRef}>
      {userMenuOpen ? (
        <SidebarParts.UserInfoPopover
          workspaceName={workspace?.name}
          session={session}
          avatarInitial={avatarInitial}
          themeMode={themeMode}
          onSetThemeMode={setThemeMode}
          onSettings={(section) => {
            openSettingsPage(section);
            setUserMenuOpen(false);
          }}
          onLogout={() => {
            setUserMenuOpen(false);
            void logout();
          }}
        />
      ) : null}
      <div className="sidebar-user-footer-row">
        <button
          className={`sidebar-user-button ${userMenuOpen ? "active" : ""}`}
          type="button"
          onClick={() => setUserMenuOpen((open) => !open)}
          aria-haspopup="dialog"
          aria-expanded={userMenuOpen}
          title="用户信息"
        >
          <span className="sidebar-user-avatar" aria-hidden="true">
            {avatarInitial}
          </span>
          <span className="sidebar-user-copy">
            <strong>{displayName}</strong>
            <small>{displayDetail}</small>
          </span>
          <MoreHorizontal className="sidebar-user-more" aria-hidden="true" />
        </button>
        <SidebarUpdateBadge
          hasRunningTasks={hasRunningTasks}
          onStopRunningTasks={stopRunningTasksForUpdate}
        />
      </div>
    </div>
  );
}

function getAvatarInitials(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    return words
      .slice(0, 2)
      .map((word) => word[0])
      .join("")
      .toUpperCase();
  }
  return words[0]?.slice(0, 2).toUpperCase() || "N";
}
