import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CircleX,
  EllipsisVertical,
  ExternalLink,
  RotateCw,
  Globe,
  LockKeyhole,
  ShieldAlert,
  Send,
  MessageSquarePlus,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { useThemeStore } from "@/stores/theme-store";

type PendingComment = {
  eventId: number;
  payload: Record<string, unknown>;
};

type BrowserNavigationError = {
  url: string;
  errorCode: number;
  errorDescription: string;
};

type BrowserNavigationState = {
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
};

function isBlankBrowserUrl(url: string): boolean {
  const normalized = url.trim().toLowerCase();
  return normalized === "" || normalized === "about:blank";
}

function normalizeBrowserUrl(url: string): string {
  const trimmed = url.trim();
  return /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function browserErrorHost(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

export function browserNavigationErrorMessage(
  url: string,
  errorDescription: string,
): string {
  const host = browserErrorHost(url);
  if (errorDescription === "ERR_CONNECTION_REFUSED") {
    return `${host} 拒绝建立连接`;
  }
  if (errorDescription === "ERR_INTERNET_DISCONNECTED") {
    return "网络连接已断开";
  }
  if (errorDescription === "ERR_NAME_NOT_RESOLVED") {
    return `找不到 ${host} 的服务器 IP 地址`;
  }
  return `${host} 暂时无法访问`;
}

/**
 * Renders a user-facing browser panel backed by a renderer-side <webview> tag.
 *
 * The <webview> lives inside the renderer DOM, so React overlays (image
 * lightbox, menus, auxiliary items) can naturally stack above it via CSS
 * z-index. Navigation is handled by the main process via webContents.loadURL()
 * — the webview's `src` attribute is only used for the initial load.
 */
export function BrowserPanel({
  pageId,
  onTitleChange,
}: {
  pageId?: string;
  onTitleChange?: (title: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const siteInfoRef = useRef<HTMLDivElement>(null);
  const webviewRef = useRef<HTMLElement | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [currentUrl, setCurrentUrl] = useState("about:blank");
  const [navigationError, setNavigationError] =
    useState<BrowserNavigationError | null>(null);
  const [navigationState, setNavigationState] =
    useState<BrowserNavigationState>({
      canGoBack: false,
      canGoForward: false,
      isLoading: false,
    });
  const [commentMode, setCommentMode] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [siteInfoOpen, setSiteInfoOpen] = useState(false);
  const isDark = useThemeStore((state) => state.isDark);
  const [pendingComments, setPendingComments] = useState<PendingComment[]>([]);
  const lastCommentEventId = useRef(0);
  const urlInputRef = useRef(urlInput);
  const onTitleChangeRef = useRef(onTitleChange);
  const isBlankPage = isBlankBrowserUrl(currentUrl);
  const hasAddressValue = !isBlankBrowserUrl(urlInput);

  useEffect(() => {
    urlInputRef.current = urlInput;
  }, [urlInput]);

  useEffect(() => {
    onTitleChangeRef.current = onTitleChange;
  }, [onTitleChange]);

  // Create the <webview> tag imperatively. The webview lives in the renderer
  // DOM, so React overlays (image lightbox, menus, auxiliary items) can
  // naturally stack above it via CSS z-index — no native surface obscuring
  // or snapshot workarounds needed.
  useEffect(() => {
    if (!pageId || !containerRef.current) return;

    let disposed = false;
    let registered = false;
    void window.marloues.browser?.listPages().then((pages) => {
      if (disposed || !containerRef.current) return;
      const page = pages.find((entry) => entry.pageId === pageId);
      const initialUrl =
        page && !isBlankBrowserUrl(page.url) ? page.url : "about:blank";

      const webview = document.createElement("webview") as HTMLElement & {
        getWebContentsId: () => number;
      };
      webview.setAttribute("partition", "persist:marloues-browser");
      webview.setAttribute(
        "webpreferences",
        "contextIsolation=yes,nodeIntegration=no,sandbox=yes",
      );
      webview.classList.add("browser-panel-webview");

      // getWebContentsId() requires the webview to be attached to the DOM
      // AND the dom-ready event to have fired. Only call it on dom-ready —
      // calling on did-attach throws an uncaught error from the webview's
      // internal isolated_bundle that can leave the guest in a broken state.
      const onDomReady = () => {
        if (registered || disposed) return;
        try {
          const wcId = (
            webview as HTMLElement & { getWebContentsId: () => number }
          ).getWebContentsId();
          registered = true;
          void window.marloues.browser?.registerWebview(pageId, wcId);
        } catch (err) {
          console.error("[BrowserPanel] registerWebview failed", err);
        }
      };
      webview.addEventListener("dom-ready", onDomReady);

      // Append to DOM first, then set src — setting src before attachment
      // can trigger "WebView must be attached to the DOM" errors.
      containerRef.current.appendChild(webview);
      webview.setAttribute("src", initialUrl);
      webviewRef.current = webview;
    });

    return () => {
      disposed = true;
      if (webviewRef.current) {
        webviewRef.current.remove();
        webviewRef.current = null;
      }
    };
  }, [pageId]);

  useEffect(() => {
    if (!pageId) return;
    let disposed = false;
    void window.marloues.browser?.listPages().then((pages) => {
      if (disposed) return;
      const page = pages.find((entry) => entry.pageId === pageId);
      if (!page) return;
      setCurrentUrl(page.url);
      setUrlInput(isBlankBrowserUrl(page.url) ? "" : page.url);
      setNavigationError(
        page.title === "无法访问此站点" && !isBlankBrowserUrl(page.url)
          ? { url: page.url, errorCode: 0, errorDescription: "" }
          : null,
      );
      onTitleChangeRef.current?.(page.title);
    });
    void window.marloues.browser?.navigationState(pageId).then((state) => {
      if (!disposed) setNavigationState(state);
    });
    const off = window.marloues.browser?.onUrlChanged(
      (_threadId, changedPageId, url) => {
        if (changedPageId !== pageId) return;
        setNavigationError(null);
        setCurrentUrl(url);
        setUrlInput(isBlankBrowserUrl(url) ? "" : url);
      },
    );
    const offTitle = window.marloues.browser?.onTitleChanged(
      (changedPageId, title) => {
        if (changedPageId === pageId) onTitleChangeRef.current?.(title);
      },
    );
    const offLoadFailed = window.marloues.browser?.onLoadFailed(
      (changedPageId, error) => {
        if (changedPageId !== pageId) return;
        setCurrentUrl(error.url);
        setUrlInput(error.url);
        setNavigationError(error);
      },
    );
    const offNavigationState =
      window.marloues.browser?.onNavigationStateChanged(
        (changedPageId, state) => {
          if (changedPageId === pageId) setNavigationState(state);
        },
      );
    return () => {
      disposed = true;
      off?.();
      offTitle?.();
      offLoadFailed?.();
      offNavigationState?.();
    };
  }, [pageId]);

  useEffect(() => {
    if (!moreMenuOpen) return;
    const closeMenu = (event: MouseEvent) => {
      if (!moreMenuRef.current?.contains(event.target as Node)) {
        setMoreMenuOpen(false);
      }
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setMoreMenuOpen(false);
    };
    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [moreMenuOpen]);

  useEffect(() => {
    if (!siteInfoOpen) return;
    const closeSiteInfo = (event: MouseEvent) => {
      if (!siteInfoRef.current?.contains(event.target as Node)) {
        setSiteInfoOpen(false);
      }
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setSiteInfoOpen(false);
    };
    window.addEventListener("pointerdown", closeSiteInfo);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeSiteInfo);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [siteInfoOpen]);

  const applyCommentEvent = useCallback(
    (event: unknown) => {
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
        // A saved page annotation is immediately available in the composer as a
        // structured attachment. The annotation bar's send action is separate:
        // it submits the current composer text and the accumulated annotations.
        if (pageId) {
          window.dispatchEvent(
            new CustomEvent("browser:send-to-agent", {
              detail: {
                pageId,
                type: "comment",
                payload: {
                  ...payload,
                  pageUrl: urlInputRef.current || undefined,
                },
              },
            }),
          );
        }
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
          if (pageId) {
            window.dispatchEvent(
              new CustomEvent("browser:comment-removed", {
                detail: { pageId, commentId },
              }),
            );
          }
        }
        return;
      }
      if (entry.type === "comment-mode-changed") {
        const enabled = (entry as { enabled?: unknown }).enabled;
        if (typeof enabled === "boolean") {
          setCommentMode(enabled);
          if (!enabled) setPendingComments([]);
        }
      }
    },
    [pageId],
  );

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
      const normalized = normalizeBrowserUrl(url);
      setNavigationError(null);
      setUrlInput(normalized);
      setCurrentUrl(normalized);
      void window.marloues.browser?.viewNavigate(pageId, normalized);
    },
    [pageId],
  );

  const handleBack = useCallback(() => {
    if (!pageId) return;
    setNavigationError(null);
    void window.marloues.browser?.goBack(pageId);
  }, [pageId]);

  const handleForward = useCallback(() => {
    if (!pageId) return;
    setNavigationError(null);
    void window.marloues.browser?.goForward(pageId);
  }, [pageId]);

  const handleReload = useCallback(() => {
    if (!pageId) return;
    setNavigationError(null);
    void window.marloues.browser?.reload(pageId);
  }, [pageId]);

  const handleSendToAgent = useCallback(() => {
    if (!pageId || !urlInput) return;
    // Dispatch a custom event that the chat input can intercept
    window.dispatchEvent(
      new CustomEvent("browser:send-to-agent", {
        detail: { pageId, url: urlInput },
      }),
    );
  }, [pageId, urlInput]);

  const handleOpenExternal = useCallback(() => {
    if (!hasAddressValue) return;
    window.open(normalizeBrowserUrl(urlInput), "_blank", "noopener,noreferrer");
  }, [hasAddressValue, urlInput]);

  const site = (() => {
    try {
      const parsed = new URL(normalizeBrowserUrl(currentUrl));
      return {
        host: parsed.host,
        secure: parsed.protocol === "https:",
      };
    } catch {
      return { host: currentUrl, secure: false };
    }
  })();

  const handleToggleComment = useCallback(async () => {
    if (!pageId) return;
    const next = !commentMode;
    const result = await window.marloues.browser?.setCommentMode(pageId, next, {
      selectionMode: "dom_node",
      theme: isDark ? "dark" : "light",
    });
    if (!result?.success) return;
    setCommentMode(next);
    if (!next) setPendingComments([]);
  }, [pageId, commentMode, isDark]);

  useEffect(() => {
    if (!pageId || !commentMode) return;
    const exitCommentMode = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      void window.marloues.browser
        ?.setCommentMode(pageId, false)
        .then((result) => {
          if (!result?.success) return;
          setCommentMode(false);
          setPendingComments([]);
        });
    };
    window.addEventListener("keydown", exitCommentMode, true);
    return () => window.removeEventListener("keydown", exitCommentMode, true);
  }, [commentMode, pageId]);

  useEffect(() => {
    if (!pageId || !commentMode) return;
    void window.marloues.browser?.setCommentMode(pageId, true, {
      selectionMode: "dom_node",
      theme: isDark ? "dark" : "light",
    });
  }, [pageId, commentMode, isDark]);

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
          type: "submit-comments",
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
          <button
            className="browser-panel-btn"
            onClick={handleBack}
            title="后退"
            aria-label="后退"
            disabled={!navigationState.canGoBack}
          >
            <ArrowLeft size={18} />
          </button>
          <button
            className="browser-panel-btn"
            onClick={handleForward}
            title="前进"
            aria-label="前进"
            disabled={!navigationState.canGoForward}
          >
            <ArrowRight size={18} />
          </button>
          <button
            className="browser-panel-btn"
            onClick={handleReload}
            title="刷新"
            aria-label="刷新"
            disabled={isBlankPage}
          >
            <RotateCw
              className={navigationState.isLoading ? "is-loading" : undefined}
              size={18}
            />
          </button>
          <div
            className={`browser-panel-address ${hasAddressValue ? "has-value" : "is-empty"}`}
          >
            {hasAddressValue ? (
              <div className="browser-panel-site-info" ref={siteInfoRef}>
                <button
                  className="browser-panel-address-icon"
                  type="button"
                  title="查看网站信息"
                  aria-label="查看网站信息"
                  aria-haspopup="dialog"
                  aria-expanded={siteInfoOpen}
                  onClick={() => {
                    setMoreMenuOpen(false);
                    setSiteInfoOpen((open) => !open);
                  }}
                >
                  <SlidersHorizontal size={16} />
                </button>
                {siteInfoOpen ? (
                  <div
                    className="browser-panel-site-popover"
                    role="dialog"
                    aria-label="网站信息"
                  >
                    <div className="browser-panel-site-host">{site.host}</div>
                    <div className="browser-panel-site-security">
                      {site.secure ? (
                        <LockKeyhole size={18} aria-hidden="true" />
                      ) : (
                        <ShieldAlert size={18} aria-hidden="true" />
                      )}
                      <div>
                        <strong>
                          {site.secure ? "连接是安全的" : "连接不安全"}
                        </strong>
                        <span>
                          {site.secure
                            ? "发送到此网站的信息会经过加密。"
                            : "请勿在此网站输入密码或信用卡等敏感信息。"}
                        </span>
                      </div>
                    </div>
                    <button
                      className="browser-panel-site-settings"
                      type="button"
                      onClick={() => {
                        handleOpenExternal();
                        setSiteInfoOpen(false);
                      }}
                    >
                      <SlidersHorizontal size={16} />
                      <span>在系统浏览器中查看网站设置</span>
                      <ExternalLink size={14} />
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
            <input
              className="browser-panel-url-input"
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入 URL"
              aria-label="网址"
              spellCheck={false}
            />
            {hasAddressValue ? (
              <button
                className="browser-panel-address-action"
                type="button"
                onClick={handleOpenExternal}
                title="在系统浏览器中打开"
                aria-label="在系统浏览器中打开"
              >
                <ExternalLink size={16} />
              </button>
            ) : null}
          </div>
          {!isBlankPage ? (
            <button
              className={`browser-panel-btn ${commentMode ? "browser-panel-btn-active" : ""}`}
              onClick={handleToggleComment}
              title="进入批注模式"
              aria-label="进入批注模式"
            >
              <MessageSquarePlus size={18} />
            </button>
          ) : null}
          <div className="browser-panel-more" ref={moreMenuRef}>
            <button
              className="browser-panel-btn"
              type="button"
              onClick={() => setMoreMenuOpen((open) => !open)}
              title="更多"
              aria-label="更多"
              aria-haspopup="menu"
              aria-expanded={moreMenuOpen}
            >
              <EllipsisVertical size={18} />
            </button>
            {moreMenuOpen ? (
              <div className="browser-panel-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  disabled={!hasAddressValue}
                  onClick={() => {
                    handleSendToAgent();
                    setMoreMenuOpen(false);
                  }}
                >
                  <Send size={15} />
                  <span>发送给 Agent</span>
                </button>
              </div>
            ) : null}
          </div>
        </div>
      )}
      <div
        ref={containerRef}
        className={`browser-panel-container${isBlankPage || navigationError ? " is-webview-hidden" : ""}`}
        style={{ width: "100%", flex: 1, position: "relative" }}
      >
        {navigationError ? (
          <div className="browser-panel-error" role="alert">
            <div className="browser-panel-error-content">
              <Globe size={38} strokeWidth={1.8} aria-hidden="true" />
              <h2>无法访问此站点</h2>
              <p>
                {browserNavigationErrorMessage(
                  navigationError.url,
                  navigationError.errorDescription,
                )}
              </p>
              <div className="browser-panel-error-tips">
                <span>尝试：</span>
                <ul>
                  <li>检查网络连接</li>
                  <li>检查代理、防火墙和 DNS 配置</li>
                </ul>
              </div>
              <code>
                {navigationError.errorDescription ||
                  `NETWORK_ERROR_${Math.abs(navigationError.errorCode)}`}
              </code>
              <button type="button" onClick={handleReload}>
                重新加载
              </button>
            </div>
          </div>
        ) : isBlankPage ? (
          <div className="browser-panel-start">
            <Globe size={34} strokeWidth={1.7} aria-hidden="true" />
            <strong>开始浏览</strong>
            <span>输入 URL 以打开页面</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
