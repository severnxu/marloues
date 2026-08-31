import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Globe,
  Send,
  MessageSquarePlus,
} from "lucide-react";

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
  const [lastEvent, setLastEvent] = useState<string | null>(null);
  const [commentMode, setCommentMode] = useState(false);
  const [commentBadge, setCommentBadge] = useState(0);

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

  // Listen for browser events (agent interactions, navigation, etc.)
  useEffect(() => {
    if (!pageId) return;
    const off = window.marloues.browser?.onBrowserEvent(
      (changedPageId, type, data) => {
        if (changedPageId === pageId) {
          const detail =
            typeof data === "object" && data
              ? JSON.stringify(data)
              : String(data ?? "");
          setLastEvent(`${type}: ${detail}`);
          setTimeout(() => setLastEvent(null), 5000);
        }
      },
    );
    return () => off?.();
  }, [pageId]);

  // Listen for comment/annotation events from the bridge
  useEffect(() => {
    if (!pageId) return;
    const off = window.marloues.browser?.onCommentEvent(
      (changedPageId, event) => {
        if (changedPageId !== pageId) return;
        const entry = event as {
          type?: string;
          pageUrl?: unknown;
          screenshotDataUrl?: unknown;
          payload?: unknown;
        };
        if (entry?.type === "comment-added") {
          setCommentBadge((n) => n + 1);
          setTimeout(() => setCommentBadge((n) => Math.max(0, n - 1)), 3000);
          // Dispatch comment to agent input as a send-to-agent event
          window.dispatchEvent(
            new CustomEvent("browser:send-to-agent", {
              detail: {
                pageId,
                type: "comment",
                payload:
                  entry.payload && typeof entry.payload === "object"
                    ? {
                        ...(entry.payload as Record<string, unknown>),
                        pageUrl:
                          typeof entry.pageUrl === "string"
                            ? entry.pageUrl
                            : undefined,
                        screenshotDataUrl:
                          typeof entry.screenshotDataUrl === "string"
                            ? entry.screenshotDataUrl
                            : undefined,
                      }
                    : entry.payload,
              },
            }),
          );
        }
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

  const handleSendToAgent = useCallback(() => {
    if (!pageId || !urlInput) return;
    // Dispatch a custom event that the chat input can intercept
    window.dispatchEvent(
      new CustomEvent("browser:send-to-agent", {
        detail: { pageId, url: urlInput },
      }),
    );
  }, [pageId, urlInput]);

  const handleToggleComment = useCallback(() => {
    if (!pageId) return;
    const next = !commentMode;
    setCommentMode(next);
    void window.marloues.browser?.setCommentMode(pageId, next, {
      selectionMode: "dom_node",
      theme: "system",
    });
    if (!next) setCommentBadge(0);
  }, [pageId, commentMode]);

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
        <button
          className="browser-panel-btn"
          onClick={handleSendToAgent}
          title="发送给 Agent"
          disabled={!urlInput}
        >
          <Send size={16} />
        </button>
        <button
          className={`browser-panel-btn ${commentMode ? "browser-panel-btn-active" : ""}`}
          onClick={handleToggleComment}
          title={commentMode ? "退出标注模式" : "进入标注模式"}
        >
          <MessageSquarePlus size={16} />
          {commentBadge > 0 && (
            <span className="browser-panel-badge">{commentBadge}</span>
          )}
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
      {lastEvent && <div className="browser-panel-event-bar">{lastEvent}</div>}
      <div
        ref={containerRef}
        className="browser-panel-container"
        style={{ width: "100%", flex: 1, position: "relative" }}
      />
    </div>
  );
}
