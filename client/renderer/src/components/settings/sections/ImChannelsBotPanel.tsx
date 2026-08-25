import {
  Bell,
  BriefcaseBusiness,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Inbox,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import {
  SettingRow,
  SettingsSelect,
  ToggleSwitch,
} from "@/components/settings";
import type {
  AgentSettings,
  ImBotCapability,
  ImBotInstance,
} from "@shared/types";
import { botCapabilities, channelLabel } from "./im-bot-bindings";

const NO_WORKSPACE = "__none__";
const NO_PROFILE = "__default__";

const CAPABILITIES: Array<{
  id: ImBotCapability;
  title: string;
  body: string;
}> = [
  { id: "inboundTasks", title: "群聊输入", body: "群消息可创建或继续任务。" },
  {
    id: "taskNotifications",
    title: "任务回推",
    body: "完成、失败、需关注时回推。",
  },
  {
    id: "scheduledNotifications",
    title: "定时通知",
    body: "定时任务结果可发到该机器人。",
  },
  {
    id: "permissionApprovals",
    title: "权限审批",
    body: "工具调用审批可在 IM 内确认。",
  },
];

export function ImChannelsBotPanel({
  bot,
  draft,
  onPatch,
  onRemove,
  workspaces,
}: {
  bot: ImBotInstance;
  draft: AgentSettings;
  onPatch: (patch: Partial<ImBotInstance>) => void;
  onRemove: () => void;
  workspaces: Array<{ name: string; path: string }>;
}) {
  const [expanded, setExpanded] = useState(false);
  const capabilities = botCapabilities(bot);
  const workspaceOptions = [
    { value: NO_WORKSPACE, label: "不绑定工作空间" },
    ...workspaces.map((workspace) => ({
      value: workspace.path,
      label: workspace.name || workspace.path,
    })),
  ];
  const profileOptions = [
    { value: NO_PROFILE, label: "跟随默认权限" },
    ...(draft.toolProfiles ?? []).map((profile) => ({
      value: profile.id,
      label: profile.name,
    })),
  ];

  return (
    <article className={`im-bot-row ${expanded ? "expanded" : ""}`}>
      <header className="im-bot-row-head">
        <button
          type="button"
          className="im-bot-expand-button"
          onClick={() => setExpanded((value) => !value)}
          title={expanded ? "收起机器人配置" : "展开机器人配置"}
          aria-expanded={expanded}
        >
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        <div className="im-bot-row-title">
          <strong title={bot.name}>{bot.name}</strong>
          <small>
            {channelLabel(bot.channel)} · {bot.chatName ?? "未绑定群聊"} ·{" "}
            {capabilities.length} 项能力
          </small>
        </div>
        <div className="settings-row-actions im-bot-actions">
          <span className={statusClass(bot)}>{statusLabel(bot)}</span>
          <label
            className="settings-inline-check im-bot-enable-check"
            title={bot.enabled ? "停用机器人" : "启用机器人"}
          >
            <input
              type="checkbox"
              checked={bot.enabled}
              onChange={() => onPatch({ enabled: !bot.enabled })}
            />
            启用
          </label>
          <button
            type="button"
            className="icon-button"
            title="移除"
            onClick={onRemove}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </header>
      {expanded ? (
        <div className="im-bot-row-body">
          <SettingRow
            icon={<BriefcaseBusiness size={16} />}
            title="绑定工作空间"
            description="非必填；未绑定时由消息上下文或用户选择空间。"
            trailing={
              <SettingsSelect
                ariaLabel="绑定工作空间"
                value={bot.workspacePath ?? NO_WORKSPACE}
                options={workspaceOptions}
                onChange={(value) =>
                  onPatch({
                    workspacePath: value === NO_WORKSPACE ? undefined : value,
                  })
                }
              />
            }
          />
          <SettingRow
            icon={<ShieldCheck size={16} />}
            title="权限策略"
            description="控制该机器人能触发的工具与审批方式。"
            trailing={
              <SettingsSelect
                ariaLabel="权限策略"
                value={bot.toolProfileId ?? NO_PROFILE}
                options={profileOptions}
                onChange={(value) =>
                  onPatch({
                    toolProfileId: value === NO_PROFILE ? undefined : value,
                  })
                }
              />
            }
          />
          <div className="im-capability-grid">
            {CAPABILITIES.map((capability) => (
              <SettingRow
                key={capability.id}
                icon={capabilityIcon(capability.id)}
                title={capability.title}
                description={capability.body}
                trailing={
                  <ToggleSwitch
                    checked={capabilities.includes(capability.id)}
                    onChange={() =>
                      onPatch({
                        capabilities: toggleCapability(
                          capabilities,
                          capability.id,
                        ),
                      })
                    }
                  />
                }
              />
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function toggleCapability(items: ImBotCapability[], item: ImBotCapability) {
  return items.includes(item)
    ? items.filter((value) => value !== item)
    : [...items, item];
}

function statusLabel(bot: ImBotInstance) {
  if (!bot.enabled) return "已停用";
  if (bot.status === "connected") return "已绑定";
  if (bot.status === "binding") return "绑定中";
  if (bot.status === "needsRebind") return "需重新绑定";
  return bot.status === "error" ? "异常" : "已暂停";
}

function statusClass(bot: ImBotInstance) {
  if (!bot.enabled || bot.status === "paused" || bot.status === "binding")
    return "settings-status";
  if (bot.status === "connected") return "settings-status ok";
  return "settings-status error";
}

function capabilityIcon(capability: ImBotCapability) {
  if (capability === "inboundTasks") return <Inbox size={16} />;
  if (capability === "scheduledNotifications")
    return <CalendarClock size={16} />;
  if (capability === "permissionApprovals") return <ShieldCheck size={16} />;
  return <Bell size={16} />;
}
