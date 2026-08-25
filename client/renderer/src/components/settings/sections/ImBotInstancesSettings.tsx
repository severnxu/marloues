import { EmptySettingsState, SettingsStat } from "@/components/settings";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { AgentSettings, ImBotInstance } from "@shared/types";
import { ImChannelsBotPanel } from "./ImChannelsBotPanel";
import {
  botCapabilities,
  normalizeDraftImBotBindings,
} from "./im-bot-bindings";

export function ImBotInstancesSettings({
  draft,
  onCommitDraft,
}: {
  draft: AgentSettings;
  onCommitDraft: (nextDraft: AgentSettings) => void | Promise<void>;
}) {
  const workspaces = useWorkspaceStore((state) => state.settings.workspaces);
  const imBotBindings = normalizeDraftImBotBindings(draft);
  const bots = imBotBindings.bots;
  const enabledBots = bots.filter((bot) => bot.enabled);
  const inboundBots = enabledBots.filter((bot) =>
    botCapabilities(bot).includes("inboundTasks"),
  );
  const notificationBots = enabledBots.filter((bot) =>
    botCapabilities(bot).includes("scheduledNotifications"),
  );

  const commitBots = (nextBots: ImBotInstance[]) => {
    return onCommitDraft({
      ...draft,
      imBotBindings: { ...imBotBindings, bots: nextBots },
    });
  };
  const updateBot = (botId: string, patch: Partial<ImBotInstance>) => {
    void commitBots(
      bots.map((bot) => (bot.id === botId ? { ...bot, ...patch } : bot)),
    );
  };
  const removeBot = (botId: string) => {
    void commitBots(bots.filter((bot) => bot.id !== botId));
  };

  return (
    <div className="appearance-settings im-bots-page">
      <div className="settings-stat-grid">
        <SettingsStat label="已绑定机器人" value={String(bots.length)} />
        <SettingsStat label="可作为输入" value={String(inboundBots.length)} />
        <SettingsStat
          label="可接定时通知"
          value={String(notificationBots.length)}
        />
      </div>

      {bots.length ? (
        <section className="im-bot-section">
          <div className="im-bot-list">
            {bots.map((bot) => (
              <ImChannelsBotPanel
                key={bot.id}
                bot={bot}
                draft={draft}
                workspaces={workspaces}
                onPatch={(patch) => updateBot(bot.id, patch)}
                onRemove={() => removeBot(bot.id)}
              />
            ))}
          </div>
        </section>
      ) : (
        <EmptySettingsState
          title="还没有绑定机器人"
          body="在 IM 渠道页选择企微或飞书完成绑定。绑定后，可在这里分别设置工作空间、通知用途和权限策略。"
        />
      )}
    </div>
  );
}
