import { EventEmitter } from "node:events";
import type { WebContents } from "electron";
import type { AgentSettings } from "@shared/types";
import { browserViewManager } from "./browser-view-manager";
import { logInfo, logWarn } from "../core/logging/app-logger";
import {
  EMBEDDED_COMMENT_BRIDGE_SCRIPT,
  EMBEDDED_COMMENT_CONTROL_NAME,
  EMBEDDED_COMMENT_BINDING_NAME,
  EMBEDDED_COMMENT_WORLD_ID,
  normalizeCommentBridgeMessage,
  type CommentPayload,
  type CommentBridgeMessage,
} from "./embedded-comment-bridge";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Raw AX node as returned by CDP Accessibility.getFullAXTree */
interface RawAXNode {
  nodeId: string;
  backendDOMNodeId?: number;
  parentId?: string;
  childIds?: string[];
  role?: { value: string };
  name?: { value: string };
  value?: { value: string | boolean | number };
  properties?: Array<{ name: string; value: { value: unknown } }>;
  ignored?: boolean;
}

/** Interactive element extracted from the AX tree, with a stable index. */
interface IndexedElement {
  index: number;
  role: string;
  name: string;
  value?: string;
  backendDOMNodeId: number;
  checked?: boolean;
  disabled?: boolean;
  expanded?: boolean;
  focused?: boolean;
  required?: boolean;
  placeholder?: string;
  description?: string;
  level?: number;
}

/** Browser event for the cursor-based pull model. */
export interface BrowserEvent {
  sequence: number;
  type: string;
  data: unknown;
  timestamp: number;
}

interface PageCdpState {
  pageId: string;
  threadId?: string;
  url: string;
  title: string;
  createdAt: number;
  lastActivityAt: number;
  axEnabled: boolean;
  lastIndexedElements: IndexedElement[];
  events: BrowserEvent[];
  sideEffects: string[];
  idleTimer?: ReturnType<typeof setTimeout>;
  commentModeEnabled?: boolean;
  commentModeOptions?: CommentModeOptions;
  commentEvents?: CommentEventEntry[];
  nextCommentEventId?: number;
  commentBridgeInstalled?: boolean;
}

type SecurityRulesGetter = () => AgentSettings["securityRules"] | undefined;

export interface CommentEventEntry {
  eventId: number;
  type: "comment-added" | "comment-removed" | "comments-renumbered";
  pageId: string;
  commentId?: number;
  pageUrl?: string;
  payload?:
    | CommentPayload
    | { commentId: number }
    | { comments: Array<{ commentId: number; ref: string }> };
  screenshotDataUrl?: string;
  ts: number;
}

export interface CommentModeOptions {
  selectionMode?: string;
  theme?: string;
  palette?: string;
  placeholder?: string;
  clearComments?: boolean;
}

const PENDING_COMMENT_EVENT_LIMIT = 200;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** AX roles that the agent can interact with. */
const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "checkbox",
  "radio",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "tab",
  "combobox",
  "listbox",
  "option",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "treeitem",
  "togglebutton",
]);

const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_EVENTS_PER_PAGE = 200;
const CDP_VERSION = "1.3";

// ---------------------------------------------------------------------------
// CDP Browser Service
// ---------------------------------------------------------------------------

/**
 * CDP-based browser service that unifies the user-facing WebContentsView
 * with agent-driven operations via the Chrome DevTools Protocol.
 *
 * This replaces the former Playwright-based BrowserService. Instead of a
 * separate headless browser, the agent operates on the same WebContentsView
 * the user sees -- just like Codex's tab-claiming model.
 *
 * Architecture (inspired by Codex, not copied):
 * - CDP Accessibility domain for semantic tree reading
 * - Custom JS formatter (~300 lines) instead of a 4MB WASM
 * - Diff-based state updates (only return what changed)
 * - Pointer-event interaction via Input.dispatchMouseEvent
 * - Cursor-based event queue (pull model)
 * - Side effects pushed with command responses
 */
class CdpBrowserServiceImpl extends EventEmitter {
  private states = new Map<string, PageCdpState>();
  private activePageByThread = new Map<string, string>();
  private getSecurityRules: SecurityRulesGetter = () => undefined;

  setSecurityRulesGetter(getter: SecurityRulesGetter): void {
    this.getSecurityRules = getter;
  }

  // ------------------------------------------------------------------
  // Page lifecycle
  // ------------------------------------------------------------------

