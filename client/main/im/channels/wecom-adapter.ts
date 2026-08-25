/**
 * Wecom Adapter — 企业微信智能机器人渠道
 *
 * 基于 @wecom/aibot-node-sdk（WS 长连接，免公网回调）。
 *
 * 关键约束（SDK 实测语义）：
 * - 入站消息帧带 headers.req_id，被动回复（含流式）必须透传该帧，5 分钟 TTL；
 *   过期后降级为主动发送（sendMessage markdown）
 * - 群聊只有 @ 机器人才会收到回调（平台侧行为），故 isMention 恒为 true
 * - 模板卡片 button_interaction 的点击事件经 WS 事件帧回传（event_key + task_id），
 *   更新卡片需透传事件帧且 5 秒内有效，超时降级为文本终态
 * - text_notice 卡片 API 强制要求 card_action（type ∈ {1,2}，type=1 时 url 必填），
 *   否则报 errcode 42045（Template_Card card_action Missing or Invalid）；纯通知无落地页，
 *   统一占位企微官网。button_interaction 的 card_action 可选，审批卡不填。
 */

import { WSClient } from "@wecom/aibot-node-sdk";
import { logInfo, logWarn } from "../../core/logging/app-logger";
import type {
  ImChannelAdapter,
  ImCardAction,
  StreamHandle,
} from "../outbound/im-channel-adapter";
import type {
  ImApprovalCardPayload,
  ImApprovalOutcome,
  ImChannelId,
  ImInboundMessage,
  WecomImConfig,
} from "@shared/im/im-types";
import type { WorkflowFileChange } from "@shared/workflow-read-thread-contract";

/** text_notice 卡片必填的 card_action 占位跳转地址（API 强制，本产品无 web 落地页） */
const WECOM_CARD_ACTION_URL = "https://work.weixin.qq.com";

/** 消息帧的 headers 子集（透传 req_id） */
interface WecomFrameHeaders {
  headers: { req_id: string };
}

interface WecomTextMessage {
  msgid: string;
  chatid?: string;
  chattype: "single" | "group";
  from?: { userid: string };
  text?: { content: string };
  msgtype?: string;
}

interface WecomTemplateCardEvent {
  msgid: string;
  chatid?: string;
  chattype?: "single" | "group";
  from?: { userid: string };
  event?: {
    eventtype: string;
    event_key?: string;
    task_id?: string;
  };
}

export class WecomAdapter implements ImChannelAdapter {
  readonly channel: ImChannelId = "wecom";

  private client: WSClient | null = null;
  private healthy = false;
  private readonly lastFrameByChat = new Map<string, WecomFrameHeaders>();
  private readonly lastCardFrameByRequest = new Map<
    string,
    { frame: WecomFrameHeaders; at: number; chatId: string }
  >();

  private messageCbs = new Set<(msg: ImInboundMessage) => void>();
  private cardActionCbs = new Set<(action: ImCardAction) => void>();

  constructor(private readonly config: WecomImConfig) {}

  async start(): Promise<void> {
    if (this.client) return;
    const client = new WSClient({
      botId: this.config.botId,
      secret: this.config.secret,
      reconnectInterval: 5000,
      maxReconnectAttempts: -1,
      heartbeatInterval: 30000,
      logger: {
        debug: () => undefined,
        info: () => undefined,
        warn: (message: string) => logWarn("im.wecom.sdkWarn", { message }),
        error: (message: string) => logWarn("im.wecom.sdkError", { message }),
      },
    });

    client.on("connected", () => {
      this.healthy = true;
      logInfo("im.wecom.connected", {});
    });
    client.on("authenticated", () => {
      logInfo("im.wecom.authenticated", {});
    });
    client.on("disconnected", (reason: string) => {
      this.healthy = false;
      logWarn("im.wecom.disconnected", { reason });
    });
    client.on("reconnecting", (attempt: number) => {
      logInfo("im.wecom.reconnecting", { attempt });
    });
    client.on("error", (error: Error) => {
      this.healthy = false;
      logWarn("im.wecom.error", {
        error: error instanceof Error ? error.message : String(error),
      });
    });

    // 入站消息
    client.on("message", (frame: unknown) => {
      void this.handleInbound(frame);
    });
    // 模板卡片点击事件
    client.on("event.template_card_event", (frame: unknown) => {
      void this.handleCardEvent(frame);
    });

    this.client = client;
    client.connect();
  }

  async stop(): Promise<void> {
    this.client?.disconnect();
    this.client = null;
    this.healthy = false;
    this.lastFrameByChat.clear();
    this.lastCardFrameByRequest.clear();
  }

