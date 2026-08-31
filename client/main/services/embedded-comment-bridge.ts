/**
 * Embedded comment bridge module.
 *
 * Provides the JavaScript injected into an isolated world within the browser
 * page to enable annotation/comment mode. The script handles element
 * selection, visual highlighting, comment input popups, and numbered markers.
 *
 * Communication pattern:
 *   Main -> Bridge : evaluateInIsolatedWorld (control function call)
 *   Bridge -> Main  : CDP Runtime binding (sendCommentEvent)
 *
 * Architecture references the user's own embedded-browser-manager.js (main branch).
 */

// ---------------------------------------------------------------------------
// Constants exported for use by CdpBrowserService
// ---------------------------------------------------------------------------

/** Isolated world ID for the comment bridge script. */
export const EMBEDDED_COMMENT_WORLD_ID = 42;

/** Global control function name exposed on the page's isolated world. */
export const EMBEDDED_COMMENT_CONTROL_NAME = "__embeddedCommentControl";

/** CDP Runtime binding name for bridge to main event delivery. */
export const EMBEDDED_COMMENT_BINDING_NAME = "sendCommentEvent";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Control messages sent from main process to the bridge. */
export type CommentControlMessage =
  | {
      type: "set-enabled";
      enabled: boolean;
      selectionMode: string;
      theme: string;
      palette?: string;
      placeholder?: string;
    }
  | { type: "clear-comments" };

/** Messages sent from the bridge back to the main process. */
export type CommentBridgeMessage =
  | { type: "ready"; messageId?: string; payload?: unknown }
  | { type: "diagnostic"; messageId?: string; payload: unknown }
  | { type: "comment-added"; messageId?: string; payload: CommentPayload }
  | {
      type: "comment-removed";
      messageId?: string;
      payload: { commentId: number };
    }
  | {
      type: "comments-renumbered";
      messageId?: string;
      payload: { comments: Array<{ commentId: number; ref: string }> };
    };

/** Normalized comment payload for a comment-added event. */
export interface CommentPayload {
  commentId: number;
  ref: string;
  tagName: string;
  text: string;
  attributes: Record<string, string>;
  rect: { x: number; y: number; width: number; height: number };
  viewport: { width: number; height: number };
  scrollX: number;
  scrollY: number;
  comment: string;
  pageUrl?: string;
  screenshotDataUrl?: string;
}

// ---------------------------------------------------------------------------
// Normalizer
// ---------------------------------------------------------------------------

/** Normalize an incoming IPC envelope into a typed bridge message. */
export function normalizeCommentBridgeMessage(
  envelope: unknown,
): CommentBridgeMessage | null {
  if (!envelope || typeof envelope !== "object") return null;
  const obj = envelope as Record<string, unknown>;
  const type = typeof obj.type === "string" ? obj.type : "";
  const messageId =
    typeof obj.messageId === "string" ? obj.messageId : undefined;

  switch (type) {
    case "ready":
      return { type: "ready", messageId };
    case "diagnostic":
      return { type: "diagnostic", messageId, payload: obj.payload ?? null };
    case "comment-added":
      return {
        type: "comment-added",
        messageId,
        payload: normalizeCommentPayload(obj.payload) ?? ({} as CommentPayload),
      };
    case "comment-removed": {
      const payload = obj.payload as Record<string, unknown> | undefined;
      const commentId = Number(payload?.commentId ?? 0);
      if (!commentId) return null;
      return { type: "comment-removed", messageId, payload: { commentId } };
    }
    case "comments-renumbered": {
      const payload = obj.payload as Record<string, unknown> | undefined;
      const comments = Array.isArray(payload?.comments)
        ? ((payload.comments as unknown[])
            .map((c) => {
              const r = c as Record<string, unknown>;
              const commentId = Number(r.commentId ?? 0);
              const ref = typeof r.ref === "string" ? r.ref : "";
              return commentId ? { commentId, ref } : null;
            })
            .filter(Boolean) as Array<{ commentId: number; ref: string }>)
        : [];
      return { type: "comments-renumbered", messageId, payload: { comments } };
    }
    default:
      return null;
  }
}

