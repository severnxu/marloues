import { useEffect, useRef, type ReactNode } from "react";

/**
 * ViewportCulling — 视口外 turn 容器自动加 content-visibility:auto 裁剪。
 *
 * 用 IntersectionObserver 观察所有 [data-message-id] 子节点：
 * - 进入视口附近：移除占位高度、设 content-visibility:visible
 * - 离开视口：设 content-visibility:auto + contain-intrinsic-size 保留布局，跳过渲染
 *
 * 零侵入：不改变 DOM 结构，对 markdown/代码块高亮无影响。
 * 需要放在滚动容器内部，通过 root prop 传入滚动 ref。
 *
 * 预读缓冲（rootMargin）让即将进入的 turn 提前渲染，避免快速滚动出现空白。
 */
interface Props {
  /** 滚动容器 ref（IntersectionObserver root） */
  scrollRef: React.RefObject<HTMLDivElement>;
  children: ReactNode;
}

// 预读缓冲：视口上下各预留 3 屏，提前渲染即将进入的内容。
// 1 屏缓冲在快速滚动（惯性/拖滚动条/恢复位置）时会整屏跳进已裁剪区导致空白。
const ROOT_MARGIN = "300% 0px 300% 0px";
const MESSAGE_SELECTOR = "[data-message-id]";

export function ViewportCulling({ scrollRef, children }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = scrollRef.current;
    const container = containerRef.current;
    if (!root || !container || typeof IntersectionObserver === "undefined")
      return;

    const observed = new Set<HTMLElement>();
    const observeNode = (node: HTMLElement) => {
      if (observed.has(node)) return;
      observed.add(node);
      io.observe(node);
    };
    const observeMessageNodes = (rootNode: ParentNode) => {
      if (
        rootNode instanceof HTMLElement &&
        rootNode.matches(MESSAGE_SELECTOR)
      ) {
        observeNode(rootNode);
      }
      rootNode
        .querySelectorAll?.<HTMLElement>(MESSAGE_SELECTOR)
        .forEach(observeNode);
    };

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const el = entry.target as HTMLElement;
          if (entry.isIntersecting) {
            // 进入缓冲区：完整渲染
            el.style.contentVisibility = "";
            el.style.containIntrinsicSize = "";
          } else {
            // 离开缓冲区：跳过渲染但保留占位，避免滚动条跳动
            el.style.contentVisibility = "auto";
            // 记录当前高度作为固有尺寸，防止回填时跳动
            const h = el.offsetHeight;
            if (h > 0) {
              // auto <len>：浏览器记住最近一次真实渲染尺寸（异步内容长高后回滚不再显示旧占位）
              el.style.containIntrinsicSize = `auto ${h}px`;
            }
          }
        }
      },
      {
        root,
        rootMargin: ROOT_MARGIN,
        threshold: 0,
      },
    );

    // 延迟到下一帧收集，确保子节点已挂载
    const raf = requestAnimationFrame(() => {
      observeMessageNodes(container);
    });
    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver((mutations) => {
            for (const mutation of mutations) {
              mutation.addedNodes.forEach((node) => {
                if (node instanceof HTMLElement) observeMessageNodes(node);
              });
            }
          });
    mutationObserver?.observe(container, { childList: true, subtree: true });

    return () => {
      cancelAnimationFrame(raf);
      mutationObserver?.disconnect();
      observed.forEach((node) => {
        node.style.contentVisibility = "";
        node.style.containIntrinsicSize = "";
      });
      observed.clear();
      io.disconnect();
    };
  }, [scrollRef]);

  return (
    <div
      ref={containerRef}
      className="viewport-culling-container"
      style={{ contain: "layout" }}
    >
      {children}
    </div>
  );
}