  isHealthy(): boolean {
    return this.healthy;
  }

  // ---------- 入站 ----------

  private async handleInbound(frame: unknown): Promise<void> {
    const data = frame as { body?: WecomTextMessage };
    const body = data?.body;
    if (!body) return;
    if (body.msgtype !== "text" || !body.text?.content) return;
    if (!body.from?.userid) return;

    const chatId =
      body.chattype === "group" ? (body.chatid ?? "") : body.from.userid;
    if (!chatId) return;

    // 保存最近帧（流式回复透传 req_id 用）
    const reqId = (frame as { headers?: { req_id?: string } })?.headers?.req_id;
    if (reqId) {
      this.lastFrameByChat.set(chatId, frame as WecomFrameHeaders);
    }

    const msg: ImInboundMessage = {
      channel: "wecom",
      chatId,
      senderId: body.from.userid,
      messageId: body.msgid,
      text: body.text.content,
      // 企微平台侧：群聊仅 @ 机器人时推送，恒视为 mention
      isMention: true,
      ts: Date.now(),
    };
    logInfo("im.wecom.messageReceived", {
      chatId,
      senderId: body.from.userid,
      messageId: body.msgid,
    });
    for (const cb of this.messageCbs) {
      try {
        cb(msg);
      } catch {
        // 订阅者异常不影响其他订阅者
      }
    }
  }

