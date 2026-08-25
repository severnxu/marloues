/**
 * Feishu Adapter — 飞书机器人渠道
 *
 * 基于 @larksuiteoapi/node-sdk 的 LarkChannel（WS 长连接，免公网回调；
 * 卡片动作也经长连接回传，无需公网 HTTP endpoint）。
 *
 * 流式实现：channel.stream + markdown producer（SDK 内置分块与节流，
 * 自动维护消息更新，等价竞品 CardKit 流式卡片体验）。
 * 审批卡片：interactive 卡片 + approve/deny 按钮，点击经 cardAction 事件回传。
 */

import * as lark from "@larksuiteoapi/node-sdk";
import { logInfo, logWarn } from "../../core/logging/app-logger";
import type {
  ImChannelAdapter,
  ImCardAction,
  StreamHandle,
} from "../outbound/im-channel-adapter";
import type {
  FeishuImConfig,
  ImApprovalCardPayload,
  ImApprovalOutcome,
  ImChannelId,
  ImInboundMessage,
} from "@shared/im/im-types";
import type { WorkflowFileChange } from "@shared/workflow-read-thread-contract";

export class FeishuAdapter implements ImChannelAdapter {
  readonly channel: ImChannelId = "feishu";

  private larkChannel: lark.LarkChannel | null = null;
  private healthy = false;
  /** 进行中的流：chatId → { controller, finish 信号 } */
  private readonly streams = new Map<
    string,
    {
      controller: lark.MarkdownStreamController | null;
      resolveFinish: (() => void) | null;
      finishPromise: Promise<void>;
    }
  >();
  /** 审批卡片 messageId（终态更新用） */
  private readonly cardMessageIds = new Map<string, string>();

  private messageCbs = new Set<(msg: ImInboundMessage) => void>();
  private cardActionCbs = new Set<(action: ImCardAction) => void>();

  constructor(private readonly config: FeishuImConfig) {}

  async start(): Promise<void> {
    if (this.larkChannel) return;
    const channel = new lark.LarkChannel({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
      loggerLevel: lark.LoggerLevel.info,
    });

    channel.on({
      message: (msg) => this.handleInbound(msg),
      cardAction: (evt) => this.handleCardAction(evt),
      error: (err) => {
        this.healthy = false;
        logWarn("im.feishu.error", {
          error: err?.message ?? String(err),
        });
      },
      reconnecting: () => {
        logInfo("im.feishu.reconnecting", {});
      },
      reconnected: () => {
        this.healthy = true;
        logInfo("im.feishu.reconnected", {});
      },
    });

    this.larkChannel = channel;
    try {
      await channel.connect();
      this.healthy = true;
      logInfo("im.feishu.connected", {});
    } catch (error) {
      this.healthy = false;
      throw error;
    }
  }

  async stop(): Promise<void> {
    await this.larkChannel?.disconnect().catch(() => undefined);
    this.larkChannel = null;
    this.healthy = false;
    this.streams.clear();
    this.cardMessageIds.clear();
  }

  isHealthy(): boolean {
    return this.healthy;
  }

  // ---------- 入站 ----------

  private handleInbound(msg: lark.NormalizedMessage): void {
    if (!this.larkChannel) return;
    // 仅处理文本消息（图片/文件后续扩展）
    if (msg.rawContentType !== "text") return;
    if (!msg.content) return;
    if (!msg.senderId) return;

    const inbound: ImInboundMessage = {
      channel: "feishu",
      chatId: msg.chatId,
      senderId: msg.senderId,
      senderName: msg.senderName,
      messageId: msg.messageId,
      text: msg.content,
      // 单聊（p2p）恒视为已激活；群聊需 @ 机器人（SDK 已归一化 mentionedBot）
      isMention: msg.chatType === "p2p" ? true : msg.mentionedBot,
      ts: msg.createTime > 0 ? msg.createTime : Date.now(),
      hasMedia: msg.resources.length > 0,
    };
    logInfo("im.feishu.messageReceived", {
      chatId: msg.chatId,
      senderId: msg.senderId,
      messageId: msg.messageId,
    });
    for (const cb of this.messageCbs) {
      try {
        cb(inbound);
      } catch {
        // ignore
      }
    }
  }

