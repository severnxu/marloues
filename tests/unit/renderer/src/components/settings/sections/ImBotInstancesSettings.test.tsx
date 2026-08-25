import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ImBotInstancesSettings } from "../../../../../../../client/renderer/src/components/settings/sections/ImBotInstancesSettings";
import type { AgentSettings } from "../../../../../../../client/shared/types";

describe("ImBotInstancesSettings", () => {
  it("renders bot instance statistics in collapsed rows", () => {
    const html = renderToStaticMarkup(
      <ImBotInstancesSettings
        draft={settingsFixture()}
        onCommitDraft={() => {}}
      />,
    );

    expect(html).toContain("已绑定机器人");
    expect(html).toContain("发布群助手");
    expect(html).toContain("可作为输入");
    expect(html).toContain("可接定时通知");
    expect(html).toContain("4 项能力");
    expect(html).not.toContain("绑定工作空间");
    expect(html).not.toContain("权限策略");
  });

  it("renders an empty state when an older settings file has no IM bindings", () => {
    const { imBotBindings: _imBotBindings, ...legacySettings } =
      settingsFixture();

    const html = renderToStaticMarkup(
      <ImBotInstancesSettings
        draft={legacySettings as AgentSettings}
        onCommitDraft={() => {}}
      />,
    );

    expect(html).toContain("还没有绑定机器人");
    expect(html).toContain("在 IM 渠道页选择企微或飞书完成绑定");
  });

  it("renders older bot records with missing capability arrays", () => {
    const settings = settingsFixture();
    const [bot] = settings.imBotBindings.bots;
    settings.imBotBindings.bots = [
      { ...bot, capabilities: undefined as never },
    ];

    const html = renderToStaticMarkup(
      <ImBotInstancesSettings draft={settings} onCommitDraft={() => {}} />,
    );

    expect(html).toContain("发布群助手");
    expect(html).toContain("0 项能力");
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