  async newPage(url: string, threadId?: string): Promise<string> {
    const pageId = crypto.randomUUID();
    browserViewManager.createView(pageId, url || "about:blank", {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });

    const state: PageCdpState = {
      pageId,
      threadId,
      url: url || "about:blank",
      title: "",
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      axEnabled: false,
      lastIndexedElements: [],
      events: [],
      sideEffects: [],
    };
    this.states.set(pageId, state);

    if (threadId) {
      this.activePageByThread.set(threadId, pageId);
    }

    this.attachNavigationListener(pageId);
    logInfo("cdpBrowser.newPage", { pageId, url, threadId });
    return pageId;
  }

  async closePage(pageId: string): Promise<void> {
    const state = this.states.get(pageId);
    if (!state) return;

    await this.detachCDP(pageId);
    browserViewManager.destroyView(pageId);

    if (state.idleTimer) clearTimeout(state.idleTimer);
    this.states.delete(pageId);

    for (const [tid, pid] of this.activePageByThread) {
      if (pid === pageId) this.activePageByThread.delete(tid);
    }
    logInfo("cdpBrowser.closePage", { pageId });
  }

  async closeByThread(threadId: string): Promise<void> {
    const toClose: string[] = [];
    for (const [pid, state] of this.states) {
      if (state.threadId === threadId) toClose.push(pid);
    }
    await Promise.all(toClose.map((pid) => this.closePage(pid)));
    this.activePageByThread.delete(threadId);
  }

  clearByThread(threadId: string): Promise<void> {
    return this.closeByThread(threadId);
  }

  getActivePageId(threadId: string): string | undefined {
    return this.activePageByThread.get(threadId);
  }

  setActivePageId(threadId: string, pageId: string): void {
    this.activePageByThread.set(threadId, pageId);
  }

  listPages(threadId?: string): Array<{
    pageId: string;
    threadId?: string;
    url: string;
    title: string;
    createdAt: number;
    lastActivityAt: number;
  }> {
    const results: Array<{
      pageId: string;
      threadId?: string;
      url: string;
      title: string;
      createdAt: number;
      lastActivityAt: number;
    }> = [];
    for (const [pageId, state] of this.states) {
      if (threadId && state.threadId !== threadId) continue;
      results.push({
        pageId,
        threadId: state.threadId,
        url: state.url,
        title: state.title,
        createdAt: state.createdAt,
        lastActivityAt: state.lastActivityAt,
      });
    }
    return results;
  }

  // ------------------------------------------------------------------
  // Navigation
  // ------------------------------------------------------------------

  async navigate(pageId: string, url: string): Promise<void> {
    const state = this.states.get(pageId);
    if (!state) throw new Error(`Page ${pageId} not found.`);

    // Pre-navigation security check
    const blocked = this.checkUrlSecurity(url);
    if (blocked) {
      this.emit("navigation-blocked", pageId, url, blocked);
      throw new Error(
        `Navigation to ${url} blocked by security policy: ${blocked}`,
      );
    }

    browserViewManager.navigate(pageId, url);
    state.url = url;
    state.lastActivityAt = Date.now();
    this.resetIdleTimer(pageId);
  }

  // ------------------------------------------------------------------
  // Screenshot
  // ------------------------------------------------------------------

  async screenshot(pageId?: string): Promise<string> {
    const targetId = pageId ?? this.findAnyActivePage();
    if (!targetId) return "";
    return browserViewManager.capturePage(targetId);
  }

  // ------------------------------------------------------------------
  // AX tree reading -- the core of the Codex-aligned architecture
  // ------------------------------------------------------------------

  /**
   * Returns the full accessibility tree as indexed text.
   * Each interactive element gets a `[N]` index that can be used
   * with click/fill/scroll for interaction.
   */
  async getAXTree(pageId: string): Promise<string> {
    const wc = this.getWebContents(pageId);
    if (!wc) throw new Error(`Page ${pageId} not available.`);

    await this.ensureCDPAttached(pageId);
    await this.ensureAccessibilityEnabled(pageId);

    const response = (await wc.debugger.sendCommand(
      "Accessibility.getFullAXTree",
    )) as { nodes: RawAXNode[] };

    const indexed = this.extractInteractive(response.nodes);
    const state = this.states.get(pageId)!;
    state.lastIndexedElements = indexed;
    state.lastActivityAt = Date.now();

    return this.formatAXTree(indexed);
  }

  /**
   * Returns only the elements that changed since the last getAXTree call.
   * Mirrors Codex's diff-based approach: the agent gets a compact delta
   * instead of the full tree every time.
   */
  async getAXDiff(pageId: string): Promise<string> {
    const wc = this.getWebContents(pageId);
    if (!wc) throw new Error(`Page ${pageId} not available.`);

    await this.ensureCDPAttached(pageId);
    await this.ensureAccessibilityEnabled(pageId);

    const response = (await wc.debugger.sendCommand(
      "Accessibility.getFullAXTree",
    )) as { nodes: RawAXNode[] };

    const indexed = this.extractInteractive(response.nodes);
    const state = this.states.get(pageId)!;
    const previous = state.lastIndexedElements;
    state.lastIndexedElements = indexed;
    state.lastActivityAt = Date.now();

    return this.computeDiff(previous, indexed);
  }

