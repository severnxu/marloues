/**
 * Steer queue — 排队追加消息（steer）的投递状态机。
 *
 * 承载三条投递路径与它们的幂等窗口：
 *
 *   ① queue        用户排队一条 steer，落 outbox（durable）+ entry.pendingSteers（内存）
 *   ② boundary     当前回合到达自然边界时 FIFO 取一条注入（shouldQuery:true，不中断）
 *   ③ apply now    先 interrupt() 中断当前生成，再以 priority:"now" 注入（用户主动催）
 */

import type {
  ChatSendReceipt,
  OutboxSnapshot,
  SteerActionReceipt,
} from "@shared/types";
import type { Message } from "@shared/agent-runtime";
import type { WorkflowUserMessageContent } from "@shared/workflow-read-thread-contract";
import {
  enqueueOutboxMessage,
  getOutboxMessage,
  listOutboxSnapshots,
  reorderOutboxMessages,
  updateOutboxState,
} from "../../services/outbox-service";
import { getAgentSettings } from "../../services/config-service";
import { resolveModelProvider } from "../config/model-provider";
import { logInfo, logWarn } from "../logging/app-logger";
import { buildSdkUserContent } from "./sdk-content";
import { genId, now } from "./claude-runtime-utils";
import type {
  ActiveTurn,
  PendingSteerMessage,
  SteerDeliveryRecord,
} from "./turn-state";

const MAX_DELIVERY_RECORDS = 1_000;

export interface SteerQueueDeps {
  getActiveTurn: (threadId: string) => ActiveTurn | undefined;
  pushMessage: (threadId: string, message: Message) => void;
}

export class SteerQueue {
  private deliveries = new Map<string, SteerDeliveryRecord>();

  constructor(private readonly deps: SteerQueueDeps) {}

  private deliveryKey(threadId: string, messageId: string): string {
    return `${threadId}${messageId}`;
  }

