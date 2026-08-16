import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  CONVERSATION_PAGE_CONTRACT,
  directScrollInputBreaksBottomLock,
} from "@shared/conversation-page-contract";

/**
 * useConversationScroll — 融合吸底滚动 + 滚动位置记忆 + 向上加载更多。
 *
 * 灵感来自 Proma 的 use-stick-to-bottom + ScrollPositionManager + ScrollTopLoader，
 * 但用纯 ref 实现，零新依赖，适配 Electron 渲染进程。
 *
 * 职责：
 * 1. 流式内容增长时，若用户在底部附近则平滑吸底；否则不抢滚动。
 * 2. 切换会话时记忆/恢复距底部距离，用 useLayoutEffect 在绘制前定位，避免闪烁。
 * 3. 滚动到顶部附近时触发 onLoadMore；加载完成后补偿 scrollTop 保持视角。
 */

export type ConversationScrollOptions = {
  /** 变化即触发吸底判断的信号（如消息数、流式内容长度） */
  contentSignal: unknown;
  /** 会话 key，切换时恢复滚动位置 */
  sessionKey: string;
  /** 是否在底部阈值内（吸底判断） */
  nearBottomThreshold?: number;
  /** 距顶部多少 px 触发加载更多 */
  topLoadThreshold?: number;
  /** 是否还有更多历史可加载 */
  hasMore: boolean;
  /** 加载更多回调（异步） */
  onLoadMore: () => Promise<void>;
  /** 是否正在加载更多（用于防重入） */
  loadingMore: boolean;
};

export type ConversationScrollAnchor = {
  viewportRef: React.RefObject<HTMLDivElement>;
  contentRef: React.RefObject<HTMLDivElement>;
  handleScroll: () => void;
  isAtBottom: boolean;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  stopStick: () => void;
};

const positionCache = new Map<string, number>();

