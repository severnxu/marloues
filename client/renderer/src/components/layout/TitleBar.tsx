import type { CSSProperties } from "react";
import { Columns2, Minus, PanelLeft, Square, SquarePen, X } from "lucide-react";
import { GlobalSearchOverlay } from "@/components/layout/GlobalSearchOverlay";
import { useUnifiedChatStore } from "@/stores/unified-chat-store";
import type { Page, SettingsSection } from "@/components/layout/types";
import type { ThemeMode } from "@/stores/theme-store";

export function TitleBar({
  sidebarOpen,
  page,
  isDark: _isDark,
  themeMode: _themeMode,
  globalSearchOpen,
  onPage,
  onOpenSettings,
  onToggleSidebar,
  onToggleTheme: _onToggleTheme,
  onCloseSearch,
  style,
}: {
  sidebarOpen: boolean;
  page: Page;
  isDark: boolean;
  themeMode: ThemeMode;
  globalSearchOpen: boolean;
  onPage: (page: Page) => void;
  onOpenSettings: (section?: SettingsSection) => void;
  onToggleSidebar: () => void;
  onToggleTheme: () => void;
  onCloseSearch: () => void;
  style?: CSSProperties;
}) {
  const createSession = useUnifiedChatStore((s) => s.createSession);
  return (
    <header className="title-bar" style={style}>
      <div className="title-left">
        {page !== "settings" ? (
          <button onClick={onToggleSidebar} title={sidebarOpen ? "隐藏侧边栏" : "显示侧边栏"}>
            {sidebarOpen ? <Columns2 size={16} /> : <PanelLeft size={16} />}
          </button>
        ) : null}
        <span className="title-product-lockup" aria-hidden="true">
          <span className="title-product-mark">N</span>
          <span className="title-product-name">Marloues</span>
        </span>
        {!sidebarOpen && page === "chat" ? (
          <button onClick={() => { void createSession(); }} title="新对话" aria-label="新对话">
            <SquarePen size={16} />
          </button>
        ) : null}
      </div>
      <div className="title-right">
        <div className="window-actions">
          <button onClick={() => window.marloues.window.minimize()}>
            <Minus size={14} />
          </button>
          <button onClick={() => window.marloues.window.maximize()}>
            <Square size={12} />
          </button>
          <button onClick={() => window.marloues.window.close()}>
            <X size={14} />
          </button>
        </div>
      </div>
      <GlobalSearchOverlay
        open={globalSearchOpen}
        onClose={onCloseSearch}
        onPage={onPage}
        onOpenSettings={onOpenSettings}
      />
    </header>
  );
}
