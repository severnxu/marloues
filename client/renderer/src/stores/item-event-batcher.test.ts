import { describe, expect, it, vi } from "vitest";
import { createItemEventBatcher } from "./item-event-batcher";
import type { ItemEvent } from "./unified-chat-store";

const update = (text: string): ItemEvent => ({
  type: "item.updated",
  sessionId: "session-1",
  turnId: "turn-1",
  item: { id: "answer", type: "agentMessage", text, settled: false },
});

describe("createItemEventBatcher", () => {
  it("coalesces replaceable updates until the animation frame", () => {
    const handleEvent = vi.fn();
    let frame: FrameRequestCallback | undefined;
    const batcher = createItemEventBatcher({
      handleEvent,
      scheduleFrame: (callback) => {
        frame = callback;
        return 1;
      },
      cancelFrame: vi.fn(),
      setTimer: vi.fn(() => 1 as unknown as ReturnType<typeof setTimeout>),
      clearTimer: vi.fn(),
    });

    batcher.handle(update("first"));
    batcher.handle(update("latest"));

    expect(handleEvent).not.toHaveBeenCalled();
    frame?.(0);
    expect(handleEvent).toHaveBeenCalledTimes(1);
    expect(handleEvent).toHaveBeenCalledWith({
      type: "items.updated",
      sessionId: "session-1",
      turnId: "turn-1",
      items: [
        { id: "answer", type: "agentMessage", text: "latest", settled: false },
      ],
    });
  });

  it("flushes pending updates before a state-transition event", () => {
    const handleEvent = vi.fn();
    const batcher = createItemEventBatcher({
      handleEvent,
      scheduleFrame: vi.fn(() => 1),
      cancelFrame: vi.fn(),
      setTimer: vi.fn(() => 1 as unknown as ReturnType<typeof setTimeout>),
      clearTimer: vi.fn(),
    });
    const completed: ItemEvent = {
      type: "turn.completed",
      sessionId: "session-1",
      turnId: "turn-1",
    };

    batcher.handle(update("partial"));
    batcher.handle(completed);

    expect(handleEvent.mock.calls.map(([event]) => event)).toEqual([
      {
        type: "items.updated",
        sessionId: "session-1",
        turnId: "turn-1",
        items: [
          {
            id: "answer",
            type: "agentMessage",
            text: "partial",
            settled: false,
          },
        ],
      },
      completed,
    ]);
  });

  it("flushes through the fallback timer when animation frames are throttled", () => {
    const handleEvent = vi.fn();
    let fallback: (() => void) | undefined;
    const batcher = createItemEventBatcher({
      handleEvent,
      scheduleFrame: vi.fn(() => 1),
      cancelFrame: vi.fn(),
      setTimer: (callback) => {
        fallback = callback;
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: vi.fn(),
    });

    batcher.handle(update("visible without a frame"));
    fallback?.();

    expect(handleEvent).toHaveBeenCalledWith({
      type: "items.updated",
      sessionId: "session-1",
      turnId: "turn-1",
      items: [
        {
          id: "answer",
          type: "agentMessage",
          text: "visible without a frame",
          settled: false,
        },
      ],
    });
  });
});
