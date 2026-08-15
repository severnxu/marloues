/**
 * 埋点单例入口
 *
 * 根据 MARLOUES_ENV.analyticsEnabled 选择 Provider：
 * - enabled + 有效 appId → WaAnalyticsProvider（上报到公司内部 WA 平台）
 * - enabled + appId 为空 → ConsoleAnalyticsProvider（开发调试兜底）
 * - disabled → NoopAnalyticsProvider（无副作用）
 *
 * 渲染端各处通过 trackMessageSend / trackSessionStart / trackSessionEnd /
 * trackPageView / trackUIAction / syncAnalyticsUser /
 * trackMcpCall / trackSkillIntent / trackSkillActual /
 * trackSecurityDeny / trackToolAudit 调用，不直接接触 Provider。
 */

import { MARLOUES_ENV } from "@shared/env";
import {
  ANALYTICS_EVENTS,
  type AnalyticsProvider,
  type AnalyticsUser,
  type EventInfo,
  type TrackMessageSendParams,
  type TrackSessionEndParams,
  type TrackSessionStartParams,
  type TrackMcpCallParams,
  type TrackSkillIntentParams,
  type TrackSkillActualParams,
  type TrackSecurityDenyParams,
  type TrackToolAuditParams,
} from "@shared/analytics";
import { NoopAnalyticsProvider } from "./noop-analytics";
import { ConsoleAnalyticsProvider } from "./console-analytics";
import { WaAnalyticsProvider } from "./wa-analytics";

let provider: AnalyticsProvider = new NoopAnalyticsProvider();
let initialized = false;
let started = false;

// baseInfo merged into every event (user_id, user_env, app_version, etc.)
let baseInfo: EventInfo = {};

// Session lifecycle tracking: per conversation+space, tracks turn_index
const sessionLifecycles = new Map<
  string,
  { nextTurnIndex: number; activeTurnIndex: number | null }
>();

// Pending skill actual tracking
const pendingSkillActual = new Map<string, { skillName: string }>();

const WA_EVENT_INFO_MAX_LENGTH = 512;

function getSessionTrackingKey(
  conversationId?: string | null,
  spaceId?: string | null,
): string | null {
  if (!conversationId || !spaceId) return null;
  return `${spaceId}:${conversationId}`;
}

function mergeEventInfo(eventInfo?: EventInfo): EventInfo {
  return { ...baseInfo, ...(eventInfo || {}) };
}

function getDailyActiveKey(userId: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return `project4:wa:daily-active:${userId}:${today}`;
}

function trackDailyActive(user: AnalyticsUser): void {
  const storageKey = getDailyActiveKey(user.userId);
  try {
    if (window.localStorage.getItem(storageKey) === "1") return;
  } catch {
    // ignore
  }
  trackEvent(ANALYTICS_EVENTS.userActive, {
    user_env: user.env || "",
    active_date: new Date().toISOString().slice(0, 10),
  });
  try {
    window.localStorage.setItem(storageKey, "1");
  } catch {
    // ignore
  }
}

function trackOverLimit(eventName: string, infoLength: number): void {
  if (!initialized || !started) return;
  const warnInfo = mergeEventInfo({
    event_name: eventName,
    info_length: infoLength,
  });
  provider.reportWarn(
    `event-info overLimit: ${eventName} len=${infoLength}`,
    warnInfo,
  );
  provider.trackEvent(ANALYTICS_EVENTS.overLimit, warnInfo);
}

export async function initAnalytics(): Promise<void> {
  if (initialized) return;
  if (MARLOUES_ENV.analyticsEnabled) {
    // 有 appId → 走真实 WA 上报；无 appId → 回退到 console 调试
    provider = MARLOUES_ENV.analyticsAppId
      ? new WaAnalyticsProvider()
      : new ConsoleAnalyticsProvider();
  } else {
    provider = new NoopAnalyticsProvider();
  }
  await provider.init();
  initialized = true;
}

