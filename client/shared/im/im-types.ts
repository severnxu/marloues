/**
 * IM Channels — 企微/飞书双向桥接共享类型
 *
 * 主进程与渲染进程共用。不依赖任何 Node.js / Electron API。
 * 设计对齐竞品（neobot-client / Proma / OpenClaw）：
 * - 独立 IM 会话：chatId ↔ threadId 映射，与桌面会话隔离
 * - 入站一律不可信：owner / guest / untrusted 三层权限模型
 * - 渠道插件化：企微 / 飞书各一个 adapter 实现统一 ImChannelAdapter 接口
 */

export type ImChannelId = "wecom" | "feishu";

export const IM_CHANNELS: readonly ImChannelId[] = ["wecom", "feishu"];

/** 会话来源标记（sessions 表新增列） */
export type ImSessionSource = "desktop" | "im";

/** 企微渠道配置（密钥字段加密落盘） */
export interface WecomImConfig {
  enabled: boolean;
  /** 智能机器人 botId（@wecom/aibot-node-sdk 长连接认证） */
  botId: string;
  /** 智能机器人 secret（加密） */
  secret: string;
  /** owner 白名单（userid 列表，逗号分隔或数组） */
  ownerUserIds?: string[];
  /** guest 白名单（userid 列表） */
  guestWhitelist?: string[];
  /** 群聊是否需要 @ 机器人 才响应 */
  requireMention?: boolean;
  /** 可选：内网出口代理（http://host:port） */
  httpProxy?: string;
}

/** 飞书渠道配置（密钥字段加密落盘） */
export interface FeishuImConfig {
  enabled: boolean;
  /** 应用 App ID */
  appId: string;
  /** 应用 App Secret（加密） */
  appSecret: string;
  /** owner 白名单（open_id 列表） */
  ownerOpenIds?: string[];
  /** guest 白名单（open_id 列表） */
  guestWhitelist?: string[];
  /** 群聊是否需要 @ 机器人 才响应 */
  requireMention?: boolean;
  /** 可选：内网出口代理（http://host:port） */
  httpProxy?: string;
}

export interface ImChannelSecretsConfig {
  wecom?: WecomImConfig;
  feishu?: FeishuImConfig;
}

/** 渠道连接状态（主进程 → 渲染进程推送） */
export interface ImChannelStatus {
  channel: ImChannelId;
  state: "offline" | "connecting" | "online" | "error";
  error?: string;
  lastHeartbeat?: number;
}

/** 入站消息（adapter 归一化后的统一结构） */
export interface ImInboundMessage {
  channel: ImChannelId;
  /** 会话 ID：企微 chatid / 单聊 userid；飞书 chat_id */
  chatId: string;
  /** 发送者 ID：企微 userid；飞书 open_id */
  senderId: string;
  senderName?: string;
  /** 平台消息 ID（幂等键） */
  messageId: string;
  text: string;
  /** 群聊中是否 @ 了机器人 */
  isMention: boolean;
  /** 消息产生时间戳（ms） */
  ts: number;
  /** 是否有图片/文件资源（本期仅记录，下载后续扩展） */
  hasMedia?: boolean;
}

/** 权限上下文（入站消息解析后附加） */
export interface ImPermissionContext {
  channel: ImChannelId;
  chatId: string;
  senderId: string;
  role: "owner" | "guest" | "untrusted";
  /** guest 可用工具白名单（正则模式，走现有规则引擎语义） */
  guestToolWhitelist?: string[];
  /** guest 安全提示词（注入 runtimeContent 前缀，防注入） */
  securityPrompt?: string;
}

/** IM 会话记录（im_sessions 表） */
export interface ImSessionRecord {
  channel: ImChannelId;
  chatId: string;
  threadId: string;
  /** 绑定者（首条消息的 owner 用户） */
  ownerUserId: string;
  workspacePath: string;
  lastTurnId?: string;
  createdAt: number;
  updatedAt: number;
  state: "active" | "suspended";
}

/** IM 命令（/new /list /stop /compact /clear） */
export type ImCommandName = "new" | "list" | "stop" | "compact" | "clear";

export interface ImCommand {
  name: ImCommandName;
  args?: string;
}

/** IM 审批卡片载荷（adapter 渲染用） */
export interface ImApprovalCardPayload {
  requestId: string;
  toolName: string;
  reason: string;
  chatId: string;
  threadId: string;
  expiresAt: number;
  /** IM 卡片只允许 once 授权，不提供 session 授权（安全收紧） */
  guestOnly: true;
}

export type ImApprovalOutcome =
  "approved" | "denied" | "timed_out" | "canceled";

/** 渲染进程可见的 IM 会话摘要 */
export interface RendererImSession {
  channel: ImChannelId;
  chatId: string;
  threadId: string;
  title: string;
  workspacePath: string;
  lastTurnId?: string;
  updatedAt: number;
}