export function useConversationScroll({
  contentSignal,
  sessionKey,
  nearBottomThreshold = CONVERSATION_PAGE_CONTRACT.bottomLockThresholdPx,
  topLoadThreshold = 100,
  hasMore,
  onLoadMore,
  loadingMore,
}: ConversationScrollOptions): ConversationScrollAnchor {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const shouldStickRef = useRef(true);
  const restoredRef = useRef(false);
  const prevSessionRef = useRef(sessionKey);
  const loadTriggeredRef = useRef(false);
  const stickToBottomRafRef = useRef<number | null>(null);
  const programmaticScrollRef = useRef(false);
  const manuallyDetachedRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  /** 程序性滚动记账：每次吸底/恢复/加载补偿写入 scrollTop 时同步记录，
   *  scroll 事件据此区分「程序性滚动」与「读者移动」——程序性滚动不重判吸底，
   *  避免流式内容增长竞争窗口里被误判为滚离底部（滚动到底部按钮误显示）。 */
  const observedTopRef = useRef(0);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const setStickiness = useCallback((next: boolean) => {
    shouldStickRef.current = next;
    setIsAtBottom((cur) => (cur === next ? cur : next));
  }, []);

  const handleScroll = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const floor = Math.max(0, el.scrollHeight - el.clientHeight);
    // 程序性滚动（吸底跟随/位置恢复/加载补偿）不参与吸底重判；
    // 只有读者真正移动 scrollTop 时才更新 stickiness。
    const movedByReader =
      Math.abs(el.scrollTop - Math.min(observedTopRef.current, floor)) > 0.5;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceFromBottom < nearBottomThreshold;
    const scrollingDown = el.scrollTop > lastScrollTopRef.current;
    lastScrollTopRef.current = el.scrollTop;
    if (movedByReader) {
      if (distanceFromBottom <= 1 || (scrollingDown && nearBottom)) {
        manuallyDetachedRef.current = false;
        setStickiness(true);
      } else if (manuallyDetachedRef.current) {
        setStickiness(false);
      } else {
        setStickiness(nearBottom);
      }
    }

    // 保存距底部距离（仅恢复后保存，避免初始化污染）
    if (restoredRef.current) {
      positionCache.set(sessionKey, distanceFromBottom);
    }

    // 向上加载更多
    if (
      movedByReader &&
      hasMore &&
      !loadingMore &&
      !loadTriggeredRef.current &&
      el.scrollTop < topLoadThreshold
    ) {
      loadTriggeredRef.current = true;
      const prevHeight = el.scrollHeight;
      const prevTop = el.scrollTop;
      onLoadMore().finally(() => {
        // 加载完成后恢复视角
        requestAnimationFrame(() => {
          if (viewportRef.current) {
            viewportRef.current.scrollTop =
              prevTop + (viewportRef.current.scrollHeight - prevHeight);
            observedTopRef.current = viewportRef.current.scrollTop;
          }
        });
      });
    }
  }, [
    nearBottomThreshold,
    hasMore,
    loadingMore,
    onLoadMore,
    sessionKey,
    topLoadThreshold,
    setStickiness,
  ]);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      const el = viewportRef.current;
      if (!el) return;
      programmaticScrollRef.current = true;
      manuallyDetachedRef.current = false;
      el.scrollTo({ top: el.scrollHeight, behavior });
      observedTopRef.current = el.scrollTop;
      setStickiness(true);
      requestAnimationFrame(() => {
        programmaticScrollRef.current = false;
        lastScrollTopRef.current = el.scrollTop;
        observedTopRef.current = el.scrollTop;
      });
    },
    [setStickiness],
  );

  const scheduleScrollToBottom = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      if (stickToBottomRafRef.current != null) return;
      stickToBottomRafRef.current = requestAnimationFrame(() => {
        stickToBottomRafRef.current = null;
        if (!shouldStickRef.current) return;
        scrollToBottom(behavior);
      });
    },
    [scrollToBottom],
  );

  const stopStick = useCallback(() => {
    manuallyDetachedRef.current = true;
    shouldStickRef.current = false;
    setIsAtBottom(false);
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    const breakLock = (kind: "touch" | "keyboard" | "scrollbar") => {
      if (programmaticScrollRef.current) return;
      if (!directScrollInputBreaksBottomLock({ kind })) return;
      manuallyDetachedRef.current = true;
      setStickiness(false);
    };
    const handleWheel = (event: WheelEvent) => {
      if (
        directScrollInputBreaksBottomLock({
          kind: "wheel",
          deltaY: event.deltaY,
        })
      ) {
        manuallyDetachedRef.current = true;
        setStickiness(false);
      }
    };
    const handleTouchStart = () => breakLock("touch");
    const handleKeyDown = (event: KeyboardEvent) => {
      if (["ArrowUp", "PageUp", "Home"].includes(event.key)) {
        breakLock("keyboard");
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target !== viewport) return;
      if (event.offsetX >= viewport.clientWidth - 18) breakLock("scrollbar");
    };
    viewport.addEventListener("wheel", handleWheel, { passive: true });
    viewport.addEventListener("touchstart", handleTouchStart, {
      passive: true,
    });
    viewport.addEventListener("keydown", handleKeyDown);
    viewport.addEventListener("pointerdown", handlePointerDown, {
      passive: true,
    });
    return () => {
      viewport.removeEventListener("wheel", handleWheel);
      viewport.removeEventListener("touchstart", handleTouchStart);
      viewport.removeEventListener("keydown", handleKeyDown);
      viewport.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [setStickiness]);

  // 切换会话：重置恢复标记 + 触发标记
  useEffect(() => {
    if (sessionKey !== prevSessionRef.current) {
      prevSessionRef.current = sessionKey;
      restoredRef.current = false;
      loadTriggeredRef.current = false;
      shouldStickRef.current = true;
      manuallyDetachedRef.current = false;
    }
  }, [sessionKey]);

  // 恢复滚动位置（绘制前执行，配合外层 opacity 控制无闪烁）
  useLayoutEffect(() => {
    if (restoredRef.current) return;
    const el = viewportRef.current;
    if (!el) return;

    const savedDistance = positionCache.get(sessionKey);
    if (savedDistance != null && savedDistance > 5) {
      shouldStickRef.current = false;
      manuallyDetachedRef.current = true;
      const target = el.scrollHeight - el.clientHeight - savedDistance;
      el.scrollTop = Math.max(0, target);
      observedTopRef.current = el.scrollTop;
      lastScrollTopRef.current = el.scrollTop;
      // 巩固一次，防止后续布局变化竞争
      requestAnimationFrame(() => {
        if (!viewportRef.current) return;
        const t =
          viewportRef.current.scrollHeight -
          viewportRef.current.clientHeight -
          savedDistance;
        viewportRef.current.scrollTop = Math.max(0, t);
        observedTopRef.current = viewportRef.current.scrollTop;
      });
    } else {
      el.scrollTop = el.scrollHeight;
      observedTopRef.current = el.scrollTop;
      shouldStickRef.current = true;
      manuallyDetachedRef.current = false;
      lastScrollTopRef.current = el.scrollTop;
    }
    restoredRef.current = true;
  }, [sessionKey]);

  // hasMore 变化时重置加载触发标记（如切换会话后重新可加载）
  useEffect(() => {
    loadTriggeredRef.current = false;
  }, [hasMore]);

  // 内容变化时吸底
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    if (!shouldStickRef.current) return;
    scheduleScrollToBottom("auto");
  }, [
    contentSignal,
    nearBottomThreshold,
    scheduleScrollToBottom,
    setStickiness,
  ]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (shouldStickRef.current) scheduleScrollToBottom("auto");
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [scheduleScrollToBottom, sessionKey]);

  useEffect(() => {
    return () => {
      if (stickToBottomRafRef.current != null) {
        cancelAnimationFrame(stickToBottomRafRef.current);
        stickToBottomRafRef.current = null;
      }
    };
  }, []);

  return {
    viewportRef,
    contentRef,
    handleScroll,
    isAtBottom,
    scrollToBottom,
    stopStick,
  };
}