  // ------------------------------------------------------------------
  // Interaction -- pointer events via CDP Input domain
  // ------------------------------------------------------------------

  async clickByIndex(pageId: string, index: number): Promise<void> {
    const state = this.states.get(pageId);
    if (!state) throw new Error(`Page ${pageId} not found.`);

    const el = state.lastIndexedElements.find((e) => e.index === index);
    if (!el) throw new Error(`Index ${index} not found. Call get_state first.`);

    const wc = this.getWebContents(pageId);
    if (!wc) throw new Error(`Page ${pageId} not available.`);

    // Stale detection: verify the DOM node still exists
    await this.verifyNotStale(wc, el.backendDOMNodeId);

    const box = await this.getBoxModel(wc, el.backendDOMNodeId);
    if (!box) throw new Error(`Element [${index}] has no bounding box.`);

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // Hit target check: verify the element is actually at the click point
    await this.verifyHitTarget(wc, cx, cy, el.backendDOMNodeId);

    // Dispatch pointer events (framework-compatible: React/Vue/Svelte all
    // listen to pointerdown/mousedown, not just click)
    await this.dispatchClick(wc, cx, cy);

    state.lastActivityAt = Date.now();
    state.sideEffects.push(`clicked [${index}] ${el.role} "${el.name}"`);
    this.pushEvent(pageId, "click", { index, role: el.role, name: el.name });
  }

