/**
 * IM IPC — 渲染进程 ↔ 主进程 的 IM 通道常量与载荷类型
 */

import type {
  ImChannelId,
  ImChannelSecretsConfig,
  RendererImSession,
} from "./im-types";

export const IM_IPC = {
  /** 渲染 → 主：读取渠道配置（主进程负责解密） */
  GET_CONFIG: "im:get-config",
  /** 渲染 → 主：保存渠道配置（主进程负责加密落盘 + 热更新） */
  SAVE_CONFIG: "im:save-config",
  /** 渲染 → 主：测试渠道连通性 */
  TEST_CHANNEL: "im:test-channel",
  /** 主 → 渲染：连接状态推送 */
  SET_STATUS: "im:set-status",
  /** 渲染 → 主：IM 会话列表（source=im） */
  LIST_SESSIONS: "im:list-sessions",
  /** 主 → 渲染：IM 会话列表变更（新会话/回合完成），渲染端刷新 */
  SESSION_UPDATED: "im:session-updated",
  /** 渲染 → 主：企微扫码快捷绑定 - 生成二维码 */
  WECOM_QR_GENERATE: "im:wecom-qr-generate",
  /** 渲染 → 主：企微扫码快捷绑定 - 轮询授权结果 */
  WECOM_QR_POLL: "im:wecom-qr-poll",
  /** 渲染 → 主：飞书扫码创建应用 - 开始 */
  FEISHU_QR_START: "im:feishu-qr-start",
  /** 渲染 → 主：飞书扫码创建应用 - 取消 */
  FEISHU_QR_CANCEL: "im:feishu-qr-cancel",
  /** 主 → 渲染：飞书扫码二维码就绪 */
  FEISHU_QR_CODE: "im:feishu-qr-code",
  /** 主 → 渲染：飞书扫码授权状态变更 */
  FEISHU_QR_STATUS: "im:feishu-qr-status",
} as const;

export interface ImSaveConfigRequest {
  channels: ImChannelSecretsConfig;
}

export interface ImTestChannelRequest {
  channel: ImChannelId;
}

export interface ImChannelTestResult {
  channel: ImChannelId;
  success: boolean;
  error?: string;
  latencyMs?: number;
}

export interface ImStatusPush {
  channel: ImChannelId;
  state: "offline" | "connecting" | "online" | "error";
  error?: string;
  lastHeartbeat?: number;
}

export interface ImListSessionsResponse {
  sessions: RendererImSession[];
}

export interface WecomQrGenerateResponse {
  scode: string;
  authUrl: string;
  dataUrl?: string;
  expireIn?: number;
}

export interface WecomQrPollResponse {
  status: "success" | "pending";
  botId?: string;
  secret?: string;
}

export interface FeishuQrCodePush {
  url: string;
  dataUrl: string;
  expireIn?: number;
}

export interface FeishuQrStatusPush {
  status: string;
  interval?: number;
}

export interface FeishuQrRegisterResult {
  appId: string;
  appSecret: string;
  operatorOpenId?: string;
  tenantBrand?: string;
  /** 流程被取消时置 true（渲染端忽略） */
  canceled?: boolean;
}