/** Normalize a raw payload object into a CommentPayload, or null if invalid. */
export function normalizeCommentPayload(raw: unknown): CommentPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const commentId = Number(obj.commentId ?? 0);
  if (!commentId) return null;
  const ref = typeof obj.ref === "string" ? obj.ref : "";
  if (!ref) return null;
  const comment = typeof obj.comment === "string" ? obj.comment : "";
  if (!comment.trim()) return null;
  const rect = obj.rect as Record<string, unknown> | undefined;
  const viewport = obj.viewport as Record<string, unknown> | undefined;
  const attributes =
    obj.attributes && typeof obj.attributes === "object"
      ? (obj.attributes as Record<string, string>)
      : {};

  return {
    commentId,
    ref,
    tagName: typeof obj.tagName === "string" ? obj.tagName : "",
    text: typeof obj.text === "string" ? obj.text : "",
    attributes,
    rect: {
      x: Number(rect?.x ?? 0),
      y: Number(rect?.y ?? 0),
      width: Number(rect?.width ?? 0),
      height: Number(rect?.height ?? 0),
    },
    viewport: {
      width: Number(viewport?.width ?? 0),
      height: Number(viewport?.height ?? 0),
    },
    scrollX: Number(obj.scrollX ?? 0),
    scrollY: Number(obj.scrollY ?? 0),
    comment,
    pageUrl: typeof obj.pageUrl === "string" ? obj.pageUrl : undefined,
    screenshotDataUrl:
      typeof obj.screenshotDataUrl === "string"
        ? obj.screenshotDataUrl
        : undefined,
  };
}

// ---------------------------------------------------------------------------
// Bridge script (injected into the page's isolated world)
// ---------------------------------------------------------------------------

