/**
 * Im Approval Dispatcher — 审批双通道（桌面弹窗 + IM 卡片）
 *
 * 裁决唯一入口仍是 runtime.respondApproval（Map delete 幂等，
 * 桌面/IM 竞态先到先胜）。本模块负责：
 * - dispatch：approval.request 时按 threadId 反查 IM 绑定，发审批卡片 + 过期兜底
 * - resolve：approval.decision 时把终态回流到卡片
 * - handleCardAction：IM 按钮点击 → respondApproval（once 作用域，安全收紧）
 */

import { logInfo } from "../../core/logging/app-logger";
import { getRuntime } from "../../core/runtime/manager";
import type { ImChannelAdapter, ImCardAction } from "./im-channel-adapter";
import type {
  ImApprovalCardPayload,
  ImApprovalOutcome,
  ImChannelId,
  ImSessionRecord,
} from "@shared/im/im-types";

interface PendingCard {
  threadId: string;
  chatId: string;
  channel: ImChannelId;
  timer: NodeJS.Timeout;
}

export class ImApprovalDispatcher {
  private readonly pendingCards = new Map<string, PendingCard>();
  private readonly states = new Map<string, ImApprovalOutcome | "pending">();

  constructor(
    private readonly getAdapter: (
      channel: ImChannelId,
    ) => ImChannelAdapter | undefined,
    private readonly getBinding: (
      threadId: string,
    ) => ImSessionRecord | undefined,
  ) {}

  /**
   * approval.request 处理处调用。
   * imContext 缺失时（重启后恢复的回合）按 threadId 反查绑定。
   */
  dispatch(
    threadId: string,
    req: {
      id: string;
      toolName: string;
      reason: string;
      timeout: number;
      expiresAt: number;
    },
    imContext?: { channel: ImChannelId; chatId: string },
  ): void {
    const binding =
      imContext ??
      (this.getBinding(threadId)
        ? {
            channel: this.getBinding(threadId)!.channel,
            chatId: this.getBinding(threadId)!.chatId,
          }
        : undefined);
    if (!binding) return; // 纯桌面会话，保持原行为
    const adapter = this.getAdapter(binding.channel);
    if (!adapter) return;

    this.states.set(req.id, "pending");
    const payload: ImApprovalCardPayload = {
      requestId: req.id,
      toolName: req.toolName,
      reason: req.reason,
      chatId: binding.chatId,
      threadId,
      expiresAt: req.expiresAt,
      guestOnly: true,
    };
    void adapter.sendApprovalCard(binding.chatId, payload);

    // 过期兜底：超过审批时限后卡片转超时态（最终裁决仍由 runtime 完成）
    const timer = setTimeout(() => {
      if (this.states.get(req.id) === "pending") {
        this.states.set(req.id, "timed_out");
        void adapter.updateApprovalCard(req.id, "timed_out");
        this.pendingCards.delete(req.id);
        logInfo("im.approval.cardTimedOut", { requestId: req.id });
      }
    }, req.timeout + 5_000);
    this.pendingCards.set(req.id, {
      threadId,
      chatId: binding.chatId,
      channel: binding.channel,
      timer,
    });
    logInfo("im.approval.cardDispatched", {
      requestId: req.id,
      channel: binding.channel,
    });
  }

  /** approval.decision 处理处调用：卡片终态回流 */
  resolve(requestId: string, outcome: ImApprovalOutcome): void {
    if (this.states.get(requestId) !== "pending") return;
    this.states.set(requestId, outcome);
    const pending = this.pendingCards.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingCards.delete(requestId);
    const adapter = this.getAdapter(pending.channel);
    if (adapter) {
      void adapter.updateApprovalCard(requestId, outcome);
    }
  }

  /** IM 按钮点击回传（adapter.onCardAction 接线） */
  async handleCardAction(action: ImCardAction): Promise<void> {
    const runtime = getRuntime();
    // 与 CHAT_PERMISSION_RESPONSE 同一裁决入口；IM 卡片仅 once 授权（安全收紧）
    runtime.respondApproval(action.requestId, action.approved, "once");
    if (action.approved) {
      this.resolve(action.requestId, "approved");
    } else {
      this.resolve(action.requestId, "denied");
    }
  }

  /** 清理（会话删除/运行时销毁） */
  dispose(): void {
    for (const [requestId, pending] of this.pendingCards) {
      clearTimeout(pending.timer);
      const adapter = this.getAdapter(pending.channel);
      if (adapter) {
        void adapter.updateApprovalCard(requestId, "canceled");
      }
    }
    this.pendingCards.clear();
    this.states.clear();
  }
}
