import { logInfo } from "../logging/app-logger";
/**
 * 长生命周期消息通道。
 *
 * 作为 SDK query() 的 prompt 入参（AsyncGenerator<SDKUserMessage>）。
 *
 * 解决的问题：SDK 的 streamInput() 在消费完单次 AsyncGenerator 后会关闭 stdin，
 * 导致后续 steer 注入失败。通过持久化 generator，在 turn 结束前保持通道开启，
 * 支持中途消息注入（steer、队列消息等）。
 *
 * 生命周期：单次 sendMessage 内创建，收到 terminal result 后由 wrapStream 调
 * close() 结束。下次 sendMessage 创建新 channel。
 */

/** SDK 用户消息的最小类型定义（与 @anthropic-ai/claude-agent-sdk 的 SDKUserMessage 结构一致） */
export type SDKUserMessage = {
  type: "user";
  message: {
    role: "user";
    content: string | Array<Record<string, unknown>>;
  };
  parent_tool_use_id: string | null;
  priority?: "now" | "next" | "later";
  shouldQuery?: boolean;
};

export interface MessageChannel {
  enqueue(msg: SDKUserMessage, id?: string): void;
  cancel(id: string): boolean;
  generator: AsyncGenerator<SDKUserMessage>;
  close(): void;
  isClosed(): boolean;
}

export function createMessageChannel(): MessageChannel {
  const queue: Array<{ id?: string; msg: SDKUserMessage; canceled?: boolean }> =
    [];
  let resolver: ((value: void) => void) | null = null;
  let done = false;

  async function* gen(): AsyncGenerator<SDKUserMessage> {
    while (!done) {
      if (queue.length > 0) {
        const item = queue.shift()!;
        if (item.canceled) continue;
        const msg = item.msg;
        logInfo("channel.yield", {
          phase: "genYield",
          queueLen: queue.length,
          hasContent: !!msg.message?.content,
        });
        yield msg;
      } else {
        await new Promise<void>((resolve) => {
          resolver = resolve;
        });
      }
    }
    while (queue.length > 0) {
      const item = queue.shift()!;
      if (!item.canceled) yield item.msg;
    }
  }

  const wake = (): void => {
    if (resolver) {
      const r = resolver;
      resolver = null;
      r();
    }
  };

  return {
    enqueue: (msg, id) => {
      queue.push({ id, msg });
      logInfo("channel.enqueue", { phase: "enqueue", queueLen: queue.length });
      wake();
    },
    cancel: (id) => {
      const item = queue.find((entry) => entry.id === id);
      if (!item) return false;
      item.canceled = true;
      wake();
      return true;
    },
    generator: gen(),
    close: () => {
      done = true;
      wake();
    },
    isClosed: () => done,
  };
}
