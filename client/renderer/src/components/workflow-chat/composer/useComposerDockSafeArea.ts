import { useEffect, useRef } from "react";

export function useComposerDockSafeArea() {
  const dockRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dock = dockRef.current;
    const chatPage = dock?.closest<HTMLElement>(".chat-page");
    if (!dock || !chatPage) return undefined;

    const updateSafeArea = () => {
      const dockStyle = window.getComputedStyle(dock);
      const pageStyle = window.getComputedStyle(chatPage);
      const fadeInset = Number.parseFloat(dockStyle.paddingTop) || 0;
      const contentGap =
        Number.parseFloat(
          pageStyle.getPropertyValue("--interaction-content-gap"),
        ) || 0;
      const visibleHeight = dock.getBoundingClientRect().height - fadeInset;
      chatPage.style.setProperty(
        "--interaction-dock-safe-area",
        `${Math.ceil(visibleHeight + contentGap)}px`,
      );
    };

    updateSafeArea();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateSafeArea);
    observer?.observe(dock);
    window.addEventListener("resize", updateSafeArea);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateSafeArea);
      chatPage.style.removeProperty("--interaction-dock-safe-area");
    };
  }, []);

  return dockRef;
}