  private async handleCardEvent(frame: unknown): Promise<void> {
    const data = frame as { body?: WecomTemplateCardEvent };
    const body = data?.body;
    if (!body?.event) return;
    const { event_key: eventKey, task_id: taskId } = body.event;
    if (!taskId || !eventKey) return;
    const chatId =
      body.chattype === "group"
        ? (body.chatid ?? "")
        : (body.from?.userid ?? "");
    this.lastCardFrameByRequest.set(taskId, {
      frame: frame as WecomFrameHeaders,
      at: Date.now(),
      chatId,
    });
    logInfo("im.wecom.approvalAction", {
      taskId,
      eventKey,
      chatId,
    });
    const action: ImCardAction = {
      requestId: taskId,
      approved: eventKey === "approve",
      chatId,
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
    const client = this.client;
    if (!client) return;
    try {
      await client.sendMessage(chatId, {
        msgtype: "markdown",
        markdown: { content: text },
      });
    } catch (error) {
      logWarn("im.wecom.sendTextFailed", {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async sendStreamStart(
    chatId: string,
    meta: { turnId: string; initialText?: string },
  ): Promise<StreamHandle> {
    const client = this.client;
    if (!client) throw new Error("wecom client not connected");
    const frame = this.lastFrameByChat.get(chatId);
    if (!frame) {
      // 无入站帧（例如审批后触发）：退化为主动文本
      await this.sendText(chatId, meta.initialText ?? "…");
      return {
        channel: "wecom",
        chatId,
        requestId: meta.turnId,
        lastPatchAt: Date.now(),
        buffer: "",
      };
    }
    const streamId = meta.turnId;
    try {
      await client.replyStream(frame, streamId, meta.initialText ?? "", false);
    } catch (error) {
      logWarn("im.wecom.streamStartFailed", {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
      // 降级：主动文本
      await this.sendText(chatId, meta.initialText ?? "…");
    }
    return {
      channel: "wecom",
      chatId,
      requestId: streamId,
      lastPatchAt: Date.now(),
      buffer: "",
    };
  }

  async patchStream(handle: StreamHandle, delta: string): Promise<void> {
    const client = this.client;
    const frame = this.lastFrameByChat.get(handle.chatId);
    if (!client || !frame) return;
    handle.buffer += delta;
    // 非阻塞：上一条同 reqId 未 ack 时跳过本帧，防积压（SDK 语义）
    const result = await client.replyStreamNonBlocking(
      frame,
      handle.requestId,
      handle.buffer,
      false,
    );
    if (result === "skipped") {
      logInfo("im.wecom.streamSkipped", { chatId: handle.chatId });
    }
    handle.lastPatchAt = Date.now();
  }

  async finishStream(handle: StreamHandle, finalText: string): Promise<void> {
    const client = this.client;
    const frame = this.lastFrameByChat.get(handle.chatId);
    if (!client || !frame) {
      // 帧过期/缺失：降级为主动文本整发
      await this.sendText(handle.chatId, finalText);
      return;
    }
    try {
      await client.replyStream(frame, handle.requestId, finalText, true);
    } catch (error) {
      logWarn("im.wecom.streamFinishFailed", {
        chatId: handle.chatId,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.sendText(handle.chatId, finalText);
    }
  }

  async cancelStream(handle: StreamHandle, reason?: string): Promise<void> {
    await this.finishStream(
      handle,
      handle.buffer
        ? `${handle.buffer}\n\n（已中断${reason ? `：${reason}` : ""}）`
        : `（已中断${reason ? `：${reason}` : ""}）`,
    );
  }

  async sendApprovalCard(
    chatId: string,
    payload: ImApprovalCardPayload,
  ): Promise<void> {
    const client = this.client;
    if (!client) return;
    try {
      await client.sendMessage(chatId, {
        msgtype: "template_card",
        template_card: {
          card_type: "button_interaction",
          main_title: {
            title: "🔐 权限审批请求",
            desc: `工具 ${payload.toolName}`,
          },
          sub_title_text: payload.reason.slice(0, 200),
          task_id: payload.requestId,
          button_list: [
            { text: "✅ 批准", key: "approve" },
            { text: "❌ 拒绝", key: "deny" },
          ],
        },
      });
      logInfo("im.wecom.cardSent", { chatId, requestId: payload.requestId });
    } catch (error) {
      logWarn("im.wecom.cardSendFailed", {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async sendResultCard(
    chatId: string,
    payload: { title: string; summary: string },
  ): Promise<void> {
    const client = this.client;
    if (!client) return;
    try {
      await client.sendMessage(chatId, {
        msgtype: "template_card",
        template_card: {
          card_type: "text_notice",
          main_title: { title: `🔧 ${payload.title}` },
          sub_title_text: payload.summary.slice(0, 500),
          card_action: { type: 1, url: WECOM_CARD_ACTION_URL },
        },
      });
      logInfo("im.wecom.resultCardSent", { chatId, title: payload.title });
    } catch (error) {
      logWarn("im.wecom.resultCardSendFailed", {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async sendFileChangeCard(
    chatId: string,
    payload: { changes: WorkflowFileChange[] },
  ): Promise<void> {
    const client = this.client;
    if (!client) return;
    const items = payload.changes.slice(0, 10).map((change) => ({
      keyname: change.kind,
      value: change.path,
    }));
    try {
      await client.sendMessage(chatId, {
        msgtype: "template_card",
        template_card: {
          card_type: "text_notice",
          main_title: {
            title: `📝 文件变更（${payload.changes.length} 个）`,
          },
          sub_title_text: "",
          horizontal_content_list: items.length
            ? items
            : [{ keyname: "变更", value: "无明细" }],
          card_action: { type: 1, url: WECOM_CARD_ACTION_URL },
        },
      });
      logInfo("im.wecom.fileChangeCardSent", { chatId });
    } catch (error) {
      logWarn("im.wecom.fileChangeCardSendFailed", {
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
    const client = this.client;
    if (!client) return;
    const exitLabel =
      payload.exitCode == null
        ? "执行完成"
        : payload.exitCode === 0
          ? "执行成功"
          : `执行失败（exit ${payload.exitCode}）`;
    const output = payload.output ? `\n${payload.output.slice(0, 300)}` : "";
    try {
      await client.sendMessage(chatId, {
        msgtype: "template_card",
        template_card: {
          card_type: "text_notice",
          main_title: { title: `⚡ ${exitLabel}` },
          sub_title_text: `${payload.command}${output}`.slice(0, 500),
          card_action: { type: 1, url: WECOM_CARD_ACTION_URL },
        },
      });
      logInfo("im.wecom.commandCardSent", { chatId });
    } catch (error) {
      logWarn("im.wecom.commandCardSendFailed", {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async updateApprovalCard(
    requestId: string,
    outcome: ImApprovalOutcome,
  ): Promise<void> {
    const client = this.client;
    const entry = this.lastCardFrameByRequest.get(requestId);
    const label =
      outcome === "approved"
        ? "✅ 已批准"
        : outcome === "denied"
          ? "❌ 已拒绝"
          : outcome === "timed_out"
            ? "⏰ 已超时"
            : "🚫 已取消";
    this.lastCardFrameByRequest.delete(requestId);
    if (!client) return;
    if (entry && Date.now() - entry.at < 5000) {
      try {
        await client.updateTemplateCard(entry.frame, {
          card_type: "text_notice",
          main_title: { title: "🔐 权限审批" },
          sub_title_text: label,
          card_action: { type: 1, url: WECOM_CARD_ACTION_URL },
        });
        return;
      } catch (error) {
        logWarn("im.wecom.cardUpdateFailed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    // 降级：主动文本终态
    if (entry) {
      await this.sendText(entry.chatId, label).catch(() => undefined);
    }
  }
}
