import {
  Bell,
  Bot,
  BriefcaseBusiness,
  CalendarClock,
  Inbox,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  SettingRow,
  SettingsSelect,
  ToggleSwitch,
} from "@/components/settings";
import type {
  AgentSettings,
  ImBotCapability,
  ImBotInstance,
  ImChannelKind,
} from "@shared/types";

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
  const capabilities = Array.isArray(bot.capabilities) ? bot.capabilities : [];
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
    <article className="im-bot-panel">
      <header className="im-bot-head">
        <div>
          <strong>{bot.name}</strong>
          <small>
            {channelLabel(bot.channel)} · {bot.chatName ?? "未绑定群聊"}
          </small>
        </div>
        <div className="settings-row-actions">
          <span className={statusClass(bot)}>{statusLabel(bot)}</span>
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
      <SettingRow
        icon={<Bot size={16} />}
        title="启用机器人"
        description="停用后不再接收输入或发送通知。"
        trailing={
          <ToggleSwitch
            checked={bot.enabled}
            onChange={() => onPatch({ enabled: !bot.enabled })}
          />
        }
      />
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
                    capabilities: toggleCapability(capabilities, capability.id),
                  })
                }
              />
            }
          />
        ))}
      </div>
    </article>
  );
}

function toggleCapability(items: ImBotCapability[], item: ImBotCapability) {
  return items.includes(item)
    ? items.filter((value) => value !== item)
    : [...items, item];
}

function channelLabel(channel: ImChannelKind) {
  return channel === "wecom" ? "企业微信" : "飞书";
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