export function syncAnalyticsUser(user: AnalyticsUser | null): void {
  void initAnalytics().then(() => {
    if (!user) {
      provider.syncUser(null);
      return;
    }
    // refresh baseInfo with user fields
    baseInfo = { ...baseInfo, user_id: user.userId, user_env: user.env || "" };
    provider.syncUser(user);
    if (!started) {
      started = true;
    }
    trackDailyActive(user);
  });
}

export function trackEvent(
  name: string,
  eventInfo?: EventInfo,
  eventValue?: string,
): void {
  if (!initialized || !started) return;
  const mergedInfo = mergeEventInfo(eventInfo);
  const infoStr = JSON.stringify(mergedInfo);
  if (infoStr.length > WA_EVENT_INFO_MAX_LENGTH) {
    trackOverLimit(name, infoStr.length);
  }
  provider.trackEvent(name, mergedInfo, eventValue);
}

export function trackPageView(pageId: string, eventInfo?: EventInfo): void {
  if (!initialized || !started) return;
  const mergedInfo = mergeEventInfo({ page_name: pageId, ...eventInfo });
  const infoStr = JSON.stringify(mergedInfo);
  if (infoStr.length > WA_EVENT_INFO_MAX_LENGTH) {
    trackOverLimit(pageId, infoStr.length);
  }
  provider.trackPageView(pageId, eventInfo);
}

export function trackUIAction(
  actionName: string,
  pageName: string,
  eventInfo?: EventInfo,
): void {
  trackEvent(ANALYTICS_EVENTS.uiAction, {
    action_type: "ui_action",
    action_name: actionName,
    page_name: pageName,
    ...eventInfo,
  });
}

export function trackMessageSend(params: TrackMessageSendParams): void {
  trackEvent(ANALYTICS_EVENTS.messageSend, {
    conversation_id: params.conversationId || "",
    space_id: params.spaceId || "",
    text_length: params.textLength,
    model: params.model || "",
  });
}

export function trackSessionStart(params: TrackSessionStartParams): void {
  const key = getSessionTrackingKey(params.conversationId, params.spaceId);
  if (!key) {
    trackEvent(ANALYTICS_EVENTS.sessionStart, {
      conversation_id: params.conversationId || "",
      space_id: params.spaceId || "",
      model: params.model || "",
    });
    return;
  }
  const lifecycle = sessionLifecycles.get(key) ?? {
    nextTurnIndex: 1,
    activeTurnIndex: null,
  };
  const turnIndex = lifecycle.nextTurnIndex;
  lifecycle.nextTurnIndex += 1;
  lifecycle.activeTurnIndex = turnIndex;
  sessionLifecycles.set(key, lifecycle);
  trackEvent(ANALYTICS_EVENTS.sessionStart, {
    conversation_id: params.conversationId || "",
    space_id: params.spaceId || "",
    turn_index: turnIndex,
    model: params.model || "",
  });
}

export function trackSessionEnd(params: TrackSessionEndParams): void {
  const key = getSessionTrackingKey(params.conversationId, params.spaceId);
  if (!key) {
    trackEvent(ANALYTICS_EVENTS.sessionEnd, {
      result: params.result,
      conversation_id: params.conversationId || "",
      space_id: params.spaceId || "",
      model: params.model || "",
      result_detail: params.detail || "",
      error_type: params.errorType || "",
    });
    return;
  }
  const lifecycle = sessionLifecycles.get(key);
  if (!lifecycle || lifecycle.activeTurnIndex === null) return;
  const turnIndex = lifecycle.activeTurnIndex;
  lifecycle.activeTurnIndex = null;
  pendingSkillActual.delete(key);
  trackEvent(ANALYTICS_EVENTS.sessionEnd, {
    result: params.result,
    conversation_id: params.conversationId || "",
    space_id: params.spaceId || "",
    turn_index: turnIndex,
    result_detail: params.detail || "",
    has_final_reply: params.result === "success",
    error_type: params.errorType || "",
    model: params.model || "",
    ...(params.tokenUsage
      ? {
          input_tokens:
            params.tokenUsage.cumulativeInputTokens ??
            params.tokenUsage.inputTokens,
          output_tokens:
            params.tokenUsage.cumulativeOutputTokens ??
            params.tokenUsage.outputTokens,
          cache_read_tokens:
            params.tokenUsage.cumulativeCacheReadTokens ??
            params.tokenUsage.cacheReadTokens,
          cache_creation_tokens:
            params.tokenUsage.cumulativeCacheCreationTokens ??
            params.tokenUsage.cacheCreationTokens,
          total_cost_usd: params.tokenUsage.totalCostUsd,
          context_window: params.tokenUsage.contextWindow,
        }
      : {}),
  });
}

