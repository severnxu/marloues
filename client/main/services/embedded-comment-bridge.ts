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
  /** Whether the annotation targets a DOM element or an arbitrary page area. */
  targetType?: "element" | "region";
  ref: string;
  tagName: string;
  text: string;
  attributes: Record<string, string>;
  rect: { x: number; y: number; width: number; height: number };
  viewport: { width: number; height: number };
  scrollX: number;
  scrollY: number;
  comment: string;
  /** Direct, user-authored style changes for an element annotation. */
  styleEdits?: Record<string, string>;
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
  const styleEdits =
    obj.styleEdits && typeof obj.styleEdits === "object"
      ? Object.fromEntries(
          Object.entries(obj.styleEdits as Record<string, unknown>).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : undefined;

  return {
    commentId,
    targetType: obj.targetType === "region" ? "region" : "element",
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
    styleEdits,
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
  "  var regionOverlay = null;",
  "  var dragStart = null;",
  "  var dragTarget = null;",
  "  var activePopup = null;",
  "  var activeDraft = null;",
  "  var interactionShield = null;",
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
  '      ".ec-interaction-shield{position:fixed;inset:0;z-index:2147483645;cursor:crosshair;background:transparent;touch-action:none}",',
  '      ".ec-hover-overlay,.ec-selection-outline,.ec-region-selection{position:fixed;outline:2px solid #1683ff;outline-offset:2px;background:rgba(22,131,255,0.06);pointer-events:none;z-index:2147483646;box-sizing:border-box}",',
  '      ".ec-selection-outline{background:rgba(22,131,255,0.03)}",',
  '      ".ec-region-selection{outline-style:dashed;background:rgba(22,131,255,0.12)}",',
  '      ".ec-comment-marker{position:fixed;z-index:2147483647;background:#1683ff;color:#fff;border:2px solid rgba(255,255,255,0.96);border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;font-family:system-ui,sans-serif;pointer-events:auto;cursor:pointer;box-shadow:0 2px 8px rgba(0,68,150,0.35);transition:transform 0.1s}",',
  '      ".ec-comment-marker:hover{transform:scale(1.15)}",',
  '      ".ec-popup{position:fixed;z-index:2147483647;display:flex;align-items:flex-start;width:min(360px,calc(100vw - 24px));min-height:38px;gap:7px;padding:8px 8px 8px 10px;border:1px solid rgba(255,255,255,0.14);border-radius:12px;background:rgba(42,42,45,0.97);box-shadow:0 8px 24px rgba(0,0,0,0.38);font-family:system-ui,sans-serif}",',
  '      ".ec-popup-target{width:15px;height:15px;flex:0 0 auto;margin-top:11px;border:1.5px solid #a6a6ad;border-radius:50%;box-sizing:border-box;position:relative}",',
  "      \".ec-popup-target:after{content:'';position:absolute;inset:3px;border-radius:50%;border:1px solid #a6a6ad}\",",
  '      ".ec-popup-target-label{position:absolute;top:-22px;left:0;max-width:132px;overflow:hidden;color:#c7c7cd;font:11px ui-monospace,SFMono-Regular,Menlo,monospace;text-overflow:ellipsis;white-space:nowrap;pointer-events:none}",',
  '      ".ec-comment-input{min-width:0;flex:1;border:0;outline:0;background:transparent;color:#f7f7f8;font:13px system-ui,sans-serif}",',
  '      ".ec-comment-input::placeholder{color:#96969d}",',
  '      ".ec-popup-send{position:relative;display:grid;width:28px;height:28px;flex:0 0 auto;place-items:center;border:0;border-radius:50%;background:#8b8b91;cursor:pointer}",',
  "      \".ec-popup-send:after{content:'';width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:7px solid #262629;transform:translateY(-1px)}\",",
  '      ".ec-popup-send:hover{background:#1683ff}",',
  '      ".ec-popup-body{display:grid;width:100%;gap:9px;padding:8px 0 8px}",',
  '      ".ec-popup-comment-row{display:flex;align-items:center;gap:7px}",',
  '      ".ec-style-editor{display:grid;gap:6px;padding:7px 5px 0;border-top:1px solid rgba(255,255,255,0.1)}",',
  '      ".ec-style-row{display:grid;grid-template-columns:76px minmax(0,1fr);align-items:center;gap:7px;color:#b6b6bd;font:12px system-ui,sans-serif}",',
  '      ".ec-style-input{min-width:0;height:27px;border:1px solid rgba(255,255,255,0.18);border-radius:7px;padding:0 8px;background:#2c2c30;color:#f7f7f8;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;outline:0}",',
  '      ".ec-style-input:focus{border-color:#1683ff;box-shadow:0 0 0 2px rgba(22,131,255,0.22)}",',
  '      ".ec-popup-cancel{display:grid;width:28px;height:28px;flex:0 0 auto;place-items:center;border:0;border-radius:50%;background:transparent;color:#b6b6bd;cursor:pointer;font-size:14px}",',
  '      ".ec-popup-cancel:hover{background:rgba(255,255,255,0.1);color:#fff}",',
  '      ".ec-element-tag{display:none}",',
  '      "@media (prefers-color-scheme: light){.ec-popup{border-color:#d7d7dc;background:#fff}.ec-comment-input{color:#202025}.ec-popup-target,.ec-popup-target:after{border-color:#73737a}.ec-popup-target-label{color:#62626a}.ec-popup-send:after{border-bottom-color:#fff}.ec-style-editor{border-color:#e2e2e6}.ec-style-row{color:#62626a}.ec-style-input{border-color:#d7d7dc;background:#fafafa;color:#202025}}"',
  '    ].join("\\n");',
  "    (document.head || document.documentElement).appendChild(styleEl);",
  "  }",
  "",
  "  function removeStyles() {",
  "    if (styleEl) { styleEl.remove(); styleEl = null; }",
  "  }",
  "",
  "  function underlyingElementAt(x, y) {",
  "    if (!interactionShield) return document.elementFromPoint(x, y);",
  '    interactionShield.style.pointerEvents = "none";',
  "    var el = document.elementFromPoint(x, y);",
  '    interactionShield.style.pointerEvents = "auto";',
  "    return el;",
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
  '      targetType: "element",',
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
  "  function getRegionInfo(rect) {",
  "    var x = Math.max(0, Math.round(rect.x));",
  "    var y = Math.max(0, Math.round(rect.y));",
  "    var width = Math.max(1, Math.round(rect.width));",
  "    var height = Math.max(1, Math.round(rect.height));",
  '    var ref = "viewport region (" + x + ", " + y + ", " + width + " x " + height + ")";',
  "    return {",
  '      targetType: "region",',
  "      ref: ref,",
  '      tagName: "",',
  '      text: "Selected page area " + width + " x " + height,',
  "      attributes: {},",
  "      rect: { x: x, y: y, width: width, height: height },",
  "      viewport: { width: window.innerWidth, height: window.innerHeight },",
  "      scrollX: window.scrollX,",
  "      scrollY: window.scrollY",
  "    };",
  "  }",
  "",
  "  function normalizedDragRect(start, end) {",
  "    var left = Math.min(start.x, end.x);",
  "    var top = Math.min(start.y, end.y);",
  "    return { x: left, y: top, width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };",
  "  }",
  "",
  "  function showRegionOverlay(rect) {",
  "    if (!regionOverlay) {",
  '      regionOverlay = document.createElement("div");',
  '      regionOverlay.className = "ec-region-selection";',
  "      (document.body || document.documentElement).appendChild(regionOverlay);",
  "    }",
  '    regionOverlay.style.display = "block";',
  '    regionOverlay.style.left = rect.x + "px";',
  '    regionOverlay.style.top = rect.y + "px";',
  '    regionOverlay.style.width = rect.width + "px";',
  '    regionOverlay.style.height = rect.height + "px";',
  "  }",
  "",
  "  function hideRegionOverlay() {",
  '    if (regionOverlay) regionOverlay.style.display = "none";',
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
  "    if (dragStart) {",
  "      var dragRect = normalizedDragRect(dragStart, { x: e.clientX, y: e.clientY });",
  "      if (dragRect.width >= 6 || dragRect.height >= 6) showRegionOverlay(dragRect);",
  "      return;",
  "    }",
  "    if (activePopup) return;",
  '    if (selectionMode === "region") { hideHoverOverlay(); return; }',
  "    var el = underlyingElementAt(e.clientX, e.clientY);",
  "    if (!el || el === document.body || el === document.documentElement) { hideHoverOverlay(); return; }",
  '    if (el.closest(".ec-popup") || el.closest(".ec-comment-marker") || el.closest(".ec-hover-overlay")) { hideHoverOverlay(); return; }',
  "    showHoverOverlay(el);",
  "  }",
  "",
  "  function onMouseDown(e) {",
  "    if (!enabled) return;",
  "    if (activePopup) { closePopup(); return; }",
  "    var el = underlyingElementAt(e.clientX, e.clientY);",
  "    if (!el) return;",
  "    if (e.button !== 0) return;",
  "    e.preventDefault(); e.stopPropagation();",
  "    hideHoverOverlay();",
  "    dragStart = { x: e.clientX, y: e.clientY };",
  "    dragTarget = el;",
  "  }",
  "",
  "  function onMouseUp(e) {",
  "    if (!enabled || !dragStart) return;",
  "    e.preventDefault(); e.stopPropagation();",
  "    var start = dragStart;",
  "    var target = dragTarget;",
  "    dragStart = null;",
  "    dragTarget = null;",
  "    var rect = normalizedDragRect(start, { x: e.clientX, y: e.clientY });",
  "    var isRegion = rect.width >= 6 || rect.height >= 6;",
  "    hideRegionOverlay();",
  "    if (isRegion) {",
  "      showCommentPopup(getRegionInfo(rect));",
  '    } else if (selectionMode !== "region" && target) {',
  "      showCommentPopup(getElementInfo(target), target);",
  "    }",
  "  }",
  "",
  "  function onKeyDown(e) {",
  '    if (e.key === "Escape") {',
  "      if (dragStart) { dragStart = null; dragTarget = null; hideRegionOverlay(); }",
  "      if (activePopup) closePopup();",
  "    }",
  "  }",
  "",
  "  function showCommentPopup(info, targetElement) {",
  "    closePopup();",
  "    activeDraft = targetElement ? { element: targetElement, originalStyles: {}, edits: {} } : null;",
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
  '    targetGlyph.title = info.targetType === "region" ? "页面区域" : info.tagName + (info.attributes.id ? "#" + info.attributes.id : "");',
  "    popup.appendChild(targetGlyph);",
  '    var targetLabel = document.createElement("span");',
  '    targetLabel.className = "ec-popup-target-label";',
  '    targetLabel.textContent = info.targetType === "region" ? "页面区域" : (info.tagName || "页面元素");',
  "    targetGlyph.appendChild(targetLabel);",
  "",
  '    var body = document.createElement("div");',
  '    body.className = "ec-popup-body";',
  '    var commentRow = document.createElement("div");',
  '    commentRow.className = "ec-popup-comment-row";',
  '    var input = document.createElement("input");',
  '    input.className = "ec-comment-input";',
  '    input.type = "text";',
  '    input.placeholder = placeholder || "添加评论...";',
  '    input.setAttribute("aria-label", "添加批注");',
  "    commentRow.appendChild(input);",
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
  "      if (activeDraft && Object.keys(activeDraft.edits).length) payload.styleEdits = activeDraft.edits;",
  '      sendToMain({ type: "comment-added", payload: payload });',
  "      addCommentMarker(commentId, info.rect, info.ref);",
  "      closePopup(true);",
  "    };",
  "    commentRow.appendChild(sendBtn);",
  '    var cancelBtn = document.createElement("button");',
  '    cancelBtn.className = "ec-popup-cancel";',
  '    cancelBtn.type = "button";',
  '    cancelBtn.title = "取消批注";',
  '    cancelBtn.setAttribute("aria-label", "取消批注");',
  '    cancelBtn.textContent = "×";',
  "    cancelBtn.onclick = function() { closePopup(); };",
  "    commentRow.appendChild(cancelBtn);",
  "    body.appendChild(commentRow);",
  "    if (targetElement) body.appendChild(createStyleEditor(targetElement));",
  "    popup.appendChild(body);",
  '    input.onkeydown = function(event) { if (event.key === "Enter") { event.preventDefault(); sendBtn.click(); } };',
  "",
  "    var rect = info.rect;",
  "    var popupX = rect.x + rect.width + 8;",
  "    var popupY = rect.y;",
  "    var popupW = 360, popupH = targetElement ? 310 : 56;",
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
  "  function createStyleEditor(targetElement) {",
  '    var editor = document.createElement("div");',
  '    editor.className = "ec-style-editor";',
  "    var computed = window.getComputedStyle(targetElement);",
  '    var fields = [["color", "文本颜色"], ["backgroundColor", "背景"], ["opacity", "不透明度"], ["fontFamily", "字体"], ["fontSize", "字号"], ["fontWeight", "字重"]];',
  "    for (var i = 0; i < fields.length; i++) {",
  "      (function(property, label) {",
  '        var row = document.createElement("label");',
  '        row.className = "ec-style-row";',
  '        var name = document.createElement("span");',
  "        name.textContent = label;",
  '        var control = document.createElement("input");',
  '        control.className = "ec-style-input";',
  '        control.type = "text";',
  '        control.value = computed[property] || "";',
  '        control.setAttribute("aria-label", "编辑" + label);',
  "        control.oninput = function() {",
  "          if (!activeDraft) return;",
  "          if (!(property in activeDraft.originalStyles)) activeDraft.originalStyles[property] = targetElement.style[property];",
  "          var value = control.value.trim();",
  "          targetElement.style[property] = value;",
  "          if (value) activeDraft.edits[property] = value; else delete activeDraft.edits[property];",
  "        };",
  "        row.appendChild(name);",
  "        row.appendChild(control);",
  "        editor.appendChild(row);",
  "      })(fields[i][0], fields[i][1]);",
  "    }",
  "    return editor;",
  "  }",
  "",
  "  function closePopup(keepEdits) {",
  "    if (activeDraft && !keepEdits) {",
  "      var props = Object.keys(activeDraft.originalStyles);",
  "      for (var i = 0; i < props.length; i++) activeDraft.element.style[props[i]] = activeDraft.originalStyles[props[i]];",
  "    }",
  "    activeDraft = null;",
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
  '    interactionShield = document.createElement("div");',
  '    interactionShield.className = "ec-interaction-shield";',
  '    interactionShield.setAttribute("aria-hidden", "true");',
  '    interactionShield.addEventListener("mousemove", onMouseMove);',
  '    interactionShield.addEventListener("mousedown", onMouseDown);',
  '    interactionShield.addEventListener("mouseup", onMouseUp);',
  '    interactionShield.addEventListener("contextmenu", function(e) { e.preventDefault(); });',
  "    (document.body || document.documentElement).appendChild(interactionShield);",
  '    document.addEventListener("keydown", onKeyDown, true);',
  '    sendToMain({ type: "ready" });',
  "  }",
  "",
  "  function disable() {",
  "    enabled = false;",
  "    closePopup();",
  "    hideHoverOverlay();",
  "    hideRegionOverlay();",
  "    dragStart = null;",
  "    dragTarget = null;",
  "    if (interactionShield) { interactionShield.remove(); interactionShield = null; }",
  "    clearAllComments();",
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
