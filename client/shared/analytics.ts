/**
 * 行为埋点抽象（替代 @webank/wa-sdk 内部 SDK）
 *
 * 定义通用 AnalyticsProvider 接口 + 事件清单。
 * 默认 NoopAnalyticsProvider（无副作用），可扩展接入任意后端
 * （Sentry / 自建后端 / 公司内部 WA 等）。
 *
 * 事件清单对齐 marloues-client 的 WA_EVENTS，去掉 runtime 维度字段。
 */

export const ANALYTICS_EVENTS = {
  userActive: "project4_user_active",
  messageSend: "project4_message_send",
  mcpCall: "project4_mcp_call",
  skillUsageIntent: "project4_skill_usage_intent",
  skillUsageActual: "project4_skill_usage_actual",
  sessionStart: "project4_session_start",
  sessionEnd: "project4_session_end",
  uiAction: "project4_ui_action",
  securityDeny: "project4_security_deny",
  toolAudit: "project4_tool_audit",
  overLimit: "project4_over_limit",
} as const;

export const ANALYTICS_PAGE_IDS = {
  space: "space_page_view",
  settings: "settings_page_view",
  setupWorkspace: "setup_workspace_page_view",
} as const;

export type EventInfo = Record<
  string,
  string | number | boolean | null | undefined
>;

export interface AnalyticsUser {
  userId: string;
  env?: string;
}

export interface AnalyticsProvider {
  init(): Promise<void> | void;
  syncUser(user: AnalyticsUser | null): void;
  trackEvent(name: string, eventInfo?: EventInfo, eventValue?: string): void;
  trackPageView(pageId: string, eventInfo?: EventInfo): void;
  reportError(message: string, eventInfo?: EventInfo): void;
  reportWarn(message: string, eventInfo?: EventInfo): void;
}

export interface TrackMessageSendParams {
  conversationId?: string | null;
  spaceId?: string | null;
  textLength: number;
  model?: string | null;
}

export interface TrackSessionStartParams {
  conversationId?: string | null;
  spaceId?: string | null;
  model?: string | null;
}

export interface TokenUsageMetrics {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalCostUsd: number;
  contextWindow: number;
  cumulativeInputTokens?: number;
  cumulativeOutputTokens?: number;
  cumulativeCacheReadTokens?: number;
  cumulativeCacheCreationTokens?: number;
}

export interface TrackSessionEndParams {
  result: "success" | "failure";
  conversationId?: string | null;
  spaceId?: string | null;
  model?: string | null;
  detail?: string;
  errorType?: string;
  tokenUsage?: TokenUsageMetrics | null;
}

export interface TrackSkillIntentParams {
  skillName: string;
  conversationId?: string | null;
  spaceId?: string | null;
}

export interface TrackSkillActualParams {
  skillName: string;
  conversationId?: string | null;
  spaceId?: string | null;
  trigger?: string;
}

export interface TrackMcpCallParams {
  toolName: string;
  conversationId?: string | null;
  spaceId?: string | null;
  requiresApproval?: boolean;
}

export interface TrackSecurityDenyParams {
  event: string;
  toolName: string;
  skillName?: string;
  reason?: string;
  checkedAt?: number;
  conversationId?: string | null;
  spaceId?: string | null;
}

export interface TrackToolAuditParams {
  toolName: string;
  toolTarget?: string;
  toolInputSummary?: string;
  cwd?: string;
  conversationId: string;
  spaceId: string;
  agentId?: string | null;
  timestamp?: number;
}
