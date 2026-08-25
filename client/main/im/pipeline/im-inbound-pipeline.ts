/**
 * Im Inbound Pipeline — 入站消息三件套
 *
 * 对齐成熟 IM agent 入站管道：
 * 1. message_id 幂等去重（10min TTL）
 * 2. 800ms 缓冲合帧（同一 chatId 的连续消息合并）
 * 3. per-chat Promise 链串行派发（防连发吞消息/乱序）
 *
 * 依赖注入（ImBridge 装配），避免循环依赖。
 */

import { logInfo, logWarn } from "../../core/logging/app-logger";
import {
  isOwnerWhitelistEmpty,
  resolveImPermission,
  type ImPermissionContext,
} from "./im-permission-context";
import { ImCommandRouter, parseImCommand } from "./im-command-router";
import type {
  ImChannelId,
  ImChannelSecretsConfig,
  ImInboundMessage,
} from "@shared/im/im-types";

/** 合帧窗口（ms）——连续消息合并为一条派发 */
export const MERGE_WINDOW_MS = 800;
/** 首次认领成功提示 */
const OWNER_CLAIMED_NOTICE =
  "✅ 你已被自动设为管理员（Owner）。后续其他用户需由你在设置中添加白名单。";

/** 幂等去重 TTL（ms） */
export const DEDUPE_TTL_MS = 10 * 60 * 1000;

/** 未授权（untrusted）用户收到的提示（{userId} 替换为实际发送者 ID） */
const UNTRUSTED_NOTICE =
  "抱歉，你不是本机器人的授权用户。请使用白名单内的账号，或联系管理员配置。\n\n你的账号 ID：{userId}";

/** pipeline 的发送/派发出口（由 ImBridge 装配） */
export interface ImPipelineSinks {
  /** 发送一次性文本回执 */
  sendText(channel: ImChannelId, chatId: string, text: string): Promise<void>;
  /** 普通消息派发（bridge 内部解析会话并调用 sendChatTurn） */
  dispatch(ctx: ImPermissionContext, text: string): Promise<void>;
  /** 命令路由（bridge 装配动作） */
  commandRouter: ImCommandRouter;
  /** 白名单为空时首次认领 Owner（持久化 senderId 到 owner 白名单） */
  claimOwner(channel: ImChannelId, senderId: string): Promise<void>;
}

interface MergeBuffer {
  texts: string[];
  timer: NodeJS.Timeout;
  lastMessageId: string;
}

export class ImInboundPipeline {
  private readonly dedupe = new Map<string, number>();
  private readonly buffers = new Map<string, MergeBuffer>();
  private readonly chains = new Map<string, Promise<unknown>>();
  private readonly config: () => ImChannelSecretsConfig;

  constructor(
    private readonly sinks: ImPipelineSinks,
    getConfig: () => ImChannelSecretsConfig,
  ) {
    this.config = getConfig;
    // 周期清理过期去重键
    setInterval(() => this.pruneDedupe(), DEDUPE_TTL_MS);
  }

  /** 入站总入口（adapter 调用） */
  handleMessage(msg: ImInboundMessage): void {
    const key = `${msg.channel}:${msg.messageId}`;
    const now = Date.now();
    const seen = this.dedupe.get(key);
    if (seen !== undefined && now - seen < DEDUPE_TTL_MS) {
      logInfo("im.pipeline.duplicate", { key });
      return;
    }
    this.dedupe.set(key, now);

    // 缓冲合帧：同一 chatId 在窗口内的消息合并
    const chatKey = `${msg.channel}:${msg.chatId}`;
    const existing = this.buffers.get(chatKey);
    if (existing) {
      existing.texts.push(msg.text);
      existing.lastMessageId = msg.messageId;
      return;
    }
    const buffer: MergeBuffer = {
      texts: [msg.text],
      lastMessageId: msg.messageId,
      timer: setTimeout(() => this.flush(chatKey, msg), MERGE_WINDOW_MS),
    };
    this.buffers.set(chatKey, buffer);
  }

  private flush(chatKey: string, first: ImInboundMessage): void {
    const buffer = this.buffers.get(chatKey);
    if (!buffer) return;
    clearTimeout(buffer.timer);
    this.buffers.delete(chatKey);

    const mergedText = buffer.texts.join("\n");
    const msg: ImInboundMessage = { ...first, text: mergedText };
    logInfo("im.pipeline.merged", {
      channel: msg.channel,
      chatId: msg.chatId,
      segments: buffer.texts.length,
    });

    // per-chat 串行派发：前一条完成后才处理下一条
    const chainTail = this.chains.get(chatKey) ?? Promise.resolve();
    const next = chainTail
      .then(() => this.dispatch(msg))
      .catch((error) => {
        logWarn("im.pipeline.dispatchFailed", {
          channel: msg.channel,
          chatId: msg.chatId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    this.chains.set(chatKey, next);
    // 链尾清理：完成后移除，避免 Map 无限增长
    void next.finally(() => {
      if (this.chains.get(chatKey) === next) {
        this.chains.delete(chatKey);
      }
    });
  }

  private async dispatch(msg: ImInboundMessage): Promise<void> {
    const ctx = resolveImPermission(this.config(), msg.channel, msg);
    if (ctx.role === "untrusted") {
      // 白名单为空 → 首次认领 Owner（扫码绑定后直接可用，无需手动配 ID）
      if (isOwnerWhitelistEmpty(this.config(), msg.channel)) {
        await this.sinks.claimOwner(msg.channel, msg.senderId);
        logInfo("im.pipeline.ownerAutoClaimed", {
          channel: msg.channel,
          senderId: msg.senderId,
        });
        // 通知用户认领成功，然后作为 owner 继续派发
        await this.sinks.sendText(
          msg.channel,
          msg.chatId,
          OWNER_CLAIMED_NOTICE,
        );
        const ownerCtx: ImPermissionContext = { ...ctx, role: "owner" };
        await this.sinks.dispatch(ownerCtx, msg.text);
        return;
      }
      logInfo("im.pipeline.untrustedBlocked", {
        channel: msg.channel,
        chatId: msg.chatId,
        senderId: msg.senderId,
      });
      await this.sinks.sendText(
        msg.channel,
        msg.chatId,
        UNTRUSTED_NOTICE.replace("{userId}", msg.senderId),
      );
      return;
    }

    const cmd = parseImCommand(msg.text);
    if (cmd) {
      const receipt = await this.sinks.commandRouter.handle(ctx, cmd);
      if (receipt) {
        await this.sinks.sendText(msg.channel, msg.chatId, receipt);
      }
      return;
    }
    await this.sinks.dispatch(ctx, msg.text);
  }

  private pruneDedupe(): void {
    const now = Date.now();
    for (const [key, ts] of this.dedupe) {
      if (now - ts >= DEDUPE_TTL_MS) this.dedupe.delete(key);
    }
  }
}
