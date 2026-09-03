import { useState } from "react";
import { Package, PlugZap } from "lucide-react";
import { SkillMarketplaceView } from "@/components/skills";
import { McpServersPanel } from "@/components/mcp";

export type PluginsTab = "skills" | "mcp";

interface PluginsViewProps {
  tab?: PluginsTab;
  onTabChange?: (tab: PluginsTab) => void;
}

const TABS: Array<{
  id: PluginsTab;
  label: string;
  icon: typeof Package;
}> = [
  {
    id: "skills",
    label: "Skills",
    icon: Package,
  },
  {
    id: "mcp",
    label: "MCP",
    icon: PlugZap,
  },
];

/**
 * 插件中心：统一管理 Skills（市场/已安装）与 MCP 服务。
 * 页面级 Tab 导航：顶部按钮式切换。
 */
export function PluginsView({
  tab: controlledTab,
  onTabChange,
}: PluginsViewProps) {
  const [internalTab, setInternalTab] = useState<PluginsTab>("skills");
  const tab = controlledTab ?? internalTab;
  const setTab = (nextTab: PluginsTab) => {
    setInternalTab(nextTab);
    onTabChange?.(nextTab);
  };

  return (
    <div data-testid="plugins-page" className="plugins-page" aria-label="插件">
      <header className="plugin-page-header">
        <div
          className="plugin-type-tabs no-drag"
          role="tablist"
          aria-label="插件类型"
          onKeyDown={(event) => {
            if (
              event.key !== "ArrowLeft" &&
              event.key !== "ArrowRight" &&
              event.key !== "Home" &&
              event.key !== "End"
            ) {
              return;
            }
            event.preventDefault();
            const currentIndex = TABS.findIndex((item) => item.id === tab);
            const nextIndex =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? TABS.length - 1
                  : (currentIndex +
                      (event.key === "ArrowRight" ? 1 : -1) +
                      TABS.length) %
                    TABS.length;
            setTab(TABS[nextIndex].id);
            requestAnimationFrame(() => {
              const tabs =
                event.currentTarget.querySelectorAll<HTMLElement>(
                  '[role="tab"]',
                );
              tabs[nextIndex]?.focus();
            });
          }}
        >
          {TABS.map(({ id, label, icon: Icon }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                className={active ? "is-active" : ""}
                type="button"
                onClick={() => setTab(id)}
              >
                <Icon aria-hidden="true" />
                {label}
              </button>
            );
          })}
        </div>
      </header>

      {/* 两个标签页保持挂载，仅切换显隐，保留各自的滚动位置与编辑状态 */}
      <div
        className={`plugin-panel${tab === "skills" ? "" : " is-hidden"}`}
        id="plugin-skills-panel"
        role="tabpanel"
      >
        <SkillMarketplaceView />
      </div>
      <div
        className={`plugin-mcp-panel${tab === "mcp" ? "" : " is-hidden"}`}
        id="plugin-mcp-panel"
        role="tabpanel"
      >
        <McpServersPanel />
      </div>
    </div>
  );
}
