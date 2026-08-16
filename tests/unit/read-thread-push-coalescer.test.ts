import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReadThreadPushCoalescer } from "../../client/main/core/runtime/read-thread-push-coalescer";

type Deferred = { resolve: () => void; promise: Promise<void> };

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { resolve, promise };
}

describe("read-thread-push-coalescer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces a burst of notifies into a single push", async () => {
    const sent: string[] = [];
    const send = vi.fn(async (threadId: string) => {
      sent.push(threadId);
    });
    const coalescer = createReadThreadPushCoalescer({
      intervalMs: 100,
      send,
    });

    for (let i = 0; i < 10; i += 1) coalescer.notify("thread-a");
    expect(send).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);
    expect(send).toHaveBeenCalledTimes(1);
    expect(sent).toEqual(["thread-a"]);

    // Pending drained: no further pushes without new notifies.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not lose a notify that arrives while a push is running (turn tail)", async () => {
    const gates = new Map<string, Deferred[]>();
    const sendCalls: string[] = [];
    const send = vi.fn((threadId: string) => {
      sendCalls.push(threadId);
      const queue = gates.get(threadId) ?? [];
      const gate = deferred();
      queue.push(gate);
      gates.set(threadId, queue);
      return gate.promise;
    });
    const coalescer = createReadThreadPushCoalescer({ intervalMs: 100, send });

    // First push starts and is held in-flight.
    coalescer.notify("thread-a");
    await vi.advanceTimersByTimeAsync(100);
    expect(send).toHaveBeenCalledTimes(1);

    // Emit arrives while the push is still in-flight — must not be dropped.
    coalescer.notify("thread-a");

    // Release the in-flight push; the pending notify must drain into a new push.
    gates.get("thread-a")![0].resolve();
    await vi.advanceTimersByTimeAsync(100);
    expect(send).toHaveBeenCalledTimes(2);
    gates.get("thread-a")![1].resolve();
    await vi.advanceTimersByTimeAsync(0);

    // Nothing left pending: no extra pushes.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("pushes distinct threads in one drain pass, preserving both updates", async () => {
    const sent: string[] = [];
    const send = vi.fn(async (threadId: string) => {
      sent.push(threadId);
    });
    const coalescer = createReadThreadPushCoalescer({ intervalMs: 100, send });

    coalescer.notify("thread-a");
    coalescer.notify("thread-b");
    await vi.advanceTimersByTimeAsync(100);
    expect(send).toHaveBeenCalledTimes(2);
    expect(sent).toEqual(["thread-a", "thread-b"]);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("keeps the pump alive when a send rejects", async () => {
    let calls = 0;
    const send = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error("boom");
    });
    const coalescer = createReadThreadPushCoalescer({ intervalMs: 100, send });

    coalescer.notify("thread-a");
    await vi.advanceTimersByTimeAsync(100);
    expect(send).toHaveBeenCalledTimes(1);

    coalescer.notify("thread-a");
    await vi.advanceTimersByTimeAsync(100);
    expect(send).toHaveBeenCalledTimes(2); // pump survived the rejection
  });
});
