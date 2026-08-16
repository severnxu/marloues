/**
 * readThread 推送合并器（drain-safe coalescer）。
 *
 * 背景：流式期间每个 text-chunk 都会触发一次 thread 更新通知（每秒可达数十
 * 次），而每次推送要做「全量序列化 + IPC 结构化克隆」，不能逐条转发。这里把
 * 通知合并为固定节拍的批量推送。
 *
 * 正确性不变量（旧实现的缺陷正在于此）：
 *   任何一次 notify 都必须最终触发一次推送——「推送进行中」到达的通知不允许
 *   被静默丢弃，否则 turn 结束前的最后一批 text-chunk / turn-complete 通知会
 *   永远丢失，渲染端停在过期快照上，直到 turn.complete 触发 loadReadThread
 *   全量重载才"突然"出现完整文本。
 *
 * 语义：
 *   - notify(id)：记录 pending id；若泵已在运行/已排队则直接返回（不丢，泵会 drain）。
 *   - 泵循环：sleep(intervalMs) → 取走全部 pending 批量逐个推送 → 若期间又有
 *     新 notify（pending 非空）则继续下一轮，直到 pending 清空。
 *   - 推送严格串行（单泵循环），同一时刻最多一个 send 在途。
 *   - 任意两次推送之间至少间隔 intervalMs（首推延迟 intervalMs，与旧实现一致）。
 */

export interface ReadThreadPushCoalescer {
  /** 线程有更新；多次调用会在下一个推送节拍合并。 */
  notify(threadId: string): void;
}

export interface ReadThreadPushCoalescerOptions {
  /** 推送节拍（毫秒）：合并窗口 + 相邻两次推送的最小间隔。 */
  intervalMs: number;
  /** 实际推送函数；由调用方注入（序列化 + IPC send）。 */
  send: (threadId: string) => Promise<void>;
}

export function createReadThreadPushCoalescer(
  options: ReadThreadPushCoalescerOptions,
): ReadThreadPushCoalescer {
  const { intervalMs, send } = options;

  const pending = new Set<string>();
  let pumpQueued = false;
  let pumpRunning = false;

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });

  async function pump(): Promise<void> {
    pumpRunning = true;
    try {
      while (pending.size > 0) {
        await sleep(intervalMs);
        const batch = [...pending];
        pending.clear();
        for (const threadId of batch) {
          // send 自身负责错误兜底；这里再兜一层，保证泵不会因单次失败停摆。
          try {
            await send(threadId);
          } catch {
            // ignored — sender owns its error reporting
          }
        }
      }
    } finally {
      pumpRunning = false;
      // 兜底：finally 与循环退出之间没有可插入点（单线程），此处 pending
      // 必为空；若未来实现变化导致竞态，补一次排队以免通知悬空。
      if (pending.size > 0 && !pumpQueued) {
        pumpQueued = true;
        setTimeout(() => {
          pumpQueued = false;
          if (!pumpRunning) void pump();
        }, 0);
      }
    }
  }

  return {
    notify(threadId: string): void {
      pending.add(threadId);
      if (pumpQueued || pumpRunning) return;
      pumpQueued = true;
      setTimeout(() => {
        pumpQueued = false;
        if (pumpRunning) return;
        void pump();
      }, 0);
    },
  };
}
