/**
 * Im Event Bus — sendChatTurn 事件 → IM 桥的零依赖转发总线
 *
 * 用途：chat.ts 在事件广播处 fan-out 到本总线（不 import im 桥模块），
 * im-bridge 订阅并转发给流式适配器 —— 避免 chat.ts ↔ im-bridge 循环导入。
 */

import type { ImStreamTarget } from "../outbound/im-stream-adapter";
import type { WorkflowTurnItem } from "@shared/workflow-read-thread-contract";

/**
 * item 事件结构化载荷（Phase 3：替代旧的 6 字段鸭子类型载荷）。
 *
 * - turn.start / turn.complete：IM 流生命周期（流创建 / finish），
 *   与桌面端 CHAT_ITEM_EVENT 同一数据源，按 type 分派。
 * - item.updated：单条 item 快照 + 可选 prevItem（ingest mutation 前克隆，
 *   首帧 / 新建为 undefined，投影层按首帧处理）。
 * - items.updated：16ms 合并批量快照（无 prevItem，文本增量由 IM 侧
 *   lastText 基准 diff，避免全量重复 patch）。
 */
export type ImItemEventPayload =
  | {
      type: "turn.start";
      turnId: string;
      startedAt?: number;
      modelId?: string;
      modelName?: string;
    }
  | {
      type: "turn.complete";
      turnId: string;
      result?: string;
      final?: boolean;
      error?: string;
      completedAt?: number;
    }
  | {
      type: "item.updated";
      turnId: string;
      item?: WorkflowTurnItem;
      prevItem?: WorkflowTurnItem;
    }
  | {
      type: "items.updated";
      turnId: string;
      items?: WorkflowTurnItem[];
    };

/** 广播载荷（事件类型由订阅侧按需断言） */
export interface ImBridgeEvent {
  type: "ui-event" | "item-event";
  target: ImStreamTarget;
  threadId: string;
  turnId: string;
  evt: unknown;
}

type Listener = (event: ImBridgeEvent) => void;

class ImEventBus {
  private readonly listeners = new Set<Listener>();

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: ImBridgeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // 单个订阅者异常不影响主链路
      }
    }
  }
}

export const imEventBus = new ImEventBus();

/** chat.ts 双投递 helper：UIEvent 分发 */
export function emitImUIEvent(
  target: ImStreamTarget | undefined,
  threadId: string,
  turnId: string,
  evt: unknown,
): void {
  if (!target) return;
  imEventBus.emit({ type: "ui-event", target, threadId, turnId, evt });
}

/** chat.ts 双投递 helper：item 事件分发（载荷已结构化，见 ImItemEventPayload） */
export function emitImItemEvent(
  target: ImStreamTarget | undefined,
  threadId: string,
  turnId: string,
  evt: ImItemEventPayload,
): void {
  if (!target) return;
  imEventBus.emit({ type: "item-event", target, threadId, turnId, evt });
}
