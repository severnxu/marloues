import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ImChannelsSettings } from "../../../../../../../client/renderer/src/components/settings/sections/ImChannelsSettings";
import type { AgentSettings } from "../../../../../../../client/shared/types";

describe("ImChannelsSettings", () => {
  it("renders scan binding entry points and bot routing controls", () => {
    const html = renderToStaticMarkup(
      <ImChannelsSettings draft={settingsFixture()} onCommitDraft={() => {}} />,
    );

    expect(html).toContain("扫码绑定企业微信");
    expect(html).toContain("扫码绑定飞书");
    expect(html).toContain("机器人实例");
    expect(html).toContain("发布群助手");
    expect(html).toContain("绑定工作空间");
    expect(html).toContain("权限策略");
    expect(html).toContain("定时通知");
    expect(html).toContain("数据与权限映射");
    expect(html).not.toContain("机器人 Webhook");
    expect(html).not.toContain("App Secret");
    expect(html).not.toContain("settings-row-card");
  });

  it("renders an empty state when an older settings file has no IM bindings", () => {
    const { imBotBindings: _imBotBindings, ...legacySettings } =
      settingsFixture();

    const html = renderToStaticMarkup(
      <ImChannelsSettings
        draft={legacySettings as AgentSettings}
        onCommitDraft={() => {}}
      />,
    );

    expect(html).toContain("扫码绑定企业微信");
    expect(html).toContain("扫码绑定飞书");
    expect(html).toContain("还没有绑定机器人");
  });

  it("renders older bot records with missing capability arrays", () => {
    const settings = settingsFixture();
    const [bot] = settings.imBotBindings.bots;
    settings.imBotBindings.bots = [
      { ...bot, capabilities: undefined as never },
    ];

    const html = renderToStaticMarkup(
      <ImChannelsSettings draft={settings} onCommitDraft={() => {}} />,
    );

    expect(html).toContain("发布群助手");
    expect(html).toContain("绑定工作空间");
  });
});

function settingsFixture(): AgentSettings {
  return {
    providers: [],
    defaultModel: { providerId: "default-endpoint", modelId: "default" },
    activeRuntimeId: "sdk",
    maxTurns: 50,
    workMode: "execute",
    permissionMode: "default",
    permissionApprovalTimeoutMs: 120_000,
    desktopNotificationsEnabled: true,
    customInstructions: "",
    memoryMode: "workspace",
    autoMemoryEnabled: true,
    thinkingEnabled: true,
    maxThinkingTokens: 10240,
    activeToolProfileId: "default-tool-policy",
    toolProfiles: [
      {
        id: "default-tool-policy",
        name: "Default",
        description: "Default tool policy",
        permissionMode: "default",
        allowedTools: ["Read"],
        disallowedTools: [],
      },
    ],
    mcpServers: [],
    imBotBindings: {
      bots: [
        {
          id: "wecom-release",
          channel: "wecom",
          name: "发布群助手",
          enabled: true,
          bindMode: "scan",
          status: "connected",
          chatName: "发布群",
          workspacePath: "C:\\workspace\\marloues",
          toolProfileId: "default-tool-policy",
          capabilities: [
            "inboundTasks",
            "taskNotifications",
            "scheduledNotifications",
            "permissionApprovals",
          ],
        },
      ],
    },
    disabledSkills: [],
  };
}
