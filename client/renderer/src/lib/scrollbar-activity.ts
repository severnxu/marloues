/**
 * 自定义滚动条的「滚动中」状态标记。
 *
 * Chromium 一旦用 ::-webkit-scrollbar 自定义滚动条，就会按 legacy 滚动条
 * 处理（常驻显示），不再走 macOS 原生的 overlay 自动隐藏。样式侧把 thumb
 * 默认设为透明，只在「正在滚动」时显示。这里在捕获阶段监听 scroll 事件，
 * 给「正在滚动」的那个滚动容器本身打上 marloues-scrolling 标记，900ms 内无
 * 新事件则移除。标记挂在具体容器上（而非 html），这样同时存在多个滚动区
 * 时只有被滚动的那一个 thumb 会亮，其余保持隐藏。
 *
 * HMR：main.tsx 只在启动时调用一次 initScrollbarActivity()。Vite 热替换本
 * 模块时不会重新执行那次调用，旧的监听器会引用旧闭包，与新 CSS 错位导致
 * thumb 不再显示。这里用 import.meta.hot.accept 在模块更新时重新初始化。
 * 监听器引用存在 window 上（而非模块作用域），因为模块重执行会让模块级
 * 变量重置、无法 removeEventListener 掉旧监听器；initScrollbarActivity 本
 * 身先移除旧监听器再加新的，保证全局只挂一份。
 */

const SCROLLING_CLASS = "marloues-scrolling";
const HIDE_DELAY_MS = 900;
const LISTENER_KEY = "__marlouesScrollbarListener";

const timers = new WeakMap<Element, number>();

function markScrolling(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  target.classList.add(SCROLLING_CLASS);
  const prev = timers.get(target);
  if (prev !== undefined) window.clearTimeout(prev);
  timers.set(
    target,
    window.setTimeout(() => {
      target.classList.remove(SCROLLING_CLASS);
      timers.delete(target);
    }, HIDE_DELAY_MS),
  );
}

export function initScrollbarActivity(): void {
  const store = window as unknown as Record<
    string,
    ((event: Event) => void) | undefined
  >;
  const prev = store[LISTENER_KEY];
  if (prev) {
    window.removeEventListener("scroll", prev, { capture: true });
  }
  store[LISTENER_KEY] = markScrolling;
  window.addEventListener("scroll", markScrolling, {
    capture: true,
    passive: true,
  });
}

if (import.meta.hot) {
  import.meta.hot.accept(() => initScrollbarActivity());
}
