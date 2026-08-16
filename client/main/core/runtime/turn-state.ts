/**
 * Turn state — 活跃回合的运行时句柄与事件队列。
 *
 * 供 runtime 与 `steer-queue.ts` 共用，避免二者互相 import 形成循环依赖。
 * 这里只放**状态形状**，不放业务决策。
 */

import type { RuntimeEvent } from "@shared/agent-runtime";
import type { WorkflowUserMessageContent } from "@shared/workflow-read-thread-contract";
import type { ClaudeQuery } from "../sdk/claude-sdk";
import type { MessageChannel, SDKUserMessage } from "./message-channel";

export class RuntimeEventQueue {
  private events: RuntimeEvent[] = [];
  private waiters: Array<(event: RuntimeEvent) => void> = [];

  push(event: RuntimeEvent): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(event);
      return;
    }
    this.events.push(event);
  }

  next(): Promise<RuntimeEvent> {
    const event = this.events.shift();
    if (event) return Promise.resolve(event);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  *drainSync(): Iterable<RuntimeEvent> {
    while (this.events.length) {
      const event = this.events.shift();
      if (event) yield event;
    }
  }
}

export interface ActiveTurn {
  turnId: string;
  query: ClaudeQuery | null;
  channel: MessageChannel | null;
  eventQueue: RuntimeEventQueue | null;
  pendingSteers: PendingSteerMessage[];
  canceled: boolean;
  stopRequested: boolean;
  applyInterruptPhase: "idle" | "awaiting_boundary" | "awaiting_follow_up";
  acceptingSteers: boolean;
  finished: Promise<void>;
  finish: () => void;
  status: "running" | "closed";
}

export interface PendingSteerMessage {
  messageId: string;
  sdkMessage: SDKUserMessage;
  displayContent: string;
  userContent: WorkflowUserMessageContent[];
  timestamp: number;
}

export interface SteerDeliveryRecord {
  threadId: string;
  turnId: string;
  messageId: string;
  state: "queued" | "applying" | "dispatched" | "canceled";
  updatedAt: number;
}

export function createTurnLifetime(): Pick<ActiveTurn, "finished" | "finish"> {
  let resolveFinished!: () => void;
  let settled = false;
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve;
  });
  return {
    finished,
    finish() {
      if (settled) return;
      settled = true;
      resolveFinished();
    },
  };
}