  private handleCardAction(evt: lark.CardActionEvent): void {
    const value = evt.action?.value as
      { action?: string; requestId?: string } | undefined;
    const requestId = value?.requestId;
    if (!requestId) return;
    const approved = value.action === "approve";
    this.cardMessageIds.set(requestId, evt.messageId);
    logInfo("im.feishu.approvalAction", {
      requestId,
      approved,
      chatId: evt.chatId,
    });
    const action: ImCardAction = {
      requestId,
      approved,
      chatId: evt.chatId,
    };
    for (const cb of this.cardActionCbs) {
      try {
        cb(action);
      } catch {
        // ignore
      }
    }
  }

  onMessage(cb: (msg: ImInboundMessage) => void): () => void {
    this.messageCbs.add(cb);
    return () => this.messageCbs.delete(cb);
  }

  onCardAction(cb: (action: ImCardAction) => void): () => void {
    this.cardActionCbs.add(cb);
    return () => this.cardActionCbs.delete(cb);
  }

  // ---------- 出站 ----------

  async sendText(chatId: string, text: string): Promise<void> {
    if (!this.larkChannel) return;
    try {
      await this.larkChannel.send(chatId, { markdown: text });
    } catch (error) {
      logWarn("im.feishu.sendTextFailed", {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async sendStreamStart(
    chatId: string,
    meta: { turnId: string; initialText?: string },
  ): Promise<StreamHandle> {
    if (!this.larkChannel) throw new Error("feishu channel not connected");
    let finishResolve!: () => void;
    const finishPromise = new Promise<void>((resolve) => {
      finishResolve = resolve;
    });
    const entry = {
      controller: null as lark.MarkdownStreamController | null,
      resolveFinish: finishResolve,
      finishPromise,
    };
    this.streams.set(chatId, entry);

    void this.larkChannel
      .stream(chatId, {
        markdown: async (controller) => {
          entry.controller = controller;
          if (meta.initialText) {
            await controller.append(meta.initialText);
          }
          // 等待 finish 信号（finishStream 时 resolve）
          await finishPromise;
        },
      })
      .catch((error) => {
        logWarn("im.feishu.streamFailed", {
          chatId,
          error: error instanceof Error ? error.message : String(error),
        });
        this.streams.delete(chatId);
      });

    return {
      channel: "feishu",
      chatId,
      requestId: meta.turnId,
      lastPatchAt: Date.now(),
      buffer: "",
    };
  }

  async patchStream(handle: StreamHandle, delta: string): Promise<void> {
    const entry = this.streams.get(handle.chatId);
    if (!entry?.controller) return;
    handle.buffer += delta;
    try {
      await entry.controller.append(delta);
      handle.lastPatchAt = Date.now();
    } catch (error) {
      logWarn("im.feishu.patchFailed", {
        chatId: handle.chatId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async finishStream(handle: StreamHandle, finalText: string): Promise<void> {
    const entry = this.streams.get(handle.chatId);
    if (!entry) return;
    if (entry.controller && finalText && finalText !== handle.buffer) {
      // 校正最终文本（含错误信息等补充内容）
      try {
        await entry.controller.append(finalText.slice(handle.buffer.length));
      } catch {
        // best-effort
      }
    }
    entry.resolveFinish?.();
    this.streams.delete(handle.chatId);
  }

  async cancelStream(handle: StreamHandle, reason?: string): Promise<void> {
    const entry = this.streams.get(handle.chatId);
    if (entry?.controller) {
      try {
        await entry.controller.append(
          `\n\n（已中断${reason ? `：${reason}` : ""}）`,
        );
      } catch {
        // best-effort
      }
    }
    entry?.resolveFinish?.();
    this.streams.delete(handle.chatId);
  }

  async sendApprovalCard(
    chatId: string,
    payload: ImApprovalCardPayload,
  ): Promise<void> {
    if (!this.larkChannel) return;
    try {
      await this.larkChannel.send(chatId, {
        card: {
          header: {
            title: {
              tag: "plain_text",
              content: "🔐 权限审批请求",
            },
          },
          elements: [
            {
              tag: "markdown",
              content: `**工具**：\`${payload.toolName}\`\n**原因**：${payload.reason.slice(0, 500)}\n\n⏰ 超时自动拒绝`,
            },
            {
              tag: "action",
              actions: [
                {
                  tag: "button",
                  text: { tag: "plain_text", content: "✅ 批准" },
                  type: "primary",
                  value: { action: "approve", requestId: payload.requestId },
                },
                {
                  tag: "button",
                  text: { tag: "plain_text", content: "❌ 拒绝" },
                  type: "danger",
                  value: { action: "deny", requestId: payload.requestId },
                },
              ],
            },
          ],
        },
      });
      logInfo("im.feishu.cardSent", { chatId, requestId: payload.requestId });
    } catch (error) {
      logWarn("im.feishu.cardSendFailed", {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async sendResultCard(
    chatId: string,
    payload: { title: string; summary: string },
  ): Promise<void> {
    if (!this.larkChannel) return;
    try {
      await this.larkChannel.send(chatId, {
        card: {
          header: {
            title: {
              tag: "plain_text",
              content: `🔧 ${payload.title}`,
            },
          },
          elements: [
            {
              tag: "markdown",
              content: payload.summary.slice(0, 4000),
            },
          ],
        },
      });
      logInfo("im.feishu.resultCardSent", { chatId, title: payload.title });
    } catch (error) {
      logWarn("im.feishu.resultCardSendFailed", {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async sendFileChangeCard(
    chatId: string,
    payload: { changes: WorkflowFileChange[] },
  ): Promise<void> {
    if (!this.larkChannel) return;
    const lines = payload.changes
      .slice(0, 20)
      .map(
        (change) =>
          `- \`${change.path}\`（${change.kind}${change.diff?.text ? "，含 diff" : ""}）`,
      );
    try {
      await this.larkChannel.send(chatId, {
        card: {
          header: {
            title: {
              tag: "plain_text",
              content: `📝 文件变更（${payload.changes.length} 个）`,
            },
          },
          elements: [
            {
              tag: "markdown",
              content: lines.join("\n") || "（无变更明细）",
            },
          ],
        },
      });
      logInfo("im.feishu.fileChangeCardSent", { chatId });
    } catch (error) {
      logWarn("im.feishu.fileChangeCardSendFailed", {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async sendCommandExecutionCard(
    chatId: string,
    payload: {
      command: string;
      exitCode?: number | null;
      output?: string;
    },
  ): Promise<void> {
    if (!this.larkChannel) return;
    const exitLabel =
      payload.exitCode == null
        ? "执行完成"
        : payload.exitCode === 0
          ? "执行成功"
          : `执行失败（exit ${payload.exitCode}）`;
    const output = payload.output
      ? `\n\`\`\`\n${payload.output.slice(0, 2000)}\n\`\`\``
      : "";
    try {
      await this.larkChannel.send(chatId, {
        card: {
          header: {
            title: {
              tag: "plain_text",
              content: `⚡ ${exitLabel}`,
            },
          },
          elements: [
            {
              tag: "markdown",
              content: `\`${payload.command}\`${output}`,
            },
          ],
        },
      });
      logInfo("im.feishu.commandCardSent", { chatId });
    } catch (error) {
      logWarn("im.feishu.commandCardSendFailed", {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async updateApprovalCard(
    requestId: string,
    outcome: ImApprovalOutcome,
  ): Promise<void> {
    if (!this.larkChannel) return;
    const messageId = this.cardMessageIds.get(requestId);
    this.cardMessageIds.delete(requestId);
    const label =
      outcome === "approved"
        ? "✅ 已批准"
        : outcome === "denied"
          ? "❌ 已拒绝"
          : outcome === "timed_out"
            ? "⏰ 已超时"
            : "🚫 已取消";
    if (!messageId) {
      // 无卡片句柄（例如重启后）：无法更新，静默
      return;
    }
    try {
      await this.larkChannel.updateCard(messageId, {
        header: { title: { tag: "plain_text", content: "🔐 权限审批" } },
        elements: [
          {
            tag: "markdown",
            content: label,
          },
        ],
      });
    } catch (error) {
      logWarn("im.feishu.cardUpdateFailed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
