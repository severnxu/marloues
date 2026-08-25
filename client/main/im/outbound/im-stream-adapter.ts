/**
 * Im Stream Adapter — 事件流 → IM 流式回复适配层
 *
 * 消费 sendChatTurn 双投递的事件（UIEvent + item 事件），把文本增量、
 * 工具状态、回合终态翻译成渠道的流式三段协议（start/patch/finish）。
 *
 * 对齐 IM 渠道流式适配实践：
 * - 文本增量：由 item.updated 的 agent_message 全量文本 diff 出增量（节流由 adapter 内部合并）
 * - 工具状态：tool.start 时向 IM 追加一行轻量状态（可关闭）
 * - 回合结束：finish 落最终文本；error 带错误信息
 */

import { logInfo, logWarn } from "../../core/logging/app-logger";
import type { StreamHandle, ImChannelAdapter } from "./im-channel-adapter";
import type { ImChannelId } from "@shared/im/im-types";
import type { UIEvent } from "@shared/ui-protocol";
import type { WorkflowTurnItem } from "@shared/workflow-read-thread-contract";
import type { ImItemEventPayload } from "../bridge/im-event-bus";
import {
  type ImCapability,
  projectTurnItem,
} from "@shared/adapters/turn-item-to-im-projection";

export interface ImStreamTarget {
  channel: ImChannelId;
  chatId: string;
}

/** 各渠道能力集：approvalCard 不在此列——审批卡片由 ImApprovalDispatcher 独立投递，避免双发。 */
const CHANNEL_CAPABILITIES: Record<ImChannelId, readonly ImCapability[]> = {
  feishu: [
    "textStream",
    "cardMessage",
    "inlineStatus",
    "fileChangeCard",
    "commandExecutionCard",
  ],
  wecom: [
    "textStream",
    "cardMessage",
    "inlineStatus",
    "fileChangeCard",
    "commandExecutionCard",
  ],
};

interface ActiveStream {
  handle: StreamHandle;
  lastText: string;
  /** 距上次 patch 的时间，用于平台侧节流 */
  lastPatchAt: number;
  toolState: string[];
}

/** 节流窗口（ms）：增量合并后统一 patch */
const PATCH_THROTTLE_MS = 500;

