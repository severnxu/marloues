import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CircleX,
  RotateCw,
  Globe,
  Send,
  MessageSquarePlus,
  Trash2,
} from "lucide-react";

type PendingComment = {
  eventId: number;
  payload: Record<string, unknown>;
};

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
  const [pendingComments, setPendingComments] = useState<PendingComment[]>([]);
  const lastCommentEventId = useRef(0);

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

  const applyCommentEvent = useCallback((event: unknown) => {
    const entry = event as {
      eventId?: unknown;
      type?: unknown;
      commentId?: unknown;
      payload?: unknown;
    };
    const eventId = typeof entry.eventId === "number" ? entry.eventId : 0;
    if (eventId)
      lastCommentEventId.current = Math.max(
        lastCommentEventId.current,
        eventId,
      );
    if (
      entry.type === "comment-added" &&
      entry.payload &&
      typeof entry.payload === "object"
    ) {
      const payload = entry.payload as Record<string, unknown>;
      const commentId = Number(payload.commentId);
      setPendingComments((previous) => {
        const withoutDuplicate = previous.filter(
          (item) => Number(item.payload.commentId) !== commentId,
        );
        return [...withoutDuplicate, { eventId, payload }];
      });
      return;
    }
    if (entry.type === "comment-removed") {
      const commentId = Number(
        entry.commentId ??
          (entry.payload as { commentId?: unknown } | undefined)?.commentId,
      );
      if (Number.isFinite(commentId)) {
        setPendingComments((previous) =>
          previous.filter(
            (item) => Number(item.payload.commentId) !== commentId,
          ),
        );
      }
    }
  }, []);

  // Listen for comment/annotation events from the bridge
  useEffect(() => {
    if (!pageId) return;
    lastCommentEventId.current = 0;
    setPendingComments([]);
    void window.marloues.browser?.getCommentEvents(pageId, 0).then((result) => {
      if (!result) return;
      result.commentEvents.forEach(applyCommentEvent);
      lastCommentEventId.current = Math.max(
        lastCommentEventId.current,
        result.maxCommentEventId,
      );
      setCommentMode(result.annotationEnabled);
    });
    const off = window.marloues.browser?.onCommentEvent(
      (changedPageId, event) => {
        if (changedPageId !== pageId) return;
        applyCommentEvent(event);
      },
    );
    return () => off?.();
  }, [applyCommentEvent, pageId]);

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
    if (!next) setPendingComments([]);
  }, [pageId, commentMode]);

  const handleClearComments = useCallback(() => {
    if (!pageId) return;
    setPendingComments([]);
    lastCommentEventId.current = 0;
    void window.marloues.browser?.clearComments(pageId);
  }, [pageId]);

  const handleSendComments = useCallback(() => {
    if (!pageId || pendingComments.length === 0) return;
    const pageUrl = urlInput || undefined;
    window.dispatchEvent(
      new CustomEvent("browser:send-to-agent", {
        detail: {
          pageId,
          type: "comments",
          payloads: pendingComments.map(({ payload }) => ({
            ...payload,
            pageUrl,
          })),
        },
      }),
    );
    const lastId = lastCommentEventId.current;
    setPendingComments([]);
    if (lastId > 0)
      void window.marloues.browser?.ackCommentEvents(pageId, lastId);
  }, [pageId, pendingComments, urlInput]);

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
      {commentMode ? (
        <div className="browser-annotation-bar">
          <button
            className="browser-panel-btn"
            onClick={handleToggleComment}
            title="退出批注"
            aria-label="退出批注"
          >
            <CircleX size={16} />
          </button>
          <button
            className="browser-panel-btn"
            onClick={handleClearComments}
            title="清空批注"
            aria-label="清空批注"
            disabled={pendingComments.length === 0}
          >
            <Trash2 size={16} />
          </button>
          <div className="browser-annotation-title" title={urlInput}>
            正在批注 · {urlInput || "当前页面"}
          </div>
          <button
            className="browser-annotation-send"
            onClick={handleSendComments}
            disabled={pendingComments.length === 0}
          >
            <Send size={14} />
            发送 {pendingComments.length}
          </button>
        </div>
      ) : (
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
            title="进入批注模式"
            aria-label="进入批注模式"
          >
            <MessageSquarePlus size={16} />
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
      )}
      {lastEvent && <div className="browser-panel-event-bar">{lastEvent}</div>}
      <div
        ref={containerRef}
        className="browser-panel-container"
        style={{ width: "100%", flex: 1, position: "relative" }}
      />
    </div>
  );
}
