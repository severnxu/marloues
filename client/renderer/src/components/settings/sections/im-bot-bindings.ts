import type { AgentSettings, ImBotInstance } from "@shared/types";

export function normalizeDraftImBotBindings(
  draft: AgentSettings,
): AgentSettings["imBotBindings"] {
  const bindings = draft.imBotBindings;
  if (!bindings || !Array.isArray(bindings.bots)) {
    return { bots: [] };
  }
  return bindings;
}

export function botCapabilities(
  bot: ImBotInstance,
): ImBotInstance["capabilities"] {
  return Array.isArray(bot.capabilities) ? bot.capabilities : [];
}

export function channelLabel(channel: ImBotInstance["channel"]) {
  return channel === "wecom" ? "企业微信" : "飞书";
}