export const EMBEDDED_COMMENT_BRIDGE_SCRIPT = [
  "(function() {",
  '  "use strict";',
  `  var CONTROL_NAME = ${JSON.stringify(EMBEDDED_COMMENT_CONTROL_NAME)};`,
  `  var BINDING_NAME = ${JSON.stringify(EMBEDDED_COMMENT_BINDING_NAME)};`,
  "  var enabled = false;",
  '  var selectionMode = "dom_node";',
  '  var theme = "system";',
  '  var placeholder = "添加评论...";',
  "  var comments = [];",
  "  var nextCommentId = 1;",
  "  var hoverOverlay = null;",
  "  var activePopup = null;",
  "  var styleEl = null;",
  "",
  "  function sendToMain(message) {",
  "    try {",
  "      var json = JSON.stringify(message);",
  '      if (typeof globalThis[BINDING_NAME] === "function") {',
  "        globalThis[BINDING_NAME](json);",
  "      }",
  "    } catch (e) { }",
  "  }",
  "",
  "  function injectStyles() {",
  "    if (styleEl) return;",
  '    styleEl = document.createElement("style");',
  "    styleEl.textContent = [",
  '      ".ec-hover-overlay,.ec-selection-outline{position:fixed;outline:2px solid #1683ff;outline-offset:2px;background:rgba(22,131,255,0.06);pointer-events:none;z-index:2147483646}",',
  '      ".ec-selection-outline{background:rgba(22,131,255,0.03)}",',
  '      ".ec-comment-marker{position:fixed;z-index:2147483647;background:#1683ff;color:#fff;border:2px solid rgba(255,255,255,0.96);border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;font-family:system-ui,sans-serif;pointer-events:auto;cursor:pointer;box-shadow:0 2px 8px rgba(0,68,150,0.35);transition:transform 0.1s}",',
  '      ".ec-comment-marker:hover{transform:scale(1.15)}",',
  '      ".ec-popup{position:fixed;z-index:2147483647;display:flex;align-items:center;width:min(320px,calc(100vw - 24px));height:38px;gap:7px;padding:0 5px 0 10px;border:1px solid rgba(255,255,255,0.14);border-radius:20px;background:rgba(42,42,45,0.97);box-shadow:0 8px 24px rgba(0,0,0,0.38);font-family:system-ui,sans-serif}",',
  '      ".ec-popup-target{width:15px;height:15px;flex:0 0 auto;border:1.5px solid #a6a6ad;border-radius:50%;box-sizing:border-box;position:relative}",',
  "      \".ec-popup-target:after{content:'';position:absolute;inset:3px;border-radius:50%;border:1px solid #a6a6ad}\",",
  '      ".ec-comment-input{min-width:0;flex:1;border:0;outline:0;background:transparent;color:#f7f7f8;font:13px system-ui,sans-serif}",',
  '      ".ec-comment-input::placeholder{color:#96969d}",',
  '      ".ec-popup-send{position:relative;display:grid;width:28px;height:28px;flex:0 0 auto;place-items:center;border:0;border-radius:50%;background:#8b8b91;cursor:pointer}",',
  "      \".ec-popup-send:after{content:'';width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:7px solid #262629;transform:translateY(-1px)}\",",
  '      ".ec-popup-send:hover{background:#1683ff}",',
  '      ".ec-popup-cancel{display:none}",',
  '      ".ec-element-tag{display:none}",',
  '      "@media (prefers-color-scheme: light){.ec-popup{border-color:#d7d7dc;background:#fff}.ec-comment-input{color:#202025}.ec-popup-target,.ec-popup-target:after{border-color:#73737a}.ec-popup-send:after{border-bottom-color:#fff}}"',
  '    ].join("\\n");',
  "    (document.head || document.documentElement).appendChild(styleEl);",
  "  }",
  "",
  "  function removeStyles() {",
  "    if (styleEl) { styleEl.remove(); styleEl = null; }",
  "  }",
  "",
  "  function getCssSelector(el) {",
  '    if (!(el instanceof Element)) return "";',
  '    if (el.id) return "#" + CSS.escape(el.id);',
  "    var parts = [];",
  "    var cur = el;",
  "    while (cur && cur.nodeType === 1 && cur !== document.documentElement) {",
  "      var part = cur.tagName.toLowerCase();",
  '      if (cur.id) { parts.unshift("#" + CSS.escape(cur.id)); break; }',
  "      var parent = cur.parentElement;",
  "      if (parent) {",
  "        var siblings = Array.prototype.filter.call(parent.children, function(c) { return c.tagName === cur.tagName; });",
  "        if (siblings.length > 1) {",
  "          var idx = Array.prototype.indexOf.call(siblings, cur) + 1;",
  '          part += ":nth-of-type(" + idx + ")";',
  "        }",
  "      }",
  "      parts.unshift(part);",
  "      cur = cur.parentElement;",
  "    }",
  '    return parts.join(" > ");',
  "  }",
  "",
  "  function getElementInfo(el) {",
  "    var rect = el.getBoundingClientRect();",
  "    var attrs = {};",
  '    var namedProps = ["id","class","role","name","type","href","src","data-testid","aria-label","placeholder","value"];',
  "    for (var i = 0; i < namedProps.length; i++) {",
  "      var key = namedProps[i];",
  "      var val = el.getAttribute(key);",
  "      if (val !== null) attrs[key] = val;",
  "    }",
  '    if (!attrs.id) attrs.id = el.id || "";',
  '    if (!attrs.class) attrs.class = typeof el.className === "string" ? el.className : "";',
  '    var text = (el.innerText || el.textContent || "").trim().slice(0, 200);',
  "    return {",
  "      ref: getCssSelector(el),",
  "      tagName: el.tagName.toLowerCase(),",
  "      text: text,",
  "      attributes: attrs,",
  "      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },",
  "      viewport: { width: window.innerWidth, height: window.innerHeight },",
  "      scrollX: window.scrollX,",
  "      scrollY: window.scrollY",
  "    };",
  "  }",
  "",
  "  function showHoverOverlay(el) {",
  "    if (!enabled) return;",
  "    var rect = el.getBoundingClientRect();",
  "    if (!hoverOverlay) {",
  '      hoverOverlay = document.createElement("div");',
  '      hoverOverlay.className = "ec-hover-overlay";',
  "      (document.body || document.documentElement).appendChild(hoverOverlay);",
  "    }",
  '    hoverOverlay.style.display = "block";',
  '    hoverOverlay.style.left = rect.x + "px";',
  '    hoverOverlay.style.top = rect.y + "px";',
  '    hoverOverlay.style.width = rect.width + "px";',
  '    hoverOverlay.style.height = rect.height + "px";',
  "  }",
  "",
  "  function hideHoverOverlay() {",
  '    if (hoverOverlay) hoverOverlay.style.display = "none";',
  "  }",
  "",
  "  function onMouseMove(e) {",
  "    if (!enabled) return;",
  "    if (activePopup) return;",
  "    var el = e.target;",
  "    if (!el || el === document.body || el === document.documentElement) { hideHoverOverlay(); return; }",
  '    if (el.closest(".ec-popup") || el.closest(".ec-comment-marker") || el.closest(".ec-hover-overlay")) { hideHoverOverlay(); return; }',
  "    showHoverOverlay(el);",
  "  }",
  "",
  "  function onMouseDown(e) {",
  "    if (!enabled) return;",
  "    if (activePopup) {",
  "      if (!activePopup.contains(e.target)) { closePopup(); }",
  "      return;",
  "    }",
  "    var el = e.target;",
  '    if (!el || el.closest(".ec-popup") || el.closest(".ec-comment-marker")) return;',
  "    e.preventDefault(); e.stopPropagation();",
  "    hideHoverOverlay();",
  "    showCommentPopup(el);",
  "  }",
  "",
  "  function onKeyDown(e) {",
  '    if (e.key === "Escape" && activePopup) { closePopup(); }',
  "  }",
  "",
  "  function showCommentPopup(el) {",
  "    closePopup();",
  "    var info = getElementInfo(el);",
  '    var wrapper = document.createElement("div");',
  '    wrapper.className = "ec-popup-wrapper";',
  '    var selection = document.createElement("div");',
  '    selection.className = "ec-selection-outline";',
  '    selection.style.left = info.rect.x + "px";',
  '    selection.style.top = info.rect.y + "px";',
  '    selection.style.width = info.rect.width + "px";',
  '    selection.style.height = info.rect.height + "px";',
  "    wrapper.appendChild(selection);",
  '    var popup = document.createElement("div");',
  '    popup.className = "ec-popup";',
  "",
  '    var targetGlyph = document.createElement("span");',
  '    targetGlyph.className = "ec-popup-target";',
  '    targetGlyph.title = info.tagName + (info.attributes.id ? "#" + info.attributes.id : "");',
  "    popup.appendChild(targetGlyph);",
  "",
  '    var input = document.createElement("input");',
  '    input.className = "ec-comment-input";',
  '    input.type = "text";',
  '    input.placeholder = placeholder || "添加评论...";',
  '    input.setAttribute("aria-label", "添加批注");',
  "    popup.appendChild(input);",
  "",
  '    var sendBtn = document.createElement("button");',
  '    sendBtn.className = "ec-popup-send";',
  '    sendBtn.type = "button";',
  '    sendBtn.title = "保存批注";',
  '    sendBtn.setAttribute("aria-label", "保存批注");',
  "    sendBtn.onclick = function() {",
  "      var comment = input.value.trim();",
  "      if (!comment) { input.focus(); return; }",
  "      var commentId = nextCommentId++;",
  "      var payload = Object.assign({ commentId: commentId, comment: comment }, info);",
  '      sendToMain({ type: "comment-added", payload: payload });',
  "      addCommentMarker(commentId, info.rect, info.ref);",
  "      closePopup();",
  "    };",
  "    popup.appendChild(sendBtn);",
  '    input.onkeydown = function(event) { if (event.key === "Enter") { event.preventDefault(); sendBtn.click(); } };',
  "",
  "    var rect = info.rect;",
  "    var popupX = rect.x + rect.width + 8;",
  "    var popupY = rect.y;",
  "    var popupW = 320, popupH = 38;",
  "    if (popupX + popupW > window.innerWidth) popupX = rect.x - popupW - 8;",
  "    if (popupX < 0) popupX = 8;",
  "    if (popupY + popupH > window.innerHeight) popupY = window.innerHeight - popupH - 8;",
  "    if (popupY < 0) popupY = 8;",
  '    popup.style.left = popupX + "px";',
  '    popup.style.top = popupY + "px";',
  "",
  "    wrapper.appendChild(popup);",
  "    (document.body || document.documentElement).appendChild(wrapper);",
  "    activePopup = wrapper;",
  "    setTimeout(function() { input.focus(); }, 0);",
  "  }",
  "",
  "  function closePopup() {",
  "    if (activePopup) { activePopup.remove(); activePopup = null; }",
  "  }",
  "",
  "  function addCommentMarker(commentId, rect, ref) {",
  '    var marker = document.createElement("div");',
  '    marker.className = "ec-comment-marker";',
  "    marker.textContent = String(commentId);",
  "    marker.dataset.commentId = String(commentId);",
  "    marker.dataset.ref = ref;",
  '    marker.style.left = (rect.x + rect.width - 26) + "px";',
  '    marker.style.top = (rect.y - 4) + "px";',
  '    marker.title = "点击删除注释 #" + commentId;',
  "    marker.onclick = function(e) { e.stopPropagation(); e.preventDefault(); removeComment(commentId); };",
  "    (document.body || document.documentElement).appendChild(marker);",
  "    comments.push({ commentId: commentId, ref: ref, marker: marker, rect: rect });",
  "  }",
  "",
  "  function removeComment(commentId) {",
  "    var idx = comments.findIndex(function(c) { return c.commentId === commentId; });",
  "    if (idx < 0) return;",
  "    var entry = comments[idx];",
  "    entry.marker.remove();",
  "    comments.splice(idx, 1);",
  '    sendToMain({ type: "comment-removed", payload: { commentId: commentId } });',
  "    renumberMarkers();",
  "  }",
  "",
  "  function renumberMarkers() {",
  "    var map = [];",
  "    for (var i = 0; i < comments.length; i++) {",
  "      comments[i].marker.textContent = String(i + 1);",
  "      comments[i].commentId = i + 1;",
  "      comments[i].marker.dataset.commentId = String(i + 1);",
  "      map.push({ commentId: i + 1, ref: comments[i].ref });",
  "    }",
  "    nextCommentId = comments.length + 1;",
  '    if (map.length > 0) { sendToMain({ type: "comments-renumbered", payload: { comments: map } }); }',
  "  }",
  "",
  "  function clearAllComments() {",
  "    for (var i = 0; i < comments.length; i++) { comments[i].marker.remove(); }",
  "    comments = [];",
  "    nextCommentId = 1;",
  "  }",
  "",
  "  function enable() {",
  "    if (enabled) return;",
  "    enabled = true;",
  "    injectStyles();",
  '    document.addEventListener("mousemove", onMouseMove, true);',
  '    document.addEventListener("mousedown", onMouseDown, true);',
  '    document.addEventListener("keydown", onKeyDown, true);',
  '    sendToMain({ type: "ready" });',
  "  }",
  "",
  "  function disable() {",
  "    enabled = false;",
  "    closePopup();",
  "    hideHoverOverlay();",
  "    clearAllComments();",
  '    document.removeEventListener("mousemove", onMouseMove, true);',
  '    document.removeEventListener("mousedown", onMouseDown, true);',
  '    document.removeEventListener("keydown", onKeyDown, true);',
  "    removeStyles();",
  "  }",
  "",
  "  globalThis[CONTROL_NAME] = function(message) {",
  "    try {",
  '      if (message.type === "set-enabled") {',
  '        selectionMode = message.selectionMode || "dom_node";',
  '        theme = message.theme || "system";',
  '        placeholder = message.placeholder || "添加评论...";',
  "        if (message.enabled) { enable(); } else { disable(); }",
  '      } else if (message.type === "clear-comments") {',
  "        clearAllComments();",
  "      }",
  "      return true;",
  "    } catch (e) {",
  '      sendToMain({ type: "diagnostic", payload: { error: String(e) } });',
  "      return false;",
  "    }",
  "  };",
  "",
  '  sendToMain({ type: "ready" });',
  "})();",
  "",
].join("\n");