  rememberDelivery(
    record: Omit<SteerDeliveryRecord, "updatedAt">,
    options: { persist?: boolean } = {},
  ): void {
    this.deliveries.set(this.deliveryKey(record.threadId, record.messageId), {
      ...record,
      updatedAt: Date.now(),
    });
    while (this.deliveries.size > MAX_DELIVERY_RECORDS) {
      const oldest = this.deliveries.keys().next().value as string | undefined;
      if (!oldest) break;
      this.deliveries.delete(oldest);
    }
    if (options.persist !== false) {
      try {
        updateOutboxState(record.threadId, record.messageId, record.state, {
          turnId: record.turnId,
        });
      } catch (error) {
        logWarn("claude.turn.outbox.persistStateFailed", {
          threadId: record.threadId,
          messageId: record.messageId,
          state: record.state,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  getDelivery(
    threadId: string,
    messageId: string,
  ): SteerDeliveryRecord | undefined {
    return this.deliveries.get(this.deliveryKey(threadId, messageId));
  }

  flush(
    threadId: string,
    entry: ActiveTurn,
    steer: PendingSteerMessage,
    opts: { applied?: boolean } = {},
  ): void {
    if (!entry.channel || entry.channel.isClosed()) {
      throw new Error("no active message channel to steer");
    }

    const sdkMessage = opts.applied
      ? { ...steer.sdkMessage, priority: "now" as const }
      : { ...steer.sdkMessage, shouldQuery: true };
    entry.channel.enqueue(sdkMessage, steer.messageId);
    this.rememberDelivery({
      threadId,
      turnId: entry.turnId,
      messageId: steer.messageId,
      state: "dispatched",
    });

    this.deps.pushMessage(threadId, {
      id: steer.messageId,
      role: "user",
      content: steer.displayContent,
      timestamp: steer.timestamp,
    });
    entry.eventQueue?.push({
      kind: "steer-message",
      payload: {
        turnId: entry.turnId,
        messageId: steer.messageId,
        text: steer.displayContent,
        content: steer.userContent,
        status: opts.applied ? "applied" : "sent",
        timestamp: steer.timestamp,
      },
    });
  }

  flushNextAtBoundary(threadId: string, entry: ActiveTurn): boolean {
    const steer = entry.pendingSteers.shift();
    if (!steer) return false;
    this.flush(threadId, entry, steer);
    return true;
  }

  async queue(opts: {
    threadId: string;
    content: string;
    displayContent?: string;
    userContent?: WorkflowUserMessageContent[];
    attachments?: unknown[];
    messageId?: string;
  }): Promise<ChatSendReceipt> {
    const messageId = opts.messageId ?? genId();
    const persisted = getOutboxMessage(opts.threadId, messageId);
    if (persisted) {
      this.rememberDelivery(
        {
          threadId: persisted.sessionId,
          turnId: persisted.turnId ?? "",
          messageId: persisted.messageId,
          state: persisted.state,
        },
        { persist: false },
      );
      if (persisted.state === "queued" || persisted.state === "applying") {
        return {
          status: "queued",
          sessionId: opts.threadId,
          messageId,
          turnId: persisted.turnId,
        };
      }
      return {
        status: "failed",
        sessionId: opts.threadId,
        messageId,
        turnId: persisted.turnId,
        reason: "rejected",
        error:
          persisted.state === "dispatched"
            ? "Message was already dispatched."
            : "Message was already canceled.",
      };
    }
    const entry = this.deps.getActiveTurn(opts.threadId);
    if (!entry?.channel || entry.channel.isClosed() || !entry.acceptingSteers) {
      if (entry) entry.acceptingSteers = false;
      return {
        status: "failed",
        sessionId: opts.threadId,
        messageId,
        turnId: entry?.turnId,
        reason: entry ? "turn_boundary" : "no_active_turn",
      };
    }
    if (entry.canceled) {
      entry.acceptingSteers = false;
      return {
        status: "failed",
        sessionId: opts.threadId,
        messageId,
        turnId: entry.turnId,
        reason: "turn_boundary",
      };
    }

    const displayContent = opts.displayContent ?? opts.content;
    const userContent =
      opts.userContent && opts.userContent.length > 0
        ? opts.userContent
        : [{ type: "text" as const, text: displayContent }];

    const steerSettings = getAgentSettings();
    const steerProvider = resolveModelProvider(steerSettings);
    const steerSupportsVision =
      steerProvider.provider?.models?.find((m) => m.id === steerProvider.model)
        ?.supportsVision ?? false;
    const steerSdkContent = buildSdkUserContent(
      opts.content,
      opts.attachments,
      steerSupportsVision,
    );

    const timestamp = now();
    const pendingSteer: PendingSteerMessage = {
      messageId,
      sdkMessage: {
        type: "user",
        message: { role: "user", content: steerSdkContent },
        parent_tool_use_id: null,
      },
      displayContent,
      userContent,
      timestamp,
    };

    try {
      enqueueOutboxMessage({
        sessionId: opts.threadId,
        messageId,
        turnId: entry.turnId,
        displayContent,
        userContent,
        sdkContent: opts.content,
        createdAt: timestamp,
      });
    } catch (error) {
      return {
        status: "failed",
        sessionId: opts.threadId,
        messageId,
        turnId: entry.turnId,
        reason: "rejected",
        error: error instanceof Error ? error.message : String(error),
      };
    }
    entry.pendingSteers.push(pendingSteer);

    this.rememberDelivery(
      {
        threadId: opts.threadId,
        turnId: entry.turnId,
        messageId,
        state: "queued",
      },
      { persist: false },
    );

    return {
      status: "queued",
      sessionId: opts.threadId,
      turnId: entry.turnId,
      messageId,
    };
  }

  async applyNow(
    threadId: string,
    messageId: string,
  ): Promise<SteerActionReceipt> {
    const known = this.getDelivery(threadId, messageId);
    const persisted = getOutboxMessage(threadId, messageId);
    const deliveryState = known?.state ?? persisted?.state;
    const deliveryTurnId = known?.turnId || persisted?.turnId;
    if (deliveryState === "applying") {
      return {
        action: "apply",
        status: "applying",
        sessionId: threadId,
        messageId,
        turnId: deliveryTurnId,
      };
    }
    if (deliveryState === "dispatched") {
      return {
        action: "apply",
        status: "already_dispatched",
        sessionId: threadId,
        messageId,
        turnId: deliveryTurnId,
      };
    }
    if (deliveryState === "canceled") {
      return {
        action: "apply",
        status: "canceled",
        sessionId: threadId,
        messageId,
        turnId: deliveryTurnId,
      };
    }
    const entry = this.deps.getActiveTurn(threadId);
    if (
      !entry?.channel ||
      entry.channel.isClosed() ||
      entry.canceled ||
      !entry.acceptingSteers
    ) {
      return {
        action: "apply",
        status: deliveryState === "queued" ? "boundary_closed" : "not_found",
        sessionId: threadId,
        messageId,
        turnId: deliveryTurnId ?? entry?.turnId,
      };
    }
    const index = entry.pendingSteers.findIndex(
      (steer) => steer.messageId === messageId,
    );
    if (index < 0) {
      return {
        action: "apply",
        status: deliveryState === "queued" ? "boundary_closed" : "not_found",
        sessionId: threadId,
        messageId,
        turnId: deliveryTurnId ?? entry.turnId,
      };
    }
    const [steer] = entry.pendingSteers.splice(index, 1);
    this.rememberDelivery({
      threadId,
      turnId: entry.turnId,
      messageId,
      state: "applying",
    });
    entry.applyInterruptPhase = "awaiting_boundary";
    logInfo("steer.debug.apply", {
      threadId,
      messageId,
      turnId: entry.turnId,
      hasQuery: Boolean(entry.query),
      hasInterrupt: Boolean(entry.query?.interrupt),
      channelClosed: entry.channel?.isClosed(),
    });
    let interrupt: SteerActionReceipt["interrupt"] = "unsupported";
    if (entry.query?.interrupt) {
      try {
        await entry.query.interrupt();
        interrupt = "succeeded";
      } catch (error) {
        interrupt = "failed";
        logWarn("claude.turn.steer.interruptFailed", {
          threadId,
          messageId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (
      !entry.channel ||
      entry.channel.isClosed() ||
      entry.canceled ||
      !entry.acceptingSteers
    ) {
      entry.pendingSteers.splice(index, 0, steer);
      this.rememberDelivery({
        threadId,
        turnId: entry.turnId,
        messageId,
        state: "queued",
      });
      entry.applyInterruptPhase = "idle";
      return {
        action: "apply",
        status: "boundary_closed",
        sessionId: threadId,
        messageId,
        turnId: entry.turnId,
        interrupt,
      };
    }
    this.flush(threadId, entry, steer, { applied: true });
    return {
      action: "apply",
      status: "applied",
      sessionId: threadId,
      messageId,
      turnId: entry.turnId,
      interrupt,
    };
  }

  async cancel(
    threadId: string,
    messageId: string,
  ): Promise<SteerActionReceipt> {
    const known = this.getDelivery(threadId, messageId);
    const persisted = getOutboxMessage(threadId, messageId);
    const deliveryState = known?.state ?? persisted?.state;
    const deliveryTurnId = known?.turnId || persisted?.turnId;
    if (deliveryState === "applying") {
      return {
        action: "cancel",
        status: "applying",
        sessionId: threadId,
        messageId,
        turnId: deliveryTurnId,
      };
    }
    if (deliveryState === "canceled") {
      return {
        action: "cancel",
        status: "canceled",
        sessionId: threadId,
        messageId,
        turnId: deliveryTurnId,
      };
    }
    const entry = this.deps.getActiveTurn(threadId);
    const pendingIndex =
      entry?.pendingSteers.findIndex(
        (steer) => steer.messageId === messageId,
      ) ?? -1;
    if (pendingIndex >= 0 && entry) {
      entry.pendingSteers.splice(pendingIndex, 1);
      this.rememberDelivery({
        threadId,
        turnId: entry.turnId,
        messageId,
        state: "canceled",
      });
      return {
        action: "cancel",
        status: "canceled",
        sessionId: threadId,
        messageId,
        turnId: entry.turnId,
      };
    }
    if (deliveryState === "queued") {
      this.rememberDelivery({
        threadId,
        turnId: deliveryTurnId ?? entry?.turnId ?? "",
        messageId,
        state: "canceled",
      });
      return {
        action: "cancel",
        status: "canceled",
        sessionId: threadId,
        messageId,
        turnId: deliveryTurnId ?? entry?.turnId,
      };
    }
    if (!entry?.channel || entry.channel.isClosed()) {
      return {
        action: "cancel",
        status:
          deliveryState === "dispatched" ? "already_dispatched" : "not_found",
        sessionId: threadId,
        messageId,
        turnId: deliveryTurnId ?? entry?.turnId,
      };
    }
    const canceled = entry.channel.cancel(messageId);
    if (canceled) {
      this.rememberDelivery({
        threadId,
        turnId: entry.turnId,
        messageId,
        state: "canceled",
      });
    }
    return {
      action: "cancel",
      status: canceled
        ? "canceled"
        : deliveryState === "dispatched"
          ? "already_dispatched"
          : "not_found",
      sessionId: threadId,
      messageId,
      turnId: deliveryTurnId ?? entry.turnId,
    };
  }

  async reorder(
    threadId: string,
    orderedMessageIds: string[],
  ): Promise<SteerActionReceipt> {
    const entry = this.deps.getActiveTurn(threadId);
    if (!entry?.channel || entry.channel.isClosed() || entry.canceled) {
      const persistedOrder = reorderOutboxMessages(threadId, orderedMessageIds);
      return {
        action: "reorder",
        status: persistedOrder.length > 0 ? "reordered" : "boundary_closed",
        sessionId: threadId,
        order: persistedOrder.length > 0 ? persistedOrder : orderedMessageIds,
        turnId: entry?.turnId,
      };
    }
    const byId = new Map(
      entry.pendingSteers.map((steer) => [steer.messageId, steer]),
    );
    const reordered: PendingSteerMessage[] = [];
    for (const id of orderedMessageIds) {
      const steer = byId.get(id);
      if (steer) {
        reordered.push(steer);
        byId.delete(id);
      }
    }
    for (const steer of byId.values()) reordered.push(steer);
    entry.pendingSteers = reordered;
    const persistedOrder = reorderOutboxMessages(
      threadId,
      reordered.map((steer) => steer.messageId),
    );
    return {
      action: "reorder",
      status: "reordered",
      sessionId: threadId,
      order: persistedOrder,
      turnId: entry.turnId,
    };
  }

  listSnapshots(
    sessionId: string | undefined,
    isDeliverable: (entry: ActiveTurn | undefined) => boolean,
  ): OutboxSnapshot[] {
    return listOutboxSnapshots(sessionId).map((snapshot) => ({
      ...snapshot,
      paused: !isDeliverable(this.deps.getActiveTurn(snapshot.sessionId)),
    }));
  }
}