  async fillByIndex(
    pageId: string,
    index: number,
    value: string,
  ): Promise<void> {
    const state = this.states.get(pageId);
    if (!state) throw new Error(`Page ${pageId} not found.`);

    const el = state.lastIndexedElements.find((e) => e.index === index);
    if (!el) throw new Error(`Index ${index} not found. Call get_state first.`);

    const wc = this.getWebContents(pageId);
    if (!wc) throw new Error(`Page ${pageId} not available.`);

    await this.verifyNotStale(wc, el.backendDOMNodeId);

    // Focus the element via CDP, then insert text
    await wc.debugger.sendCommand("DOM.focus", {
      backendNodeId: el.backendDOMNodeId,
    });

    // Clear existing value (Ctrl+A then Backspace)
    await wc.debugger.sendCommand("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "a",
      code: "KeyA",
      modifiers: 2,
    });
    await wc.debugger.sendCommand("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "a",
      code: "KeyA",
      modifiers: 0,
    });
    await wc.debugger.sendCommand("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Backspace",
      code: "Backspace",
    });
    await wc.debugger.sendCommand("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Backspace",
      code: "Backspace",
    });

    // Insert new text
    await wc.debugger.sendCommand("Input.insertText", { text: value });

    state.lastActivityAt = Date.now();
    state.sideEffects.push(
      `filled [${index}] ${el.role} "${el.name}" with "${value}"`,
    );
    this.pushEvent(pageId, "fill", {
      index,
      role: el.role,
      name: el.name,
      value,
    });
  }

  async scroll(
    pageId: string,
    direction: "up" | "down" | "left" | "right",
    pages = 1,
  ): Promise<void> {
    const wc = this.getWebContents(pageId);
    if (!wc) throw new Error(`Page ${pageId} not available.`);
    await this.ensureCDPAttached(pageId);

    const deltaY =
      direction === "down"
        ? pages * 600
        : direction === "up"
          ? -pages * 600
          : 0;
    const deltaX =
      direction === "right"
        ? pages * 600
        : direction === "left"
          ? -pages * 600
          : 0;

    await wc.debugger.sendCommand("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: 100,
      y: 100,
      deltaX,
      deltaY,
      modifiers: 0,
      timestamp: Date.now(),
    });

    const state = this.states.get(pageId);
    if (state) {
      state.lastActivityAt = Date.now();
      state.sideEffects.push(`scrolled ${direction} ${pages} page(s)`);
      this.pushEvent(pageId, "scroll", { direction, pages });
    }
  }

  // ------------------------------------------------------------------
  // Event queue -- cursor-based pull model (like Codex readEvents)
  // ------------------------------------------------------------------

  async pollEvents(
    pageId: string,
    afterSequence?: number,
    limit = 50,
  ): Promise<{
    events: BrowserEvent[];
    cursor: number;
    hasMore: boolean;
  }> {
    const state = this.states.get(pageId);
    if (!state) return { events: [], cursor: 0, hasMore: false };

    const after = afterSequence ?? 0;
    const newEvents = state.events.filter((e) => e.sequence > after);
    const sliced = newEvents.slice(0, limit);

    return {
      events: sliced,
      cursor: sliced.length > 0 ? sliced[sliced.length - 1].sequence : after,
      hasMore: newEvents.length > limit,
    };
  }

  // ------------------------------------------------------------------
  // Side effects -- consumed after each agent command
  // ------------------------------------------------------------------

  consumeSideEffects(pageId: string): string[] {
    const state = this.states.get(pageId);
    if (!state) return [];
    const effects = state.sideEffects;
    state.sideEffects = [];
    return effects;
  }

  // ------------------------------------------------------------------
  // Private: CDP session management
  // ------------------------------------------------------------------

  private getWebContents(pageId: string): WebContents | undefined {
    return browserViewManager.getWebContents(pageId);
  }

  private async ensureCDPAttached(pageId: string): Promise<void> {
    const wc = this.getWebContents(pageId);
    if (!wc) throw new Error(`Page ${pageId} not available.`);
    if (wc.debugger.isAttached()) return;

    try {
      wc.debugger.attach(CDP_VERSION);
      wc.debugger.on(
        "message",
        (_event: unknown, method: string, params: unknown) => {
          this.handleCDPMessage(pageId, method, params);
        },
      );
      wc.debugger.on("detach", () => {
        const state = this.states.get(pageId);
        if (state) state.axEnabled = false;
      });
      await wc.debugger.sendCommand("Runtime.enable");
    } catch (err) {
      if (!wc.debugger.isAttached()) {
        throw new Error(`Failed to attach CDP debugger: ${String(err)}`, {
          cause: err,
        });
      }
    }
  }

  private async detachCDP(pageId: string): Promise<void> {
    const wc = this.getWebContents(pageId);
    if (!wc || !wc.debugger.isAttached()) return;
    try {
      wc.debugger.detach();
    } catch {
      // best-effort
    }
  }

  private async ensureAccessibilityEnabled(pageId: string): Promise<void> {
    const state = this.states.get(pageId);
    if (!state) return;
    if (state.axEnabled) return;

    const wc = this.getWebContents(pageId);
    if (!wc || !wc.debugger.isAttached()) return;

    await wc.debugger.sendCommand("Accessibility.enable");
    state.axEnabled = true;
  }

  // ------------------------------------------------------------------
  // Private: AX tree processing
  // ------------------------------------------------------------------

  private extractInteractive(nodes: RawAXNode[]): IndexedElement[] {
    const result: IndexedElement[] = [];
    let index = 0;

    for (const node of nodes) {
      if (node.ignored) continue;
      const role = node.role?.value ?? "";
      if (!INTERACTIVE_ROLES.has(role)) continue;
      if (!node.backendDOMNodeId) continue;

      const props = this.parseProperties(node.properties);

      result.push({
        index: index++,
        role,
        name: node.name?.value ?? "",
        value: node.value ? String(node.value.value) : undefined,
        backendDOMNodeId: node.backendDOMNodeId,
        checked: props.checked as boolean | undefined,
        disabled: props.disabled as boolean | undefined,
        expanded: props.expanded as boolean | undefined,
        focused: props.focused as boolean | undefined,
        required: props.required as boolean | undefined,
        placeholder: props.placeholder as string | undefined,
        description: props.description as string | undefined,
        level: props.level as number | undefined,
      });
    }

    return result;
  }

  private parseProperties(
    props?: Array<{ name: string; value: { value: unknown } }>,
  ): Record<string, unknown> {
    if (!props) return {};
    const result: Record<string, unknown> = {};
    for (const p of props) {
      result[p.name] = p.value.value;
    }
    return result;
  }

  private formatAXTree(elements: IndexedElement[]): string {
    if (elements.length === 0) return "(no interactive elements found)";

    const lines: string[] = [];
    for (const el of elements) {
      const parts: string[] = [`[${el.index}]`, el.role];
      if (el.name) parts.push(`"${el.name}"`);

      const annotations: string[] = [];
      if (el.value !== undefined) annotations.push(`value: "${el.value}"`);
      if (el.checked !== undefined)
        annotations.push(el.checked ? "checked" : "unchecked");
      if (el.disabled) annotations.push("disabled");
      if (el.required) annotations.push("required");
      if (el.focused) annotations.push("focused");
      if (el.expanded !== undefined)
        annotations.push(el.expanded ? "expanded" : "collapsed");
      if (el.placeholder) annotations.push(`placeholder: "${el.placeholder}"`);
      if (el.level !== undefined) annotations.push(`level ${el.level}`);

      if (annotations.length > 0) {
        parts.push(`(${annotations.join(", ")})`);
      }
      lines.push(parts.join(" "));
    }
    return lines.join("\n");
  }

  private computeDiff(
    previous: IndexedElement[],
    current: IndexedElement[],
  ): string {
    const prevMap = new Map(previous.map((e) => [e.backendDOMNodeId, e]));
    const currMap = new Map(current.map((e) => [e.backendDOMNodeId, e]));

    const added: string[] = [];
    const removed: string[] = [];
    const changed: string[] = [];

    for (const el of current) {
      const prev = prevMap.get(el.backendDOMNodeId);
      if (!prev) {
        added.push(`+ [${el.index}] ${el.role} "${el.name}"`);
      } else {
        const diffs: string[] = [];
        if (prev.value !== el.value) diffs.push(`value: "${el.value}"`);
        if (prev.checked !== el.checked)
          diffs.push(el.checked ? "checked" : "unchecked");
        if (prev.focused !== el.focused)
          diffs.push(el.focused ? "focused" : "unfocused");
        if (prev.expanded !== el.expanded)
          diffs.push(el.expanded ? "expanded" : "collapsed");
        if (diffs.length > 0) {
          changed.push(
            `~ [${el.index}] ${el.role} "${el.name}" -> ${diffs.join(", ")}`,
          );
        }
      }
    }

    for (const el of previous) {
      if (!currMap.has(el.backendDOMNodeId)) {
        removed.push(`- [${el.index}] ${el.role} "${el.name}"`);
      }
    }

    const parts: string[] = [];
    if (added.length > 0) parts.push("Added:\n" + added.join("\n"));
    if (removed.length > 0) parts.push("Removed:\n" + removed.join("\n"));
    if (changed.length > 0) parts.push("Changed:\n" + changed.join("\n"));

    return parts.length > 0 ? parts.join("\n\n") : "(no changes)";
  }

  // ------------------------------------------------------------------
  // Private: Interaction helpers
  // ------------------------------------------------------------------

  private async getBoxModel(
    wc: WebContents,
    backendNodeId: number,
  ): Promise<{ x: number; y: number; width: number; height: number } | null> {
    try {
      const result = (await wc.debugger.sendCommand("DOM.getBoxModel", {
        backendNodeId,
      })) as {
        model?: { content: number[] };
      };
      if (!result.model?.content || result.model.content.length < 4)
        return null;
      const xs = result.model.content.filter((_, i) => i % 2 === 0);
      const ys = result.model.content.filter((_, i) => i % 2 === 1);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...xs);
      const maxY = Math.max(...ys);
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    } catch {
      return null;
    }
  }

  private async verifyNotStale(
    wc: WebContents,
    backendNodeId: number,
  ): Promise<void> {
    try {
      await wc.debugger.sendCommand("DOM.resolveNode", { backendNodeId });
    } catch {
      throw new Error(
        "Element is stale (DOM node no longer exists). Call get_state to refresh.",
      );
    }
  }

  private async verifyHitTarget(
    wc: WebContents,
    x: number,
    y: number,
    expectedBackendNodeId: number,
  ): Promise<void> {
    try {
      const result = (await wc.debugger.sendCommand("DOM.getNodeForLocation", {
        x: Math.round(x),
        y: Math.round(y),
      })) as { backendNodeId?: number };

      if (result.backendNodeId === expectedBackendNodeId) return;

      if (result.backendNodeId !== undefined) {
        logWarn("cdpBrowser.hitTargetMismatch", {
          expected: expectedBackendNodeId,
          hit: result.backendNodeId,
          x,
          y,
        });
      }
    } catch {
      // getNodeForLocation might fail if DOM domain not enabled -- non-fatal
    }
  }

  private async dispatchClick(
    wc: WebContents,
    x: number,
    y: number,
  ): Promise<void> {
    const ts = Date.now();
    await wc.debugger.sendCommand("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y,
      timestamp: ts,
    });
    await wc.debugger.sendCommand("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      buttons: 1,
      clickCount: 1,
      timestamp: ts,
    });
    await wc.debugger.sendCommand("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      buttons: 0,
      clickCount: 1,
      timestamp: ts + 1,
    });
  }

  // ------------------------------------------------------------------
  // Private: Events and side effects
  // ------------------------------------------------------------------

  private pushEvent(pageId: string, type: string, data: unknown): void {
    const state = this.states.get(pageId);
    if (!state) return;
    const seq =
      state.events.length > 0
        ? state.events[state.events.length - 1].sequence + 1
        : 1;
    state.events.push({ sequence: seq, type, data, timestamp: Date.now() });
    if (state.events.length > MAX_EVENTS_PER_PAGE) {
      state.events = state.events.slice(-MAX_EVENTS_PER_PAGE);
    }
    this.emit("browser-event", pageId, type, data);
  }

  private handleCDPMessage(
    pageId: string,
    method: string,
    params: unknown,
  ): void {
    if (method.startsWith("Page.")) {
      this.pushEvent(pageId, method, params);
    }
    if (method === "Page.frameNavigated") {
      const nav = params as { frame?: { parentId?: string } };
      // Top-level navigation invalidates the injected bridge script.
      if (!nav?.frame?.parentId) {
        const state = this.states.get(pageId);
        if (state) state.commentBridgeInstalled = false;
      }
    }
    if (method === "Runtime.bindingCalled") {
      const p = params as { name?: string; payload?: string };
      if (
        p?.name === EMBEDDED_COMMENT_BINDING_NAME &&
        typeof p.payload === "string"
      ) {
        this.handleCommentBinding(pageId, p.payload);
      }
    }
  }

  // ------------------------------------------------------------------
  // Private: Security
  // ------------------------------------------------------------------

  private checkUrlSecurity(url: string): string | null {
    const rules = this.getSecurityRules();
    if (!rules) return null;

    let host: string;
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      return null;
    }

    if (rules.networkAccess === "deny") return "network access denied";

    const denied = this.matchesDomainList(host, rules.deniedDomains ?? []);
    if (denied) return `domain ${host} is denied`;

    const allowed = rules.allowedDomains ?? [];
    if (allowed.length > 0 && !this.matchesDomainList(host, allowed)) {
      return `domain ${host} is not in allowlist`;
    }

    return null;
  }

  private matchesDomainList(host: string, configured: string[]): boolean {
    const normalizedHost = host.toLowerCase().replace(/\.$/u, "");
    return configured.some((entry) => {
      const domain = entry
        .trim()
        .toLowerCase()
        .replace(/^\*\./u, "")
        .replace(/\.$/u, "");
      return (
        Boolean(domain) &&
        (normalizedHost === domain || normalizedHost.endsWith(`.${domain}`))
      );
    });
  }

  // ------------------------------------------------------------------
  // Private: Navigation listener
  // ------------------------------------------------------------------

  private attachNavigationListener(pageId: string): void {
    const wc = this.getWebContents(pageId);
    if (!wc) return;

    const onNavigate = (targetUrl: string) => {
      const state = this.states.get(pageId);
      if (!state) return;
      state.url = targetUrl;
      state.lastActivityAt = Date.now();
      this.pushEvent(pageId, "navigation", { url: targetUrl });
      this.emit("url-changed", state.threadId, pageId, targetUrl);

      const blocked = this.checkUrlSecurity(targetUrl);
      if (blocked) {
        this.emit("navigation-blocked", pageId, targetUrl, blocked);
      }
    };

    wc.on("did-navigate", (_e, targetUrl: string) => onNavigate(targetUrl));
    wc.on("did-navigate-in-page", (_e, targetUrl: string) =>
      onNavigate(targetUrl),
    );
    wc.on("page-title-updated", (_e, title: string) => {
      const state = this.states.get(pageId);
      if (state) state.title = title;
    });
  }

  // ------------------------------------------------------------------
  // Private: Idle timer
  // ------------------------------------------------------------------

  private resetIdleTimer(pageId: string): void {
    const state = this.states.get(pageId);
    if (!state) return;
    if (state.idleTimer) clearTimeout(state.idleTimer);
    state.idleTimer = setTimeout(() => {
      const idle = Date.now() - state.lastActivityAt;
      if (idle >= IDLE_TIMEOUT_MS) {
        logWarn("cdpBrowser.idleTimeout", { pageId, idleMs: idle });
        void this.closePage(pageId);
      }
    }, IDLE_TIMEOUT_MS);
  }

  private findAnyActivePage(): string | undefined {
    for (const pid of this.activePageByThread.values()) {
      if (this.states.has(pid)) return pid;
    }
    return this.states.keys().next().value;
  }

  // ------------------------------------------------------------------
  // Comment / annotation mode
  // ------------------------------------------------------------------

  async setCommentMode(
    pageId: string,
    enabled: boolean,
    options?: CommentModeOptions,
  ): Promise<{ success: boolean; pageId: string; annotationEnabled: boolean }> {
    const state = this.states.get(pageId);
    if (!state) return { success: false, pageId, annotationEnabled: false };
    const wc = this.getWebContents(pageId);
    if (!wc) return { success: false, pageId, annotationEnabled: false };

    await this.ensureCDPAttached(pageId);
    await this.installCommentBridge(pageId);

    if (options?.clearComments) {
      state.commentEvents = [];
      await this.postCommentBridgeMessage(pageId, { type: "clear-comments" });
    }

    const commentOptions = {
      selectionMode: options?.selectionMode ?? "dom_node",
      theme: options?.theme ?? "system",
      ...(options?.palette ? { palette: options.palette } : {}),
      ...(options?.placeholder ? { placeholder: options.placeholder } : {}),
    };
    const sent = await this.postCommentBridgeMessage(pageId, {
      type: "set-enabled",
      enabled,
      ...commentOptions,
    });
    if (!sent) {
      // Control function not found — the bridge may have been lost on
      // navigation. Reset the flag, re-install, then retry.
      state.commentBridgeInstalled = false;
      await this.installCommentBridge(pageId);
      await this.postCommentBridgeMessage(pageId, {
        type: "set-enabled",
        enabled,
        ...commentOptions,
      });
    }
    state.commentModeEnabled = enabled;
    state.commentModeOptions = commentOptions;

    return { success: true, pageId, annotationEnabled: enabled };
  }

  getCommentEvents(
    pageId: string,
    afterEventId: number,
  ): {
    commentEvents: CommentEventEntry[];
    maxCommentEventId: number;
    annotationEnabled: boolean;
  } {
    const state = this.states.get(pageId);
    if (!state)
      return {
        commentEvents: [],
        maxCommentEventId: 0,
        annotationEnabled: false,
      };
    const events = (state.commentEvents ?? []).filter(
      (e) => e.eventId > afterEventId,
    );
    const maxId = (state.commentEvents ?? []).reduce(
      (max, e) => Math.max(max, e.eventId),
      0,
    );
    return {
      commentEvents: events,
      maxCommentEventId: maxId,
      annotationEnabled: state.commentModeEnabled ?? false,
    };
  }

  ackCommentEvents(
    pageId: string,
    throughEventId: number,
  ): { success: boolean } {
    const state = this.states.get(pageId);
    if (!state) return { success: false };
    if (state.commentEvents && throughEventId > 0) {
      state.commentEvents = state.commentEvents.filter(
        (e) => e.eventId > throughEventId,
      );
    }
    return { success: true };
  }

  async clearComments(pageId: string): Promise<{ success: boolean }> {
    const state = this.states.get(pageId);
    if (!state) return { success: false };
    state.commentEvents = [];
    await this.postCommentBridgeMessage(pageId, { type: "clear-comments" });
    return { success: true };
  }

  isCommentModeEnabled(pageId: string): boolean {
    return this.states.get(pageId)?.commentModeEnabled ?? false;
  }

  private async installCommentBridge(pageId: string): Promise<void> {
    const state = this.states.get(pageId);
    if (!state) return;
    const wc = this.getWebContents(pageId);
    if (!wc || !wc.debugger.isAttached()) return;

    if (state.commentBridgeInstalled) return;

    try {
      await wc.debugger.sendCommand("Runtime.addBinding", {
        name: EMBEDDED_COMMENT_BINDING_NAME,
      });
      await wc.debugger.sendCommand("Page.addScriptToEvaluateOnNewDocument", {
        source: EMBEDDED_COMMENT_BRIDGE_SCRIPT,
      });
      // Also inject into the current page — addScriptToEvaluateOnNewDocument
      // only fires on future navigations, not the already-loaded document
      await wc.debugger.sendCommand("Runtime.evaluate", {
        expression: EMBEDDED_COMMENT_BRIDGE_SCRIPT,
      });
      await wc.debugger.sendCommand("Page.enable");
      state.commentBridgeInstalled = true;
      logInfo("cdpBrowser.commentBridge.installed", { pageId });
    } catch (err) {
      logWarn("cdpBrowser.commentBridge.installFailed", {
        pageId,
        error: String(err),
      });
    }
  }

  private async postCommentBridgeMessage(
    pageId: string,
    message: { type: string; [key: string]: unknown },
  ): Promise<boolean> {
    const wc = this.getWebContents(pageId);
    if (!wc || !wc.debugger.isAttached()) return false;
    const script = `(() => {
      const control = globalThis[${JSON.stringify(EMBEDDED_COMMENT_CONTROL_NAME)}];
      if (typeof control !== "function") return false;
      return control(${JSON.stringify(message)});
    })()`;
    try {
      const result = await wc.debugger.sendCommand("Runtime.evaluate", {
        expression: script,
        returnByValue: true,
      });
      return result?.result?.value === true;
    } catch {
      // bridge may not be ready yet
      return false;
    }
  }

  private async captureCommentPreview(
    pageId: string,
    payload: CommentPayload,
  ): Promise<string | undefined> {
    const margin = 14;
    const viewportWidth = Math.max(0, payload.viewport.width);
    const viewportHeight = Math.max(0, payload.viewport.height);
    if (
      !viewportWidth ||
      !viewportHeight ||
      !payload.rect.width ||
      !payload.rect.height
    ) {
      return undefined;
    }
    const x = Math.max(0, Math.floor(payload.rect.x - margin));
    const y = Math.max(0, Math.floor(payload.rect.y - margin));
    const right = Math.min(
      viewportWidth,
      Math.ceil(payload.rect.x + payload.rect.width + margin),
    );
    const bottom = Math.min(
      viewportHeight,
      Math.ceil(payload.rect.y + payload.rect.height + margin),
    );
    if (right <= x || bottom <= y) return undefined;
    try {
      return (
        (await browserViewManager.capturePageRegion(pageId, {
          x,
          y,
          width: right - x,
          height: bottom - y,
        })) || undefined
      );
    } catch (error) {
      logWarn("cdpBrowser.commentBridge.previewFailed", {
        pageId,
        error: String(error),
      });
      return undefined;
    }
  }

  private async handleCommentBridgeMessage(
    pageId: string,
    message: CommentBridgeMessage,
  ): Promise<void> {
    const state = this.states.get(pageId);
    if (!state) return;

    if (message.type === "ready") {
      logInfo("cdpBrowser.commentBridge.ready", { pageId });
      // Bridge re-initializes on every new document; re-activate if enabled
      if (state.commentModeEnabled) {
        void this.postCommentBridgeMessage(pageId, {
          type: "set-enabled",
          enabled: true,
          ...(state.commentModeOptions ?? {
            selectionMode: "dom_node",
            theme: "system",
          }),
        });
      }
      return;
    }

    if (message.type === "diagnostic") {
      logInfo("cdpBrowser.commentBridge.diagnostic", {
        pageId,
        payload: JSON.stringify(message.payload).slice(0, 200),
      });
      return;
    }

    const eventId = state.nextCommentEventId ?? 1;
    state.nextCommentEventId = eventId + 1;

    if (message.type === "comment-added") {
      const screenshotDataUrl = await this.captureCommentPreview(
        pageId,
        message.payload,
      );
      const payload = screenshotDataUrl
        ? { ...message.payload, screenshotDataUrl }
        : message.payload;
      const event: CommentEventEntry = {
        eventId,
        type: "comment-added",
        pageId,
        commentId: payload.commentId,
        pageUrl: state.url,
        payload,
        screenshotDataUrl,
        ts: Date.now(),
      };
      this.enqueueCommentEvent(pageId, event);
      this.emit("browser-event", pageId, "comment-added", payload);
      return;
    }

    if (message.type === "comment-removed") {
      const event: CommentEventEntry = {
        eventId,
        type: "comment-removed",
        pageId,
        commentId: message.payload.commentId,
        pageUrl: state.url,
        payload: message.payload,
        ts: Date.now(),
      };
      this.enqueueCommentEvent(pageId, event);
      this.emit("browser-event", pageId, "comment-removed", message.payload);
      return;
    }

    if (message.type === "comments-renumbered") {
      const event: CommentEventEntry = {
        eventId,
        type: "comments-renumbered",
        pageId,
        pageUrl: state.url,
        payload: message.payload,
        ts: Date.now(),
      };
      this.enqueueCommentEvent(pageId, event);
      return;
    }
  }

  private enqueueCommentEvent(pageId: string, event: CommentEventEntry): void {
    const state = this.states.get(pageId);
    if (!state) return;
    if (!state.commentEvents) state.commentEvents = [];
    if (state.commentEvents.length >= PENDING_COMMENT_EVENT_LIMIT) {
      logWarn("cdpBrowser.commentBridge.backpressure", {
        pageId,
        count: state.commentEvents.length,
      });
      state.commentEvents = state.commentEvents.slice(
        -Math.floor(PENDING_COMMENT_EVENT_LIMIT / 2),
      );
    }
    state.commentEvents.push(event);
    this.emit("comment-event", pageId, event);
  }

  private handleCommentBinding(pageId: string, payload: string): void {
    try {
      const envelope = JSON.parse(payload);
      const message = normalizeCommentBridgeMessage(envelope);
      if (message) {
        void this.handleCommentBridgeMessage(pageId, message);
      }
    } catch (err) {
      logWarn("cdpBrowser.commentBridge.parseFailed", {
        pageId,
        error: String(err),
      });
    }
  }
}

export const cdpBrowserService = new CdpBrowserServiceImpl();
