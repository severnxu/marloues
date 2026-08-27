import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, RotateCw, Globe } from "lucide-react";

/**
 * Renders a user-facing browser panel backed by an Electron WebContentsView.
 *
 * The WebContentsView is a main-process component overlaid on top of the
 * renderer DOM. This component provides a URL bar and a container div whose
 * screen rect is measured via ResizeObserver and pushed to the main process
 * (browser:view-bounds) to position the view. It also listens for url-changed
 * events to keep the URL bar in sync.
 */
export function BrowserPanel({ pageId }: { pageId?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [urlInput, setUrlInput] = useState("");

  const pushBounds = useCallback(() => {
    if (!pageId || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    window.marloues.browser?.setViewBounds(pageId, {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    });
  }, [pageId]);

  useEffect(() => {
    if (!pageId || !containerRef.current) return;
    requestAnimationFrame(() => pushBounds());
    const resizeObserver = new ResizeObserver(() => pushBounds());
    resizeObserver.observe(containerRef.current);
    const onWindowResize = () => pushBounds();
    window.addEventListener("resize", onWindowResize);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", onWindowResize);
    };
  }, [pageId, pushBounds]);

  useEffect(() => {
    if (!pageId) return;
    const off = window.marloues.browser?.onUrlChanged(
      (_threadId, changedPageId, url) => {
        if (changedPageId === pageId) setUrlInput(url);
      },
    );
    return () => off?.();
  }, [pageId]);

  const handleNavigate = useCallback(
    (url: string) => {
      if (!pageId || !url.trim()) return;
      let normalized = url.trim();
      if (!/^https?:\/\//i.test(normalized)) {
        normalized = `https://${normalized}`;
      }
      setUrlInput(normalized);
      void window.marloues.browser?.viewNavigate(pageId, normalized);
    },
    [pageId],
  );

  const handleReload = useCallback(() => {
    if (!pageId) return;
    void window.marloues.browser?.viewNavigate(
      pageId,
      urlInput || "about:blank",
    );
  }, [pageId, urlInput]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") handleNavigate(urlInput);
    },
    [handleNavigate, urlInput],
  );

  if (!pageId) {
    return (
      <div className="browser-panel-empty">
        <Globe size={32} />
        <p>浏览器未初始化</p>
      </div>
    );
  }

  return (
    <div className="browser-panel">
      <div className="browser-panel-toolbar">
        <button className="browser-panel-btn" title="后退" disabled>
          <ArrowLeft size={16} />
        </button>
        <button className="browser-panel-btn" title="前进" disabled>
          <ArrowRight size={16} />
        </button>
        <button
          className="browser-panel-btn"
          onClick={handleReload}
          title="刷新"
        >
          <RotateCw size={16} />
        </button>
        <input
          className="browser-panel-url-input"
          type="text"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入网址或搜索..."
          spellCheck={false}
        />
      </div>
      <div
        ref={containerRef}
        className="browser-panel-container"
        style={{ width: "100%", flex: 1, position: "relative" }}
      />
    </div>
  );
}