export function classifyToolSource(
  toolName: string,
): "mcp" | "ai_browser" | "tool" {
  if (toolName.startsWith("mcp__ai-browser__")) return "ai_browser";
  if (toolName.startsWith("mcp__")) return "mcp";
  return "tool";
}

export function trackMcpCall(params: TrackMcpCallParams): void {
  const toolSource = classifyToolSource(params.toolName);
  if (toolSource === "tool") return;
  trackEvent(ANALYTICS_EVENTS.mcpCall, {
    tool_name: params.toolName,
    tool_source: toolSource,
    conversation_id: params.conversationId || "",
    space_id: params.spaceId || "",
    requires_approval: !!params.requiresApproval,
  });
}

export function trackSkillIntent(params: TrackSkillIntentParams): void {
  trackEvent(ANALYTICS_EVENTS.skillUsageIntent, {
    skill_name: params.skillName,
    conversation_id: params.conversationId || "",
    space_id: params.spaceId || "",
  });
}

export function trackSkillActual(params: TrackSkillActualParams): void {
  trackEvent(ANALYTICS_EVENTS.skillUsageActual, {
    skill_name: params.skillName,
    conversation_id: params.conversationId || "",
    space_id: params.spaceId || "",
    actual_trigger: params.trigger || "",
  });
}

export function setPendingSkillActualTracking(params: {
  skillName?: string;
  conversationId?: string | null;
  spaceId?: string | null;
}): void {
  const key = getSessionTrackingKey(params.conversationId, params.spaceId);
  if (!key) return;
  if (!params.skillName) {
    pendingSkillActual.delete(key);
    return;
  }
  pendingSkillActual.set(key, { skillName: params.skillName });
}

export function trackSkillActualIfPending(params: {
  conversationId?: string | null;
  spaceId?: string | null;
  trigger: string;
}): void {
  const key = getSessionTrackingKey(params.conversationId, params.spaceId);
  if (!key) return;
  const pending = pendingSkillActual.get(key);
  if (!pending) return;
  pendingSkillActual.delete(key);
  trackSkillActual({
    skillName: pending.skillName,
    conversationId: params.conversationId,
    spaceId: params.spaceId,
    trigger: params.trigger,
  });
}

export function trackSecurityDeny(params: TrackSecurityDenyParams): void {
  const reason = params.reason ? params.reason.slice(0, 50) : "";
  const merged = mergeEventInfo({
    event_name: params.event,
    tool_name: params.toolName,
    skill_name: params.skillName || "",
    deny_reason: reason,
    conversation_id: params.conversationId || "",
    space_id: params.spaceId || "",
  });
  // Dual-channel: wa.error() for ERROR level + trackEvent for structured data
  provider.reportError(
    `${params.event}: ${params.toolName} "${params.skillName || ""}" denied - ${reason}`,
    merged,
  );
  trackEvent(ANALYTICS_EVENTS.securityDeny, {
    event_name: params.event,
    tool_name: params.toolName,
    skill_name: params.skillName || "",
    deny_reason: reason,
    conversation_id: params.conversationId || "",
    space_id: params.spaceId || "",
  });
}

export function trackToolAudit(params: TrackToolAuditParams): void {
  trackEvent(ANALYTICS_EVENTS.toolAudit, {
    tool_name: params.toolName,
    tool_target: params.toolTarget || "",
    conversation_id: params.conversationId,
    space_id: params.spaceId,
  });
}