export class ImStreamAdapter {
  private readonly active = new Map<string, ActiveStream>();
  private readonly pendingPatches = new Map<string, string>();
  private patchTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    /** 按渠道取 adapter（注入，避免循环依赖） */
    private readonly getAdapter: (
      channel: ImChannelId,
    ) =>
      | Pick<
          ImChannelAdapter,
          | "sendStreamStart"
          | "patchStream"
          | "finishStream"
          | "cancelStream"
          | "sendResultCard"
          | "sendFileChangeCard"
          | "sendCommandExecutionCard"
        >
      | undefined,
  ) {}

  private key(channel: ImChannelId, threadId: string): string {
    return `${channel}:${threadId}`;
  }

  /** 回合开始时建立流 */
  async onTurnStart(
    target: ImStreamTarget,
    threadId: string,
    turnId: string,
  ): Promise<void> {
    const adapter = this.getAdapter(target.channel);
    if (!adapter) return;
    const key = this.key(target.channel, threadId);
    const existing = this.active.get(key);
    if (existing) {
      // 已存在流（idle 会话复用 turn 边界）：重置文本基准，继续 patch
      existing.lastText = "";
      existing.lastPatchAt = Date.now();
      return;
    }
    try {
      const handle = await adapter.sendStreamStart(target.chatId, { turnId });
      this.active.set(key, {
        handle,
        lastText: "",
        lastPatchAt: Date.now(),
        toolState: [],
      });
      logInfo("im.stream.started", {
        channel: target.channel,
        chatId: target.chatId,
        turnId,
      });
    } catch (error) {
      logWarn("im.stream.startFailed", {
        channel: target.channel,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** UIEvent 双投递入口（emitChatEvent 调用） */
  onUIEvent(
    target: ImStreamTarget,
    threadId: string,
    turnId: string,
    evt: UIEvent,
  ): void {
    switch (evt.type) {
      case "turn.start":
        void this.onTurnStart(target, threadId, turnId);
        return;
      case "turn.complete":
        if (evt.final === false) return; // steer 中间边界，不结束流
        void this.finish(
          target,
          threadId,
          evt.result === "error" ? evt.error : undefined,
        );
        return;
      case "error":
        void this.finish(target, threadId, evt.message);
        return;
      default:
        return;
    }
  }

  /** item 事件双投递入口（emitItemEvent 调用）——turn 生命周期 + 投影分发 */
  onItemEvent(
    target: ImStreamTarget,
    threadId: string,
    evt: ImItemEventPayload,
  ): void {
    // turn.start 由 chat.ts 的 emitItemEvent 发出（item-event 总线），
    // 需在此创建流式回复，否则后续 patch 全部因无 active stream 被丢弃。
    if (evt.type === "turn.start") {
      void this.onTurnStart(target, threadId, evt.turnId);
      return;
    }

    const key = this.key(target.channel, threadId);
    const stream = this.active.get(key);
    if (!stream) return;

    if (evt.type === "turn.complete") {
      void this.finish(
        target,
        threadId,
        evt.result === "error" ? evt.error : undefined,
      );
      return;
    }

    const items =
      evt.type === "items.updated"
        ? (evt.items ?? [])
        : evt.item
          ? [evt.item]
          : [];
    for (const item of items) {
      this.projectToStream(
        target,
        threadId,
        key,
        stream,
        item,
        evt.type === "item.updated" ? evt.prevItem : undefined,
      );
    }
  }

  /**
   * 投影分发：WorkflowTurnItem → ImProjection[] → 渠道动作。
   * 文本增量保留 lastText 基准 diff（批量 items.updated 无 prevItem，
   * 投影层 delta 会退化为全量，IM 侧基准可正确去重，行为与 Phase 2 前一致）。
   */
  private projectToStream(
    target: ImStreamTarget,
    threadId: string,
    key: string,
    stream: ActiveStream,
    item: WorkflowTurnItem,
    prevItem: WorkflowTurnItem | undefined,
  ): void {
    const capabilities = new Set<ImCapability>(
      CHANNEL_CAPABILITIES[target.channel] ?? [],
    );
    const projections = projectTurnItem(item, prevItem, capabilities);

    for (const projection of projections) {
      switch (projection.kind) {
        case "textDelta":
          this.diffTextToStream(target, key, stream, item);
          break;
        case "statusLine":
          if (!stream.toolState.includes(projection.text)) {
            stream.toolState.push(projection.text);
            this.enqueuePatch(target, key, `\n\n${projection.text}`);
          }
          break;
        case "resultCard":
          void this.getAdapter(target.channel)?.sendResultCard(target.chatId, {
            title: projection.title,
            summary: projection.summary,
          });
          break;
        case "fileChangeCard":
          void this.getAdapter(target.channel)?.sendFileChangeCard(
            target.chatId,
            { changes: projection.changes },
          );
          break;
        case "commandExecutionCard":
          void this.getAdapter(target.channel)?.sendCommandExecutionCard(
            target.chatId,
            {
              command: projection.command,
              exitCode: projection.exitCode,
              output: projection.output,
            },
          );
          break;
        case "approvalCard":
          // 审批卡片由 ImApprovalDispatcher 独立投递（chat.ts approval.request
          // 分支），此处跳过避免双发；终态由 statusLine 分支收尾。
          break;
        case "errorCard":
          // 工具级失败不终止流（agent 可能继续 fallback / 最终答复），
          // 追加错误行；turn 级错误仍由 turn.complete(result:"error") finish。
          if (!stream.toolState.includes(projection.message)) {
            stream.toolState.push(projection.message);
            this.enqueuePatch(
              target,
              key,
              `\n\n❌ 执行出错：${projection.message}`,
            );
          }
          break;
        case "skip":
          break;
      }
    }
  }

  /** 文本增量：IM 侧维护 lastText 基准，前缀命中取差量，漂移则整段追加。 */
  private diffTextToStream(
    target: ImStreamTarget,
    key: string,
    stream: ActiveStream,
    item: WorkflowTurnItem,
  ): void {
    if (item.type !== "agentMessage" || typeof item.text !== "string") return;
    const nextText = item.text;
    if (nextText.startsWith(stream.lastText)) {
      const delta = nextText.slice(stream.lastText.length);
      if (delta) this.enqueuePatch(target, key, delta);
    } else {
      // 基准漂移（新消息段）：直接整段追加
      const delta = nextText.startsWith("\n") ? nextText.slice(1) : nextText;
      if (delta) this.enqueuePatch(target, key, `\n${delta}`);
    }
    stream.lastText = nextText;
  }

  private enqueuePatch(
    target: ImStreamTarget,
    key: string,
    delta: string,
  ): void {
    const existing = this.pendingPatches.get(key) ?? "";
    this.pendingPatches.set(key, existing + delta);
    if (this.patchTimers.has(key)) return;
    this.patchTimers.set(
      key,
      setTimeout(() => void this.flushPatch(target, key), PATCH_THROTTLE_MS),
    );
  }

  private async flushPatch(target: ImStreamTarget, key: string): Promise<void> {
    const timer = this.patchTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.patchTimers.delete(key);
    }
    const delta = this.pendingPatches.get(key);
    if (!delta) return;
    this.pendingPatches.delete(key);
    const stream = this.active.get(key);
    if (!stream) return;
    const adapter = this.getAdapter(target.channel);
    if (!adapter) return;
    try {
      await adapter.patchStream(stream.handle, delta);
      stream.lastPatchAt = Date.now();
    } catch (error) {
      logWarn("im.stream.patchFailed", {
        channel: target.channel,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async finish(
    target: ImStreamTarget,
    threadId: string,
    error?: string,
  ): Promise<void> {
    const key = this.key(target.channel, threadId);
    const stream = this.active.get(key);
    if (!stream) return;
    // 先 flush 剩余增量
    const remaining = this.pendingPatches.get(key);
    if (remaining) {
      this.pendingPatches.delete(key);
      try {
        await this.getAdapter(target.channel)?.patchStream(
          stream.handle,
          remaining,
        );
      } catch {
        // best-effort
      }
    }
    const adapter = this.getAdapter(target.channel);
    if (!adapter) return;
    this.active.delete(key);
    try {
      if (error) {
        const finalText = stream.lastText
          ? `${stream.lastText}\n\n❌ 执行出错：${error}`
          : `❌ 执行出错：${error}`;
        await adapter.finishStream(stream.handle, finalText);
      } else {
        await adapter.finishStream(stream.handle, stream.lastText);
      }
      logInfo("im.stream.finished", {
        channel: target.channel,
        chatId: target.chatId,
      });
    } catch (err) {
      logWarn("im.stream.finishFailed", {
        channel: target.channel,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** 会话删除/渠道停止时清理 */
  clearForThread(channel: ImChannelId, threadId: string): void {
    const key = this.key(channel, threadId);
    const stream = this.active.get(key);
    if (stream) {
      void this.getAdapter(channel)?.cancelStream(
        stream.handle,
        "session closed",
      );
    }
    this.active.delete(key);
    this.pendingPatches.delete(key);
    const timer = this.patchTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.patchTimers.delete(key);
    }
  }
}
