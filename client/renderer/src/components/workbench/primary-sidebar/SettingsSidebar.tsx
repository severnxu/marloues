import {
  ArrowLeft,
  Bot,
  FileText,
  Info,
  MonitorCog,
  Package,
  ServerCog,
  Settings,
  Terminal,
  Wrench,
} from "lucide-react";
import type { SettingsSection } from "@/components/settings/types";
import type { Page } from "../types";

export function SettingsSidebar({
  settingsSection,
  onSettingsSection,
  onPage,
}: {
  settingsSection: SettingsSection;
  onSettingsSection: (section: SettingsSection) => void;
  onPage: (page: Page) => void;
}) {
  const navItems = [
    {
      id: "general" as const,
      label: "通用",
      description: "运行行为与通知",
      icon: <Wrench size={16} />,
    },
    {
      id: "personalization" as const,
      label: "个性化",
      description: "回复风格与指令",
      icon: <Bot size={16} />,
    },
    {
      id: "appearance" as const,
      label: "外观",
      description: "主题和强调色",
      icon: <MonitorCog size={16} />,
    },
    {
      id: "providers" as const,
      label: "模型",
      description: "端点与模型",
      icon: <ServerCog size={16} />,
    },
    {
      id: "skills" as const,
      label: "Skills",
      description: "导入与详情",
      icon: <Package size={16} />,
    },
    {
      id: "runtimes" as const,
      label: "运行时",
      description: "Python/Node 下载",
      icon: <Terminal size={16} />,
    },
    {
      id: "audit" as const,
      label: "审计",
      description: "工具调用",
      icon: <FileText size={16} />,
    },
    {
      id: "version" as const,
      label: "版本",
      description: "应用与组件版本",
      icon: <Info size={16} />,
    },
  ];

  return (
    <aside className="sidebar settings-sidebar">
      <div className="settings-side-top">
        <button onClick={() => onPage("chat")}>
          <ArrowLeft size={16} />
          返回对话
        </button>
      </div>
      <div className="settings-side-body">
        <div className="settings-side-label">
          <Settings size={14} />
          设置
        </div>
        <nav className="settings-side-nav">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={settingsSection === item.id ? "active" : ""}
              onClick={() => onSettingsSection(item.id)}
            >
              {item.icon}
              <span>
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </span>
            </button>
          ))}
        </nav>
      </div>
    </aside>
  );
}
