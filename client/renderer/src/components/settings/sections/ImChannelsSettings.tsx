import { useState } from "react";
import { Bell, Inbox, Link2, QrCode, ShieldCheck } from "lucide-react";
import { SettingsCard, SettingRow } from "@/components/settings";
import { notify } from "@/lib/notifications";
import type {
  AgentSettings,
  ImBotInstance,
  ImChannelKind,
} from "@shared/types";
import { ImChannelIcon } from "./ImChannelIcon";
import {
  ImChannelsBindingDialog,
  type ImManualBindingInput,
} from "./ImChannelsBindingDialog";
import { channelLabel, normalizeDraftImBotBindings } from "./im-bot-bindings";

const CHANNELS: Array<{ id: ImChannelKind; label: string; body: string }> = [
  {
    id: "wecom",
    label: "企业微信",
    body: "管理员扫码安装应用或机器人后，将群消息、审批和通知接入 Marloues。",
  },
  {
    id: "feishu",
    label: "飞书",
    body: "管理员扫码授权后，可为不同群或机器人分别绑定空间和权限策略。",
  },
];

export function ImChannelsSettings({
  draft,
  onCommitDraft,
}: {
  draft: AgentSettings;
  onCommitDraft: (nextDraft: AgentSettings) => void | Promise<void>;
}) {
  const imBotBindings = normalizeDraftImBotBindings(draft);
  const [bindingChannel, setBindingChannel] = useState<ImChannelKind | null>(
    null,
  );
  const bots = imBotBindings.bots;

  const commitBots = (nextBots: ImBotInstance[]) => {
    return onCommitDraft({
      ...draft,
      imBotBindings: { ...imBotBindings, bots: nextBots },
    });
  };
  const addBoundBot = async (
    channel: ImChannelKind,
    input: ImManualBindingInput,
  ) => {
    if (!window.marloues?.im) {
      throw new Error("当前客户端未暴露 IM 后端接口");
    }
    const currentConfig = await window.marloues.im.getConfig();
    await window.marloues.im.saveConfig({
      ...currentConfig,
      ...(channel === "wecom"
        ? {
            wecom: {
              ...currentConfig.wecom,
              enabled: true,
              botId: input.botId,
              secret: input.secret,
              requireMention: currentConfig.wecom?.requireMention ?? true,
            },
          }
        : {
            feishu: {
              ...currentConfig.feishu,
              enabled: true,
              appId: input.botId,
              appSecret: input.secret,
              requireMention: currentConfig.feishu?.requireMention ?? true,
            },
          }),
    });

    const testResult = await window.marloues.im.testChannel(channel);
    if (!testResult.success) {
      throw new Error(
        testResult.error ?? `${channelLabel(channel)}连接测试失败`,
      );
    }

    const now = Date.now();
    const sameChannelCount = bots.filter(
      (bot) => bot.channel === channel,
    ).length;
    await commitBots([
      ...bots,
      {
        id: `${channel}-manual-${now}`,
        channel,
        name: `${channelLabel(channel)}机器人 ${sameChannelCount + 1}`,
        enabled: true,
        bindMode: input.bindMode ?? "manual",
        status: "connected",
        capabilities: [
          "inboundTasks",
          "taskNotifications",
          "scheduledNotifications",
          "permissionApprovals",
        ],
        botExternalId: input.botId,
        manualSecret: input.secret,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    notify({
      title: `${channelLabel(channel)}机器人已绑定`,
      description: "已保存配置并完成连接测试。",
      tone: "success",
    });
  };

  return (
    <div className="appearance-settings im-channels-page">
      <div className="im-channel-bind-grid">
        {CHANNELS.map((channel) => (
          <button
            key={channel.id}
            type="button"
            className="im-bind-tile"
            onClick={(event) => {
              event.currentTarget.blur();
              setBindingChannel(channel.id);
            }}
          >
            <ImChannelIcon channel={channel.id} />
            <span>
              <strong>扫码绑定{channel.label}</strong>
              <small>{channel.body}</small>
            </span>
            <QrCode size={18} aria-hidden="true" />
          </button>
        ))}
      </div>

      <SettingsCard
        title="数据与权限映射"
        description="IM 只承载入口、通知和审批，任务仍使用统一 WorkflowTurnItem 数据模型。"
        icon={<Link2 size={16} />}
      >
        <SettingRow
          icon={<Inbox size={16} />}
          title="输入来源"
          description="群消息写入 wecom / feishu zone，并携带 botId、chatId、userId。"
          trailing={<span className="settings-status">设计就绪</span>}
        />
        <SettingRow
          icon={<Bell size={16} />}
          title="通知路由"
          description="定时任务后续应选择具体机器人实例，而不是只选企微或飞书。"
          trailing={<span className="settings-status">待选择机器人</span>}
        />
        <SettingRow
          icon={<ShieldCheck size={16} />}
          title="权限控制"
          description="每个机器人绑定工具权限策略，IM 内审批只回写对应会话。"
          trailing={<span className="settings-status ok">纳入配置</span>}
        />
      </SettingsCard>

      {bindingChannel ? (
        <ImChannelsBindingDialog
          channel={bindingChannel}
          onClose={() => setBindingChannel(null)}
          onManualSave={(input) => addBoundBot(bindingChannel, input)}
        />
      ) : null}
    </div>
  );
}
