import { useCallback, useEffect, useRef, useState } from "react";
import {
  CONVERSATION_PAGE_CONTRACT,
  directScrollInputBreaksBottomLock,
} from "@shared/conversation-page-contract";

export type WorkflowScrollAnchorOptions = {
  contentSignal: unknown;
  isGenerating: boolean;
  isReplayView: boolean;
  replayLocationKey: string;
  sessionKey: string;
  nearBottomThreshold?: number;
};

export type WorkflowScrollAnchor = {
  viewportRef: React.RefObject<HTMLDivElement>;
  handleScroll: () => void;
  isAtBottom: boolean;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
};

export function workflowScrollIsNearBottom({
  scrollHeight,
  scrollTop,
  clientHeight,
  threshold = 80,
}: {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
  threshold?: number;
}) {
  return scrollHeight - scrollTop - clientHeight < threshold;
}

export function useWorkflowScrollAnchor({
  contentSignal,
  isGenerating,
  isReplayView,
  replayLocationKey,
  sessionKey,
  nearBottomThreshold = CONVERSATION_PAGE_CONTRACT.bottomLockThresholdPx,
}: WorkflowScrollAnchorOptions): WorkflowScrollAnchor {
  const viewportRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const lastSessionKeyRef = useRef<string | null>(null);
  const lastReplayLocationRef = useRef("");
  const [isAtBottom, setIsAtBottom] = useState(true);
  const programmaticScrollRef = useRef(false);

  const setBottomStickiness = useCallback((next: boolean) => {
    shouldStickToBottomRef.current = next;
    setIsAtBottom((current) => (current === next ? current : next));
  }, []);

  const handleScroll = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    setBottomStickiness(
      workflowScrollIsNearBottom({
        scrollHeight: viewport.scrollHeight,
        scrollTop: viewport.scrollTop,
        clientHeight: viewport.clientHeight,
        threshold: nearBottomThreshold,
      }),
    );
  }, [nearBottomThreshold, setBottomStickiness]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const breakLock = (kind: "touch" | "keyboard" | "scrollbar") => {
      if (programmaticScrollRef.current) return;
      if (directScrollInputBreaksBottomLock({ kind }))
        setBottomStickiness(false);
    };
    const handleWheel = (event: WheelEvent) => {
      if (
        directScrollInputBreaksBottomLock({
          kind: "wheel",
          deltaY: event.deltaY,
        })
      )
        setBottomStickiness(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (["ArrowUp", "PageUp", "Home"].includes(event.key))
        breakLock("keyboard");
    };
    const handleTouchStart = () => breakLock("touch");
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target !== viewport) return;
      if (event.offsetX >= viewport.clientWidth - 18) breakLock("scrollbar");
    };
    viewport.addEventListener("wheel", handleWheel, { passive: true });
    viewport.addEventListener("touchstart", handleTouchStart, {
      passive: true,
    });
    viewport.addEventListener("pointerdown", handlePointerDown, {
      passive: true,
    });
    viewport.addEventListener("keydown", handleKeyDown);
    return () => {
      viewport.removeEventListener("wheel", handleWheel);
      viewport.removeEventListener("touchstart", handleTouchStart);
      viewport.removeEventListener("pointerdown", handlePointerDown);
      viewport.removeEventListener("keydown", handleKeyDown);
    };
  }, [setBottomStickiness]);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      programmaticScrollRef.current = true;
      viewport.scrollTo({ top: viewport.scrollHeight, behavior });
      setBottomStickiness(true);
      requestAnimationFrame(() => {
        programmaticScrollRef.current = false;
      });
    },
    [setBottomStickiness],
  );

  const scheduleScrollToBottom = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      requestAnimationFrame(() => {
        scrollToBottom(behavior);
        requestAnimationFrame(() => {
          scrollToBottom("auto");
        });
      });
    },
    [scrollToBottom],
  );

  useEffect(() => {
    if (lastSessionKeyRef.current !== sessionKey) {
      lastSessionKeyRef.current = sessionKey;
      setBottomStickiness(true);
    }

    if (isReplayView) {
      if (lastReplayLocationRef.current !== replayLocationKey) {
        lastReplayLocationRef.current = replayLocationKey;
        setBottomStickiness(true);
        scheduleScrollToBottom("auto");
        return;
      }

      if (shouldStickToBottomRef.current) {
        scheduleScrollToBottom("auto");
      }
      return;
    }

    lastReplayLocationRef.current = "";

    if (shouldStickToBottomRef.current) {
      scheduleScrollToBottom("smooth");
    }
  }, [
    contentSignal,
    isGenerating,
    isReplayView,
    replayLocationKey,
    scheduleScrollToBottom,
    sessionKey,
    setBottomStickiness,
  ]);

  return {
    viewportRef,
    handleScroll,
    isAtBottom,
    scrollToBottom,
  };
}
