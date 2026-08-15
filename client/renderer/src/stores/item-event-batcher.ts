import type { ItemEvent } from "./unified-chat-store";

const FRAME_FALLBACK_MS = 100;

type ScheduleFrame = (callback: FrameRequestCallback) => number;
type CancelFrame = (handle: number) => void;

interface ItemEventBatcherOptions {
  handleEvent: (event: ItemEvent) => void;
  scheduleFrame?: ScheduleFrame;
  cancelFrame?: CancelFrame;
  setTimer?: (
    callback: () => void,
    delay: number,
  ) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

export function createItemEventBatcher({
  handleEvent,
  scheduleFrame = requestAnimationFrame,
  cancelFrame = cancelAnimationFrame,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}: ItemEventBatcherOptions) {
  const pendingByTurn = new Map<
    string,
    Map<string, NonNullable<ItemEvent["item"]>>
  >();
  let frameHandle: number | null = null;
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

  const clearScheduledFlush = () => {
    if (frameHandle !== null) {
      cancelFrame(frameHandle);
      frameHandle = null;
    }
    if (fallbackTimer !== null) {
      clearTimer(fallbackTimer);
      fallbackTimer = null;
    }
  };

  const flush = () => {
    clearScheduledFlush();
    for (const [turnKey, itemsById] of pendingByTurn) {
      const [sessionId, turnId] = turnKey.split("\u0000");
      handleEvent({
        type: "items.updated",
        sessionId,
        turnId,
        items: Array.from(itemsById.values()),
      });
    }
    pendingByTurn.clear();
  };

  const scheduleFlush = () => {
    if (frameHandle === null) {
      frameHandle = scheduleFrame(() => flush());
    }
    if (fallbackTimer === null) {
      fallbackTimer = setTimer(flush, FRAME_FALLBACK_MS);
    }
  };

  const enqueue = (event: ItemEvent) => {
    const updates = event.items ?? (event.item ? [event.item] : []);
    if (!updates.length) {
      flush();
      handleEvent(event);
      return;
    }
    const turnKey = `${event.sessionId}\u0000${event.turnId}`;
    const itemsById = pendingByTurn.get(turnKey) ?? new Map();
    pendingByTurn.set(turnKey, itemsById);
    for (const item of updates) itemsById.set(item.id, item);
    scheduleFlush();
  };

  return {
    handle(event: ItemEvent) {
      if (event.type === "item.updated" || event.type === "items.updated") {
        enqueue(event);
        return;
      }
      flush();
      handleEvent(event);
    },
    flush,
    dispose() {
      clearScheduledFlush();
      pendingByTurn.clear();
    },
  };
}
