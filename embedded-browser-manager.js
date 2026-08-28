"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmbeddedBrowserManager = void 0;
exports.getEmbeddedBrowserManager = getEmbeddedBrowserManager;
exports.openEmbeddedBrowserExternally = openEmbeddedBrowserExternally;
const electron_1 = require("electron");
const config_1 = require("@mavis/config");
const controller_1 = require("./controller");
const background_browser_render_host_1 = require("./background-browser-render-host");
const embedded_browser_tool_runtime_1 = require("./embedded-browser-tool-runtime");
const embedded_comment_bridge_1 = require("./embedded-comment-bridge");
const embedded_browser_agent_cursor_1 = require("./embedded-browser-agent-cursor");
const manager_1 = require("../../windows/manager");
const mainWindow_1 = require("../../windows/mainWindow");
const logger_1 = require("../../utils/logger");
const open_external_target_1 = require("../../utils/open-external-target");
const persistent_browser_registry_1 = require("./persistent-browser-registry");
const embedded_browser_manager_helpers_1 = require("./embedded-browser-manager-helpers");
const embedded_browser_device_preview_1 = require("./embedded-browser-device-preview");
const embedded_browser_resource_diagnostics_1 = require("./embedded-browser-resource-diagnostics");
const embedded_browser_adaptive_budget_1 = require("./embedded-browser-adaptive-budget");
const embedded_browser_page_resume_1 = require("./embedded-browser-page-resume");
const embedded_browser_tab_metadata_1 = require("./embedded-browser-tab-metadata");
const logger = (0, logger_1.getCategoryLogger)('archon');
const browserInputDiagnosticLogger = (0, logger_1.getCategoryLogger)('archon', 'browser-input');
class BrowserCommentBackpressureError extends Error {
}
const MAX_IN_MEMORY_HISTORY_PAGE_STATE_BYTES = 4 * 1024 * 1024;
class EmbeddedBrowserManager {
    constructor(options = {}) {
        this.tabs = new Map();
        this.sessions = new Map();
        this.activeTabId = null;
        this.latestShowLayoutCommandId = 0;
        this.hostWindow = null;
        this.hostWebContentsId = null;
        this.hostZoomFactor = 1;
        this.hostWindowDisposers = [];
        this.lastGetStateDiagnosticKey = null;
        this.lastBoundsDiagnosticKey = null;
        this.lastNativeLayerDiagnosticKey = null;
        this.hiddenSweepTimer = null;
        this.destroyingTabIds = new Set();
        this.suspendingTabIds = new Set();
        this.coldResumeSnapshots = new Map();
        this.suspendedTabs = new Map();
        this.resumingTabs = new Map();
        this.nativeOverlayOcclusionLeases = new Set();
        this.nextTabId = 1;
        this.nextCommentEventId = 1;
        this.lastResourceDiagnosticPressure = 'normal';
        this.registry = options.registry ?? new persistent_browser_registry_1.PersistentBrowserRegistry();
        this.backgroundRenderHost = options.backgroundRenderHost ?? new background_browser_render_host_1.BackgroundBrowserRenderHost();
        this.isAgentCursorEnabled = options.isAgentCursorEnabled ?? (() => true);
        this.adaptiveBudget = options.adaptiveBudget ?? new embedded_browser_adaptive_budget_1.EmbeddedBrowserAdaptiveBudget();
        this.browserResourceDiagnostics = new embedded_browser_resource_diagnostics_1.EmbeddedBrowserResourceDiagnostics({
            getTabs: () => Array.from(this.tabs.values()).map((tab) => ({
                tabId: tab.tabId,
                sessionId: tab.sessionId,
                hidden: tab.hiddenAt !== null,
                operationCount: tab.operationCount ?? 0,
                webContents: this.getWebContents(tab),
            })),
            log: (snapshot) => browserInputDiagnosticLogger.info({
                msg: '[EmbeddedBrowserResource] sample',
                ...snapshot,
            }),
            // Full snapshots enumerate every Electron process and WebContents. Keep
            // the interval for unpackaged diagnostics only; packaged builds still
            // sample lifecycle events, crashes and memory-pressure transitions.
            periodicSamplingEnabled: !electron_1.app.isPackaged && embedded_browser_manager_helpers_1.ENABLE_BROWSER_INPUT_DIAGNOSTICS,
        });
        this.toolRuntime = new embedded_browser_tool_runtime_1.EmbeddedBrowserToolRuntime({
            requireBrowserTab: (target, runtimeOptions) => this.requireBrowserTab(target, runtimeOptions),
            resolveBrowserTab: (target, runtimeOptions) => this.resolveBrowserTab(target, runtimeOptions),
            goBack: (target, signal) => this.goBack(target, signal),
            goForward: (target, signal) => this.goForward(target, signal),
            reload: (target, signal) => this.reload(target, signal),
            withTabOperation: (tab, label, operation, runtimeOptions) => this.withTabOperation(tab, label, operation, runtimeOptions),
            refreshTabState: (tab) => this.refreshTabState(tab),
            getWebContents: (tab) => this.getWebContents(tab),
            captureTabScreenshot: (tab, params) => (0, embedded_browser_agent_cursor_1.captureTabScreenshotWithoutAgentCursor)(tab, params ?? {}, (target) => this.getWebContents(target)),
        });
    }
    async createOrShow(bounds, sessionId, options) {
        const normalizedSessionId = sessionId ?? null;
        const visible = options?.visible !== false;
        const revealAllowed = visible && !this.hasBlockingNativeOverlay();
        const existingSessionTab = this.resolveTabBySession(normalizedSessionId);
        const normalizedBounds = this.normalizeBounds(bounds, options?.viewport, options?.layoutContext);
        const initialUrl = (0, persistent_browser_registry_1.normalizePersistedBrowserUrl)(options?.initialUrl);
        // Page execution and FilePanel presentation are independent. Hidden
        // restoration is rendered through BackgroundBrowserRenderHost instead of
        // briefly attaching the tab to the user's foreground window. When another
        // tab is already visible, keep a cold target offscreen through its
        // presentation load and leave it non-selected until the staged handoff
        // commits both native visibility and routing state.
        const hasVisiblePredecessor = !existingSessionTab &&
            Array.from(this.tabs.values()).some((candidate) => candidate.hiddenAt == null && candidate.bounds.x >= 0 && candidate.bounds.y >= 0);
        const restoreBounds = revealAllowed && !hasVisiblePredecessor ? normalizedBounds : embedded_browser_manager_helpers_1.OFFSCREEN_BOUNDS;
        const tab = await this.ensureTabForSession(restoreBounds, normalizedSessionId, initialUrl && initialUrl !== 'about:blank' ? initialUrl : undefined, 'presentation', !hasVisiblePredecessor);
        const shouldShowNativeView = revealAllowed;
        if (shouldShowNativeView) {
            await this.backgroundRenderHost.claimForeground(tab.controller);
        }
        else {
            await this.backgroundRenderHost.waitForTarget(tab.controller);
        }
        if (shouldShowNativeView) {
            // Existing hidden tabs need to be attached before an explicit navigation;
            // newly restored tabs were already created with real viewport bounds.
            const committed = await this.showTabExclusive(tab, normalizedBounds);
            if (!committed && this.hasBlockingNativeOverlay()) {
                this.markTabSessionSelected(tab);
                return { ...this.tabSummary(tab), deferred: 'blocking-overlay' };
            }
        }
        else if (!existingSessionTab || existingSessionTab.tabId !== tab.tabId) {
            tab.controller.setBounds(embedded_browser_manager_helpers_1.OFFSCREEN_BOUNDS);
            tab.bounds = embedded_browser_manager_helpers_1.OFFSCREEN_BOUNDS;
            this.markTabHidden(tab);
        }
        if (initialUrl && initialUrl !== 'about:blank' && existingSessionTab?.tabId === tab.tabId) {
            // A newly restored tab already attempted the explicit entry URL inside
            // openTab. Existing tabs re-read it because the same URL can represent
            // updated local content, but a failed cold load must not be retried here.
            tab.lastLoadError = null;
            const result = await this.withTabOperation(tab, tab.url === initialUrl ? 'initial-reload' : 'initial-navigate', () => tab.controller.loadForPresentation({ url: initialUrl }));
            tab.lastLoadError = (0, embedded_browser_manager_helpers_1.presentationLoadError)(tab.lastLoadError, result, initialUrl);
            this.refreshTabState(tab);
        }
        tab.sessionId = normalizedSessionId;
        this.markTabSelected(tab);
        return {
            ...this.tabSummary(tab),
            ...(visible && !revealAllowed ? { deferred: 'blocking-overlay' } : {}),
        };
    }
    hasBlockingNativeOverlay() {
        return this.nativeOverlayOcclusionLeases.size > 0;
    }
    async setNativeOverlayOcclusion(leaseId, active) {
        if (active)
            this.nativeOverlayOcclusionLeases.add(leaseId);
        else
            this.nativeOverlayOcclusionLeases.delete(leaseId);
        if (active) {
            const visibleTabs = Array.from(this.tabs.values()).filter((tab) => tab.bounds.x >= 0 && tab.bounds.y >= 0);
            await Promise.all(visibleTabs.map(async (tab) => {
                tab.lastForegroundBounds = tab.bounds;
                await tab.controller.setBounds(embedded_browser_manager_helpers_1.OFFSCREEN_BOUNDS);
                tab.bounds = embedded_browser_manager_helpers_1.OFFSCREEN_BOUNDS;
                this.markTabHidden(tab);
            }));
        }
        return {
            success: true,
            active: this.hasBlockingNativeOverlay(),
            leaseCount: this.nativeOverlayOcclusionLeases.size,
        };
    }
    async setBounds(bounds, sessionId, _viewport, target, layoutOptions) {
        // Session-keyed like hide(): position the calling session's own tab rather
        // than whichever tab happens to be active, so a setBounds from session A can
        // never reposition session B's view. Falls back to the active tab when no
        // sessionId is supplied (resolveTabBySession returns null for undefined).
        let tab;
        try {
            tab = await this.requireBrowserTab({
                ...(target ?? {}),
                ...(sessionId !== undefined ? { sessionId } : {}),
            }, { allowLegacyActive: true });
        }
        catch (error) {
            return { success: false, error: (0, embedded_browser_manager_helpers_1.safeError)(error) };
        }
        if (this.hasBlockingNativeOverlay()) {
            const normalizedBounds = this.normalizeBounds(bounds, _viewport, layoutOptions?.layoutContext);
            tab.lastForegroundBounds = normalizedBounds;
            if (tab.bounds.x >= 0 && tab.bounds.y >= 0) {
                await tab.controller.setBounds(embedded_browser_manager_helpers_1.OFFSCREEN_BOUNDS);
                tab.bounds = embedded_browser_manager_helpers_1.OFFSCREEN_BOUNDS;
                this.markTabHidden(tab);
            }
            return { success: true, tabId: tab.tabId, deferred: 'blocking-overlay' };
        }
        if (tab.hiddenAt != null || tab.bounds.x < 0 || tab.bounds.y < 0) {
            return { success: true, tabId: tab.tabId, ignored: 'hidden-tab' };
        }
        // Geometry cannot reveal a hidden native view. Ignore it without advancing
        // the visibility command watermark: a show() may currently be waiting for
        // an in-flight background action and must remain authoritative.
        if (!this.claimLayoutCommand(tab, layoutOptions?.layoutCommandId)) {
            return { success: true, tabId: tab.tabId, ignored: 'stale-layout-command' };
        }
        const normalizedBounds = this.normalizeBounds(bounds, _viewport, layoutOptions?.layoutContext);
        const webContents = this.getWebContents(tab);
        const focusedBefore = webContents && typeof webContents.isFocused === 'function' ? webContents.isFocused() : null;
        await tab.controller.setBounds(normalizedBounds);
        // A blocking overlay can acquire its lease while the native bounds write
        // is in flight. Recheck after the await so a late real-bounds completion
        // cannot undo the overlay's earlier offscreen write.
        if (this.hasBlockingNativeOverlay()) {
            await tab.controller.setBounds(embedded_browser_manager_helpers_1.OFFSCREEN_BOUNDS);
            tab.bounds = embedded_browser_manager_helpers_1.OFFSCREEN_BOUNDS;
            tab.lastForegroundBounds = normalizedBounds;
            this.markTabHidden(tab);
            return { success: true, tabId: tab.tabId, deferred: 'blocking-overlay' };
        }
        tab.bounds = normalizedBounds;
        tab.lastForegroundBounds = normalizedBounds;
        const focusedAfter = webContents && typeof webContents.isFocused === 'function' ? webContents.isFocused() : null;
        this.logNativeLayerDiagnostic(tab, focusedAfter, layoutOptions?.layoutContext?.hostWebContentsId);
        if (tab.commentModeEnabled) {
            browserInputDiagnosticLogger.info({
                msg: '[EmbeddedBrowserInput] bounds-sync',
                tabId: tab.tabId,
                sessionId: tab.sessionId,
                pageHost: (0, embedded_browser_manager_helpers_1.urlHost)(tab.url),
                focusedBefore,
                focusedAfter,
                bounds: normalizedBounds,
            });
        }
        this.logBoundsDiagnostic(tab, bounds, _viewport, normalizedBounds, layoutOptions?.layoutContext);
        return { success: true, tabId: tab.tabId };
    }
    async setDevicePreviewMode(mode, target) {
        let tab;
        try {
            tab = await this.requireBrowserTab(target, { allowLegacyActive: true });
        }
        catch (error) {
            return { success: false, error: (0, embedded_browser_manager_helpers_1.safeError)(error) };
        }
        return (0, embedded_browser_agent_cursor_1.withDevicePreviewLease)(tab, async () => {
            await tab.controller.hideAgentCursor?.();
            return (0, embedded_browser_device_preview_1.setTabDevicePreviewMode)(tab, mode);
        });
    }
    async show(bounds, target, viewport, layoutContext, layoutCommandId) {
        const normalizedTarget = (0, embedded_browser_manager_helpers_1.normalizeBrowserTarget)(target);
        const requestedTabId = normalizedTarget.tabId;
        if (!this.claimShowLayoutCommand(layoutCommandId)) {
            return {
                success: true,
                ...(typeof requestedTabId === 'number' ? { tabId: requestedTabId } : {}),
                ignored: 'stale-layout-command',
            };
        }
        let tab;
        try {
            tab = this.resolveBrowserTab(normalizedTarget, { allowLegacyActive: true });
            if (!tab && typeof requestedTabId === 'number') {
                tab = await this.resumeSuspendedTab(requestedTabId, normalizedTarget.sessionId);
            }
        }
        catch (error) {
            return { success: false, error: (0, embedded_browser_manager_helpers_1.safeError)(error) };
        }
        if (!tab)
            return { success: false, error: 'No embedded tab is available' };
        if (!this.isLatestShowLayoutCommand(layoutCommandId)) {
            return { success: true, tabId: tab.tabId, ignored: 'stale-layout-command' };
        }
        if (!this.claimLayoutCommand(tab, layoutCommandId)) {
            return { success: true, tabId: tab.tabId, ignored: 'stale-layout-command' };
        }
        const normalizedBounds = this.normalizeBounds(bounds, viewport, layoutContext);
        tab.lastForegroundBounds = normalizedBounds;
        if (this.hasBlockingNativeOverlay()) {
            this.markTabSessionSelected(tab);
            if (tab.bounds.x >= 0 && tab.bounds.y >= 0) {
                await tab.controller.setBounds(embedded_browser_manager_helpers_1.OFFSCREEN_BOUNDS);
                tab.bounds = embedded_browser_manager_helpers_1.OFFSCREEN_BOUNDS;
                this.markTabHidden(tab);
            }
            return { success: true, tabId: tab.tabId, deferred: 'blocking-overlay' };
        }
        await this.backgroundRenderHost.claimForeground(tab.controller);
        // A newer hide/show command can arrive while an in-flight background
        // action drains. Recheck before attaching the native view.
        if (!this.claimLayoutCommand(tab, layoutCommandId) ||
            !this.isLatestShowLayoutCommand(layoutCommandId)) {
            return { success: true, tabId: tab.tabId, ignored: 'stale-layout-command' };
        }
        const committed = await this.showTabExclusive(tab, normalizedBounds, {
            bringToFront: true,
            shouldCommit: () => this.claimLayoutCommand(tab, layoutCommandId) &&
                this.isLatestShowLayoutCommand(layoutCommandId),
        });
        if (!committed) {
            return this.hasBlockingNativeOverlay()
                ? { success: true, tabId: tab.tabId, deferred: 'blocking-overlay' }
                : { success: true, tabId: tab.tabId, ignored: 'stale-layout-command' };
        }
        this.logNativeLayerDiagnostic(tab, this.getWebContents(tab)?.isFocused?.() ?? null, layoutContext?.hostWebContentsId);
        this.logBoundsDiagnostic(tab, bounds, viewport, normalizedBounds, layoutContext);
        return { success: true, tabId: tab.tabId };
    }
    hide(params, layoutCommandId) {
        let tab;
        try {
            tab = this.resolveBrowserTab(params, { allowLegacyActive: true });
        }
        catch (error) {
            return { success: false, error: (0, embedded_browser_manager_helpers_1.safeError)(error) };
        }
        if (!tab)
            return { success: true };
        if (!this.claimLayoutCommand(tab, layoutCommandId)) {
            return { success: true, tabId: tab.tabId, ignored: 'stale-layout-command' };
        }
        tab.controller.setBounds(embedded_browser_manager_helpers_1.OFFSCREEN_BOUNDS);
        tab.bounds = embedded_browser_manager_helpers_1.OFFSCREEN_BOUNDS;
        this.markTabHidden(tab);
        return { success: true, tabId: tab.tabId };
    }
    destroy(params) {
        const normalized = typeof params === 'number' ? { tabId: params } : (params ?? {});
        let targetIds;
        let suspendedTargetIds = [];
        try {
            if (typeof normalized.tabId === 'number') {
                const tab = this.resolveBrowserTab(normalized, { allowLegacyActive: true });
                targetIds = tab ? [tab.tabId] : [];
                const suspended = this.suspendedTabs.get(normalized.tabId);
                if (suspended) {
                    if (typeof normalized.sessionId === 'string' &&
                        suspended.sessionId !== normalized.sessionId) {
                        throw new Error(`Embedded browser tab ${normalized.tabId} does not belong to session ${normalized.sessionId}`);
                    }
                    suspendedTargetIds = [suspended.tabId];
                }
            }
            else if (typeof normalized.sessionId === 'string') {
                targetIds = Array.from(this.tabs.values())
                    .filter((tab) => tab.sessionId === normalized.sessionId)
                    .map((tab) => tab.tabId);
                suspendedTargetIds = Array.from(this.suspendedTabs.values())
                    .filter((tab) => tab.sessionId === normalized.sessionId)
                    .map((tab) => tab.tabId);
            }
            else {
                targetIds = [this.activeTabId].filter((id) => id !== null);
            }
        }
        catch (error) {
            return { success: false, error: (0, embedded_browser_manager_helpers_1.safeError)(error), tabIds: [] };
        }
        for (const targetId of targetIds) {
            const tab = this.tabs.get(targetId);
            if (tab)
                this.destroyTab(tab, 'explicit');
        }
        for (const targetId of suspendedTargetIds) {
            const tab = this.suspendedTabs.get(targetId);
            if (tab)
                this.destroySuspendedTab(tab, 'explicit');
        }
        if (typeof normalized.sessionId === 'string') {
            this.registry.removeSession(normalized.sessionId);
            const prefix = `${normalized.sessionId}\u0000`;
            for (const key of this.coldResumeSnapshots.keys()) {
                if (key.startsWith(prefix))
                    this.coldResumeSnapshots.delete(key);
            }
        }
        this.registry.flush();
        return { success: true, tabIds: [...targetIds, ...suspendedTargetIds] };
    }
    destroySuspendedTab(tab, reason) {
        this.suspendedTabs.delete(tab.tabId);
        this.coldResumeSnapshots.delete(this.coldResumeKey(tab));
        const session = this.sessions.get(tab.sessionId);
        if (session) {
            session.tabIds = session.tabIds.filter((tabId) => tabId !== tab.tabId);
            if (session.selectedTabId === tab.tabId)
                session.selectedTabId = session.tabIds[0] ?? null;
            if (session.visibleTabId === tab.tabId)
                session.visibleTabId = null;
            session.updatedAt = (0, embedded_browser_manager_helpers_1.nowMs)();
            if (session.tabIds.length === 0)
                this.sessions.delete(tab.sessionId);
        }
        if (reason === 'explicit')
            this.registry.removeTab(tab.sessionId, tab.persistentTabId);
    }
    destroyTab(tab, reason = 'explicit', options = {}) {
        if (this.destroyingTabIds.has(tab.tabId))
            return;
        this.destroyingTabIds.add(tab.tabId);
        this.browserResourceDiagnostics.onTabDestroying();
        if (reason === 'explicit')
            this.deleteColdResumeSnapshot(tab);
        else if (typeof tab.sessionId === 'string' && typeof tab.persistentTabId === 'string') {
            const key = this.coldResumeKey(tab);
            if (!this.coldResumeSnapshots.has(key)) {
                this.coldResumeSnapshots.set(key, {
                    navigationHistory: this.captureNavigationSnapshot(tab),
                    pageResume: null,
                });
            }
        }
        this.clearTabOverlayBeforeDestroy(tab, reason);
        this.logTabLifecycle('destroyed', tab, { reason });
        for (const dispose of tab.disposers.splice(0)) {
            try {
                dispose();
            }
            catch {
                // Ignore listener cleanup races during WebContents teardown.
            }
        }
        try {
            tab.controller.destroy();
            this.tabs.delete(tab.tabId);
            if (options.preserveLogicalTab) {
                if (typeof tab.sessionId === 'string') {
                    const session = this.sessions.get(tab.sessionId);
                    if (session?.visibleTabId === tab.tabId)
                        session.visibleTabId = null;
                }
            }
            else {
                this.detachTabFromSession(tab);
            }
            if (reason === 'explicit' &&
                typeof tab.sessionId === 'string' &&
                typeof tab.persistentTabId === 'string') {
                this.registry.removeTab(tab.sessionId, tab.persistentTabId);
            }
            if (this.activeTabId === tab.tabId) {
                this.activeTabId = this.tabs.keys().next().value ?? null;
            }
        }
        finally {
            this.destroyingTabIds.delete(tab.tabId);
        }
        this.stopHiddenSweepTimerIfIdle();
        this.browserResourceDiagnostics.onTabDestroyed();
    }
    destroyAllTabs() {
        for (const tab of Array.from(this.tabs.values())) {
            this.destroyTab(tab, 'host-teardown');
        }
        this.suspendedTabs.clear();
        this.resumingTabs.clear();
        this.activeTabId = null;
        this.sessions.clear();
        this.registry.flush();
        this.stopHiddenSweepTimerIfIdle();
    }
    clearTabOverlayBeforeDestroy(tab, reason) {
        tab.commentModeEnabled = false;
        if (tab.commentEvents.length > 0) {
            this.logCommentEventsCleared(tab, `destroy:${reason}`, tab.commentEvents.length);
            tab.commentEvents = [];
        }
        const wc = this.getWebContents(tab);
        if (!wc || wc.isDestroyed())
            return;
        void this.installCommentBridge(tab)
            .then(() => Promise.all([
            this.postCommentBridgeMessage(tab, { type: 'set-enabled', enabled: false }),
            this.postCommentBridgeMessage(tab, { type: 'clear-comments' }),
        ]))
            .catch((error) => {
            logger.warn(`[EmbeddedBrowser] overlay clear before destroy failed: ${(0, embedded_browser_manager_helpers_1.safeError)(error)}`);
        });
    }
    getState(params) {
        const startedAt = (0, embedded_browser_manager_helpers_1.nowMs)();
        const hasRequestedSession = params && Object.prototype.hasOwnProperty.call(params, 'sessionId');
        let tab;
        try {
            tab = this.resolveBrowserTab(params, { allowLegacyActive: true });
        }
        catch (error) {
            return { success: false, error: (0, embedded_browser_manager_helpers_1.safeError)(error), activeTabId: null, tabs: [] };
        }
        const afterEventId = typeof params?.afterEventId === 'number' ? params.afterEventId : 0;
        const commentEvents = tab
            ? tab.commentEvents.filter((event) => event.eventId > afterEventId)
            : [];
        const requestedSessionId = typeof params?.sessionId === 'string'
            ? params.sessionId
            : typeof tab?.sessionId === 'string'
                ? tab.sessionId
                : undefined;
        const sessionState = requestedSessionId ? this.sessions.get(requestedSessionId) : undefined;
        const liveTabs = Array.from(this.tabs.values()).filter((item) => {
            if (!hasRequestedSession)
                return true;
            return item.sessionId === params?.sessionId;
        });
        const suspendedTabs = Array.from(this.suspendedTabs.values()).filter((item) => {
            if (!hasRequestedSession)
                return true;
            return item.sessionId === params?.sessionId;
        });
        const liveById = new Map(liveTabs.map((item) => [item.tabId, item]));
        const suspendedById = new Map(suspendedTabs.map((item) => [item.tabId, item]));
        const orderedTabIds = sessionState?.tabIds ?? [
            ...liveTabs.map((item) => item.tabId),
            ...suspendedTabs.map((item) => item.tabId),
        ];
        this.logGetStateDiagnostic({
            requestedSessionId: hasRequestedSession ? params.sessionId : undefined,
            tab,
            commentEvents,
            durationMs: (0, embedded_browser_manager_helpers_1.nowMs)() - startedAt,
        });
        const stateTabs = orderedTabIds.flatMap((tabId) => {
            const live = liveById.get(tabId);
            if (live)
                return [this.tabSummary(live)];
            const suspended = suspendedById.get(tabId);
            return suspended ? [this.suspendedTabSummary(suspended)] : [];
        });
        const requestedSuspendedTab = typeof params?.tabId === 'number' ? this.suspendedTabs.get(params.tabId) : undefined;
        return {
            success: true,
            activeTabId: tab?.tabId ?? requestedSuspendedTab?.tabId ?? null,
            selectedTabId: sessionState?.selectedTabId ?? tab?.tabId ?? null,
            visibleTabId: typeof tab?.sessionId === 'string'
                ? (sessionState?.visibleTabId ?? null)
                : (tab?.tabId ?? null),
            tabs: stateTabs,
            annotationEnabled: tab?.commentModeEnabled ?? false,
            commentEvents,
            maxCommentEventId: tab
                ? tab.commentEvents.reduce((max, event) => Math.max(max, event.eventId), 0)
                : 0,
            zoomFactor: tab?.controller.getZoomFactor() ?? 1,
        };
    }
    /** Capture a frozen DOM backdrop above the native browser view. */
    async captureFrame(target) {
        return (0, embedded_browser_agent_cursor_1.captureFrameWithoutAgentCursor)({
            target,
            resolveTab: (nextTarget) => this.resolveBrowserTab(nextTarget, { allowLegacyActive: true }),
            getWebContents: (tab) => this.getWebContents(tab),
            withTabOperation: (tab, label, operation) => this.withTabOperation(tab, label, operation),
            safeError: embedded_browser_manager_helpers_1.safeError,
        });
    }
    async goBack(target, signal) {
        const tab = await this.requireBrowserTab(target, {
            allowLegacyActive: true,
            createIfMissing: true,
            bounds: embedded_browser_manager_helpers_1.OFFSCREEN_BOUNDS,
        });
        tab.lastLoadError = null;
        return this.withTabOperation(tab, 'go-back', () => tab.controller.goBack(), { signal });
    }
    async goForward(target, signal) {
        const tab = await this.requireBrowserTab(target, {
            allowLegacyActive: true,
            createIfMissing: true,
            bounds: embedded_browser_manager_helpers_1.OFFSCREEN_BOUNDS,
        });
        tab.lastLoadError = null;
        return this.withTabOperation(tab, 'go-forward', () => tab.controller.goForward(), { signal });
    }
    async reload(target, signal) {
        const tab = await this.requireBrowserTab(target, {
            allowLegacyActive: true,
            createIfMissing: true,
            bounds: embedded_browser_manager_helpers_1.OFFSCREEN_BOUNDS,
        });
        tab.lastLoadError = null;
        return this.withTabOperation(tab, 'reload', () => tab.controller.reload(), { signal });
    }
    async forceReload(target) {
        let tab;
        try {
            tab = this.resolveBrowserTab(target, { allowLegacyActive: true });
        }
        catch (error) {
            return { success: false, error: (0, embedded_browser_manager_helpers_1.safeError)(error) };
        }
        if (!tab)
            return { success: false, error: 'No embedded tab is available' };
        const wc = this.getWebContents(tab);
        if (!wc)
            return { success: false, error: 'WebContents not available' };
        tab.lastLoadError = null;
        wc.reloadIgnoringCache();
        return { success: true, tabId: tab.tabId };
    }
    async setZoom(factor, target) {
        let tab;
        try {
            tab = this.resolveBrowserTab(target, { allowLegacyActive: true });
        }
        catch (error) {
            return { success: false, error: (0, embedded_browser_manager_helpers_1.safeError)(error) };
        }
        if (!tab)
            return { success: false, error: 'No embedded tab is available' };
        const nextFactor = Math.min(3, Math.max(0.25, factor));
        const result = await tab.controller.setZoomFactor(nextFactor);
        return {
            ...result,
            tabId: tab.tabId,
            zoomFactor: tab.controller.getZoomFactor(),
        };
    }
    async clearCookies(target) {
        let tab;
        try {
            tab = this.resolveBrowserTab(target, { allowLegacyActive: true });
        }
        catch (error) {
            return { success: false, error: (0, embedded_browser_manager_helpers_1.safeError)(error) };
        }
        if (!tab)
            return { success: false, error: 'No embedded tab is available' };
        const wc = this.getWebContents(tab);
        if (!wc)
            return { success: false, error: 'WebContents not available' };
        await this.withTabOperation(tab, 'clear-cookies', () => wc.session.clearStorageData({ storages: ['cookies'] }));
        return { success: true, tabId: tab.tabId };
    }
    async clearCache(target) {
        let tab;
        try {
            tab = this.resolveBrowserTab(target, { allowLegacyActive: true });
        }
        catch (error) {
            return { success: false, error: (0, embedded_browser_manager_helpers_1.safeError)(error) };
        }
        if (!tab)
            return { success: false, error: 'No embedded tab is available' };
        const wc = this.getWebContents(tab);
        if (!wc)
            return { success: false, error: 'WebContents not available' };
        await this.withTabOperation(tab, 'clear-cache', () => wc.session.clearCache());
        return { success: true, tabId: tab.tabId };
    }
    async setCommentMode(enabled, placeholder, options) {
        let tab;
        try {
            tab = this.resolveBrowserTab(options, { allowLegacyActive: true });
        }
        catch (error) {
            return { success: false, error: (0, embedded_browser_manager_helpers_1.safeError)(error) };
        }
        browserInputDiagnosticLogger.info({
            msg: '[EmbeddedBrowserInput] comment-mode-request',
            requestedTabId: options?.tabId ?? null,
            requestedSessionId: options?.sessionId ?? null,
            resolvedTabId: tab?.tabId ?? null,
            resolvedSessionId: tab?.sessionId ?? null,
            globalActiveTabId: this.activeTabId,
            enabled,
            targetAvailable: Boolean(tab),
            targetSuspended: typeof options?.tabId === 'number' ? this.suspendedTabs.has(options.tabId) : false,
        });
        if (!tab)
            return { success: false, error: 'No embedded tab is available' };
        tab.commentModeEnabled = enabled;
        if (typeof placeholder === 'string' && placeholder.trim()) {
            tab.commentPlaceholder = placeholder;
        }
        if (options?.selectionMode) {
            tab.commentSelectionMode = (0, embedded_browser_manager_helpers_1.normalizeCommentSelectionMode)(options.selectionMode);
        }
        if (options?.theme) {
            tab.commentTheme = options.theme;
        }
        if (options?.palette) {
            tab.commentThemePalette = options.palette;
        }
        await this.withTabOperation(tab, 'install-comment-bridge', () => this.installCommentBridge(tab));
        if (options?.clearComments) {
            this.logCommentEventsCleared(tab, 'set-comment-mode', tab.commentEvents.length);
            tab.commentEvents = [];
            await this.withTabOperation(tab, 'clear-comment-overlay', () => this.postCommentBridgeMessage(tab, { type: 'clear-comments' }));
        }
        await this.withTabOperation(tab, 'set-comment-mode', () => this.postCommentBridgeMessage(tab, {
            type: 'set-enabled',
            enabled,
            selectionMode: tab.commentSelectionMode ?? 'dom_node',
            theme: tab.commentTheme ?? 'system',
            ...(tab.commentThemePalette ? { palette: tab.commentThemePalette } : {}),
            ...(tab.commentPlaceholder ? { placeholder: tab.commentPlaceholder } : {}),
        }));
        return { success: true, tabId: tab.tabId, annotationEnabled: enabled };
    }
    async clearComments(target) {
        let tab;
        try {
            tab = this.resolveBrowserTab(target, { allowLegacyActive: true });
        }
        catch (error) {
            return { success: false, error: (0, embedded_browser_manager_helpers_1.safeError)(error) };
        }
        if (!tab)
            return { success: false, error: 'No embedded tab is available' };
        this.logCommentEventsCleared(tab, 'clear-comments', tab.commentEvents.length);
        tab.commentEvents = [];
        await this.withTabOperation(tab, 'install-comment-bridge', () => this.installCommentBridge(tab));
        await this.withTabOperation(tab, 'clear-comment-overlay', () => this.postCommentBridgeMessage(tab, { type: 'clear-comments' }));
        return { success: true, tabId: tab.tabId };
    }
    ackCommentEvents(params) {
        let tab;
        try {
            tab = this.resolveBrowserTab(params, { allowLegacyActive: true });
        }
        catch (error) {
            return { success: false, error: (0, embedded_browser_manager_helpers_1.safeError)(error) };
        }
        if (!tab)
            return { success: false, error: 'No embedded tab is available' };
        const throughEventId = Math.max(0, Math.floor(params?.throughEventId ?? 0));
        if (throughEventId <= 0) {
            return {
                success: true,
                tabId: tab.tabId,
                throughEventId,
                ackedCount: 0,
                pendingCount: tab.commentEvents.length,
            };
        }
        const before = tab.commentEvents.length;
        tab.commentEvents = tab.commentEvents.filter((event) => event.eventId > throughEventId);
        const ackedCount = before - tab.commentEvents.length;
        logger.info({
            msg: '[EmbeddedBrowserComment] comment-events-acked',
            tabId: tab.tabId,
            sessionId: tab.sessionId,
            throughEventId,
            ackedCount,
            pendingCount: tab.commentEvents.length,
            pageHost: (0, embedded_browser_manager_helpers_1.urlHost)(tab.url),
        });
        if (ackedCount > 0) {
            this.ensureHiddenSweepTimer();
        }
        return {
            success: true,
            tabId: tab.tabId,
            throughEventId,
            ackedCount,
            pendingCount: tab.commentEvents.length,
        };
    }
    async navigate(url, target) {
        return this.executeTool('navigate', { ...(target ?? {}), url: (0, embedded_browser_manager_helpers_1.normalizeUrl)(url) });
    }
    getActiveTab() {
        return this.activeTabId === null ? null : (this.tabs.get(this.activeTabId) ?? null);
    }
    async withTabOperation(tab, label, operation, options = {}) {
        const previousOperationCount = Math.max(0, tab.operationCount ?? 0);
        tab.operationCount = previousOperationCount + 1;
        if (previousOperationCount === 0) {
            tab.controller.setBackgroundThrottlingAllowed(false);
        }
        tab.lastUsedAt = (0, embedded_browser_manager_helpers_1.nowMs)();
        const startedAt = (0, embedded_browser_manager_helpers_1.nowMs)();
        const hiddenAtStart = tab.hiddenAt != null || tab.bounds.x < 0 || tab.bounds.y < 0;
        browserInputDiagnosticLogger.info({
            msg: '[EmbeddedBrowserOperation] start',
            label,
            tabId: tab.tabId,
            sessionId: tab.sessionId,
            hidden: hiddenAtStart,
            operationCount: tab.operationCount,
        });
        let outcome = 'success';
        try {
            if (options.signal?.aborted)
                throw new Error('ABORTED: Browser action was cancelled');
            const hidden = tab.hiddenAt != null || tab.bounds.x < 0 || tab.bounds.y < 0;
            if (hidden) {
                const lastForegroundBounds = tab.lastForegroundBounds;
                const renderOptions = {
                    ...(options.signal ? { signal: options.signal } : {}),
                    schedulingKey: typeof tab.sessionId === 'string' ? tab.sessionId : `browser-tab:${tab.tabId}`,
                    ...(options.operationTimeoutMs ? { operationTimeoutMs: options.operationTimeoutMs } : {}),
                    ...(lastForegroundBounds
                        ? {
                            bounds: {
                                x: 0,
                                y: 0,
                                width: lastForegroundBounds.width,
                                height: lastForegroundBounds.height,
                            },
                        }
                        : {}),
                };
                return Object.keys(renderOptions).length > 0
                    ? await this.backgroundRenderHost.run(tab.controller, (signal) => operation(signal), renderOptions)
                    : await this.backgroundRenderHost.run(tab.controller, (signal) => operation(signal));
            }
            const result = await operation(options.signal);
            if (options.signal?.aborted)
                throw new Error('ABORTED: Browser action was cancelled');
            return result;
        }
        catch (error) {
            outcome = 'error';
            browserInputDiagnosticLogger.warn({
                msg: '[EmbeddedBrowserOperation] failed',
                label,
                tabId: tab.tabId,
                sessionId: tab.sessionId,
                hidden: hiddenAtStart,
                durationMs: (0, embedded_browser_manager_helpers_1.nowMs)() - startedAt,
                error: (0, embedded_browser_manager_helpers_1.safeError)(error),
            });
            throw error;
        }
        finally {
            tab.operationCount = Math.max(0, (tab.operationCount ?? 1) - 1);
            if (tab.operationCount === 0) {
                tab.controller.setBackgroundThrottlingAllowed(true);
            }
            browserInputDiagnosticLogger.info({
                msg: '[EmbeddedBrowserOperation] settled',
                label,
                tabId: tab.tabId,
                sessionId: tab.sessionId,
                hidden: hiddenAtStart,
                outcome,
                durationMs: (0, embedded_browser_manager_helpers_1.nowMs)() - startedAt,
                operationCount: tab.operationCount,
            });
            if (tab.operationCount === 0 && tab.hiddenAt != null && this.activeTabId !== tab.tabId) {
                void this.suspendTab(tab, 'background-tab-operation-settled');
            }
            this.ensureHiddenSweepTimer();
        }
    }
    isAgentCursorVisible(tab) {
        return (0, embedded_browser_agent_cursor_1.isAgentCursorVisible)({
            tab,
            activeTabId: this.activeTabId,
            session: typeof tab.sessionId === 'string' ? this.sessions.get(tab.sessionId) : undefined,
            hostWindow: this.hostWindow,
        });
    }
    getOrCreateSession(sessionId) {
        const existing = this.sessions.get(sessionId);
        if (existing)
            return existing;
        const now = (0, embedded_browser_manager_helpers_1.nowMs)();
        const session = {
            sessionId,
            tabIds: [],
            selectedTabId: null,
            visibleTabId: null,
            createdAt: now,
            updatedAt: now,
        };
        this.sessions.set(sessionId, session);
        return session;
    }
    attachTabToSession(tab) {
        if (typeof tab.sessionId !== 'string')
            return;
        const session = this.getOrCreateSession(tab.sessionId);
        if (!session.tabIds.includes(tab.tabId))
            session.tabIds.push(tab.tabId);
        if (session.selectedTabId === null)
            session.selectedTabId = tab.tabId;
        session.updatedAt = (0, embedded_browser_manager_helpers_1.nowMs)();
    }
    detachTabFromSession(tab) {
        if (typeof tab.sessionId !== 'string')
            return;
        const session = this.sessions.get(tab.sessionId);
        if (!session)
            return;
        session.tabIds = session.tabIds.filter((tabId) => tabId !== tab.tabId);
        if (session.selectedTabId === tab.tabId)
            session.selectedTabId = session.tabIds[0] ?? null;
        if (session.visibleTabId === tab.tabId)
            session.visibleTabId = null;
        session.updatedAt = (0, embedded_browser_manager_helpers_1.nowMs)();
        if (session.tabIds.length === 0)
            this.sessions.delete(tab.sessionId);
    }
    markTabSelected(tab) {
        this.activeTabId = tab.tabId;
        this.markTabSessionSelected(tab);
    }
    markTabSessionSelected(tab) {
        tab.lastUsedAt = (0, embedded_browser_manager_helpers_1.nowMs)();
        if (typeof tab.sessionId !== 'string')
            return;
        const session = this.getOrCreateSession(tab.sessionId);
        if (!session.tabIds.includes(tab.tabId))
            session.tabIds.push(tab.tabId);
        session.selectedTabId = tab.tabId;
        session.updatedAt = (0, embedded_browser_manager_helpers_1.nowMs)();
        if (tab.persistentTabId)
            this.registry.selectTab(tab.sessionId, tab.persistentTabId);
    }
    markTabVisible(tab) {
        const previousHiddenAt = tab.hiddenAt ?? null;
        const hiddenMs = previousHiddenAt === null ? 0 : (0, embedded_browser_manager_helpers_1.nowMs)() - previousHiddenAt;
        this.markTabSelected(tab);
        tab.controller.setAudioMuted(false);
        tab.hiddenAt = null;
        if (typeof tab.sessionId !== 'string')
            return;
        const session = this.getOrCreateSession(tab.sessionId);
        session.visibleTabId = tab.tabId;
        session.updatedAt = (0, embedded_browser_manager_helpers_1.nowMs)();
        if (hiddenMs > 0)
            this.logTabLifecycle('shown', tab, { hiddenMs });
    }
    markTabHidden(tab) {
        tab.controller.setAudioMuted(true);
        this.backgroundRenderHost.releaseForeground(tab.controller);
        void tab.controller.hideAgentCursor?.();
        const wasVisible = tab.hiddenAt == null;
        tab.hiddenAt = tab.hiddenAt ?? (0, embedded_browser_manager_helpers_1.nowMs)();
        if (typeof tab.sessionId === 'string') {
            const session = this.sessions.get(tab.sessionId);
            if (session) {
                if (session.visibleTabId === tab.tabId)
                    session.visibleTabId = null;
                session.updatedAt = (0, embedded_browser_manager_helpers_1.nowMs)();
            }
        }
        if (wasVisible)
            this.logTabLifecycle('hidden', tab);
        this.ensureHiddenSweepTimer();
    }
    claimLayoutCommand(tab, layoutCommandId) {
        if (typeof layoutCommandId !== 'number')
            return true;
        const previousCommandId = tab.lastLayoutCommandId ?? 0;
        if (layoutCommandId < previousCommandId) {
            logger.info({
                msg: '[EmbeddedBrowserBounds] stale-layout-command-ignored',
                tabId: tab.tabId,
                sessionId: tab.sessionId,
                layoutCommandId,
                previousCommandId,
            });
            return false;
        }
        tab.lastLayoutCommandId = layoutCommandId;
        return true;
    }
    claimShowLayoutCommand(layoutCommandId) {
        if (typeof layoutCommandId !== 'number')
            return true;
        if (layoutCommandId < this.latestShowLayoutCommandId)
            return false;
        this.latestShowLayoutCommandId = layoutCommandId;
        return true;
    }
    isLatestShowLayoutCommand(layoutCommandId) {
        return (typeof layoutCommandId !== 'number' || layoutCommandId === this.latestShowLayoutCommandId);
    }
    ensureHiddenSweepTimer() {
        if (this.hiddenSweepTimer)
            return;
        if (!Array.from(this.tabs.values()).some((tab) => tab.hiddenAt != null))
            return;
        const timer = setInterval(() => void this.sweepHiddenTabs(), embedded_browser_manager_helpers_1.HIDDEN_SWEEP_INTERVAL_MS);
        timer.unref?.();
        this.hiddenSweepTimer = timer;
    }
    stopHiddenSweepTimerIfIdle() {
        if (!this.hiddenSweepTimer)
            return;
        if (Array.from(this.tabs.values()).some((tab) => tab.hiddenAt != null))
            return;
        clearInterval(this.hiddenSweepTimer);
        this.hiddenSweepTimer = null;
    }
    sweepHiddenTabs() {
        const hiddenTabs = Array.from(this.tabs.values()).filter((tab) => tab.hiddenAt != null);
        if (hiddenTabs.length === 0) {
            this.stopHiddenSweepTimerIfIdle();
            return;
        }
        const budget = this.adaptiveBudget.sample(hiddenTabs.map((tab) => ({ tabId: tab.tabId, webContents: this.getWebContents(tab) })));
        if (budget.pressure !== this.lastResourceDiagnosticPressure) {
            this.lastResourceDiagnosticPressure = budget.pressure;
            this.browserResourceDiagnostics.sample(`memory-pressure:${budget.pressure}`);
        }
        browserInputDiagnosticLogger.info({
            msg: '[EmbeddedBrowserResource] adaptive-budget',
            pressure: budget.pressure,
            deviceCap: budget.deviceCap,
            hiddenTabBudget: budget.hiddenTabBudget,
            hiddenTabCount: hiddenTabs.length,
            availableMemoryMiB: Math.round(budget.availableBytes / 1024 ** 2),
            totalMemoryGiB: Math.round((budget.totalBytes / 1024 ** 3) * 10) / 10,
        });
        hiddenTabs.sort((a, b) => (0, embedded_browser_adaptive_budget_1.memoryWeightedLruValue)(a.lastUsedAt ?? a.hiddenAt ?? 0, budget.estimatedWorkingSetKiBByTabId.get(a.tabId) ?? 0) -
            (0, embedded_browser_adaptive_budget_1.memoryWeightedLruValue)(b.lastUsedAt ?? b.hiddenAt ?? 0, budget.estimatedWorkingSetKiBByTabId.get(b.tabId) ?? 0));
        const reclaimableTabs = hiddenTabs.filter((tab) => this.canDestroyHiddenTab(tab));
        const hiddenTabBudget = Math.min(embedded_browser_manager_helpers_1.MAX_HIDDEN_TABS, budget.hiddenTabBudget);
        const overBudgetCount = Math.max(0, reclaimableTabs.length - hiddenTabBudget);
        const overBudgetTabIds = new Set(reclaimableTabs.slice(0, overBudgetCount).map((tab) => tab.tabId));
        const now = (0, embedded_browser_manager_helpers_1.nowMs)();
        for (const tab of hiddenTabs) {
            const hiddenMs = now - (tab.hiddenAt ?? now);
            const overIdleLimit = hiddenMs >= embedded_browser_manager_helpers_1.HIDDEN_IDLE_TIMEOUT_MS;
            const overCountLimit = overBudgetTabIds.has(tab.tabId);
            if (!overIdleLimit && !overCountLimit)
                continue;
            // Protection state can change between candidate selection and teardown.
            // Recheck immediately before destruction so a newly-started action/load
            // always wins the race against the periodic sweep.
            if (!this.canDestroyHiddenTab(tab))
                continue;
            void this.suspendTab(tab, overIdleLimit ? 'hidden-idle-timeout' : `hidden-tab-limit:${budget.pressure}`);
        }
        this.stopHiddenSweepTimerIfIdle();
    }
    async suspendTab(tab, reason) {
        if (this.suspendingTabIds.has(tab.tabId) || !this.canDestroyHiddenTab(tab))
            return;
        this.suspendingTabIds.add(tab.tabId);
        try {
            const pageResume = await Promise.race([
                (0, embedded_browser_page_resume_1.capturePageResume)(tab.controller),
                new Promise((resolve) => {
                    const timer = setTimeout(() => resolve(null), 250);
                    timer.unref?.();
                }),
            ]).catch(() => null);
            if (!this.tabs.has(tab.tabId) || !this.canDestroyHiddenTab(tab))
                return;
            const navigationHistory = this.captureNavigationSnapshot(tab);
            if (typeof tab.sessionId === 'string' && typeof tab.persistentTabId === 'string') {
                this.coldResumeSnapshots.set(this.coldResumeKey(tab), {
                    navigationHistory,
                    pageResume,
                });
                this.suspendedTabs.set(tab.tabId, {
                    tabId: tab.tabId,
                    persistentTabId: tab.persistentTabId,
                    sessionId: tab.sessionId,
                    createdAt: tab.createdAt,
                    lastUsedAt: tab.lastUsedAt,
                    title: tab.title,
                    url: tab.url,
                    ...(tab.faviconUrl ? { faviconUrl: tab.faviconUrl } : {}),
                    ...(tab.lastForegroundBounds ? { lastForegroundBounds: tab.lastForegroundBounds } : {}),
                    lastLoadError: tab.lastLoadError,
                    zoomFactor: tab.controller.getZoomFactor(),
                    devicePreviewMode: tab.controller.getDevicePreviewMode(),
                });
            }
            this.destroyTab(tab, reason, { preserveLogicalTab: this.suspendedTabs.has(tab.tabId) });
        }
        finally {
            this.suspendingTabIds.delete(tab.tabId);
        }
    }
    canDestroyHiddenTab(tab) {
        if (tab.hiddenAt == null || (tab.operationCount ?? 0) > 0 || tab.commentEvents.length > 0) {
            return false;
        }
        try {
            const hiddenMs = (0, embedded_browser_manager_helpers_1.nowMs)() - tab.hiddenAt;
            return tab.controller.getState().isLoading !== true || hiddenMs >= embedded_browser_manager_helpers_1.HIDDEN_LOADING_GRACE_MS;
        }
        catch {
            // Reclamation is optional. If the renderer state cannot be read, keep
            // the tab and retry on a later sweep instead of racing its teardown.
            return false;
        }
    }
    logTabLifecycle(event, tab, extra) {
        browserInputDiagnosticLogger.info({
            msg: `[EmbeddedBrowserLifecycle] ${event}`,
            event,
            tabId: tab.tabId,
            sessionId: tab.sessionId,
            pageHost: (0, embedded_browser_manager_helpers_1.urlHost)(tab.url),
            webContentsId: this.getWebContents(tab)?.id ?? null,
            aliveMs: (0, embedded_browser_manager_helpers_1.nowMs)() - tab.createdAt,
            hiddenMs: extra?.hiddenMs ?? (tab.hiddenAt == null ? 0 : (0, embedded_browser_manager_helpers_1.nowMs)() - tab.hiddenAt),
            operationCount: tab.operationCount ?? 0,
            pendingCommentEventCount: tab.commentEvents.length,
            reason: extra?.reason ?? null,
        });
    }
    bindWebContentsResourceAudit(tab) {
        const contents = this.getWebContents(tab);
        if (!contents)
            return;
        const webContentsId = contents.id;
        let rendererPid = null;
        try {
            rendererPid = contents.getOSProcessId();
        }
        catch {
            // A renderer can disappear between creation and diagnostic binding.
        }
        const onRenderProcessGone = (_event, details) => {
            this.browserResourceDiagnostics.onRenderProcessGone();
            browserInputDiagnosticLogger.warn({
                msg: '[EmbeddedBrowserLifecycle] render-process-gone',
                event: 'render-process-gone',
                tabId: tab.tabId,
                sessionId: tab.sessionId,
                webContentsId,
                rendererPid,
                reason: details?.reason ?? null,
            });
            this.browserResourceDiagnostics.sample('render-process-gone');
        };
        this.addTabListener(tab, contents, 'render-process-gone', onRenderProcessGone);
        const once = contents.once;
        if (typeof once !== 'function')
            return;
        once.call(contents, 'destroyed', () => {
            const expected = this.destroyingTabIds.has(tab.tabId) || this.tabs.get(tab.tabId) !== tab;
            this.browserResourceDiagnostics.onWebContentsDestroyed();
            browserInputDiagnosticLogger.info({
                msg: '[EmbeddedBrowserLifecycle] web-contents-destroyed',
                event: 'web-contents-destroyed',
                tabId: tab.tabId,
                sessionId: tab.sessionId,
                webContentsId,
                rendererPid,
                expected,
            });
            if (!expected) {
                this.destroyTab(tab, 'web-contents-destroyed');
                return;
            }
            this.browserResourceDiagnostics.sample('web-contents-destroyed');
        });
    }
    getHostWindow() {
        if (this.hostWindow && !this.hostWindow.isDestroyed())
            return this.hostWindow;
        return this.resolveParentWindow();
    }
    getHostRendererViewOffset(hostWebContentsId) {
        const bounds = this.getHostRendererViewBounds(hostWebContentsId);
        return {
            x: bounds ? ((0, embedded_browser_manager_helpers_1.finiteNumber)(bounds.x) ?? 0) : 0,
            y: bounds ? ((0, embedded_browser_manager_helpers_1.finiteNumber)(bounds.y) ?? 0) : 0,
        };
    }
    getHostRendererViewBounds(hostWebContentsIdOverride) {
        const hostWindow = this.getHostWindow();
        if (!hostWindow || hostWindow.isDestroyed())
            return null;
        const hostWebContentsId = hostWebContentsIdOverride ?? this.hostWebContentsId ?? hostWindow.webContents.id;
        const children = hostWindow.contentView?.children ?? [];
        for (const child of children) {
            const view = child;
            if (view.webContents?.id !== hostWebContentsId || typeof view.getBounds !== 'function') {
                continue;
            }
            return view.getBounds();
        }
        return null;
    }
    getContentViewChildDiagnostics(hostWebContentsIdOverride) {
        const hostWindow = this.getHostWindow();
        if (!hostWindow || hostWindow.isDestroyed())
            return [];
        const hostWebContentsId = hostWebContentsIdOverride ?? this.hostWebContentsId ?? hostWindow.webContents.id;
        const children = hostWindow.contentView?.children ?? [];
        return children.map((child, index) => {
            const view = child;
            const webContentsId = typeof view.webContents?.id === 'number' ? view.webContents.id : null;
            return {
                index,
                type: view.constructor?.name ?? 'View',
                webContentsId,
                isHostRenderer: webContentsId === hostWebContentsId,
                bounds: typeof view.getBounds === 'function' ? view.getBounds() : null,
            };
        });
    }
    logBoundsDiagnostic(tab, rendererBounds, viewport, nativeBounds, layoutContext) {
        const hostWindow = this.getHostWindow();
        const hostWebContentsId = layoutContext?.hostWebContentsId ??
            this.hostWebContentsId ??
            hostWindow?.webContents.id ??
            null;
        const hostZoomFactor = layoutContext?.hostZoomFactor ?? this.hostZoomFactor;
        const hostRendererBounds = this.getHostRendererViewBounds(hostWebContentsId);
        const offset = this.getHostRendererViewOffset(hostWebContentsId);
        const children = this.getContentViewChildDiagnostics(hostWebContentsId);
        const nativeView = tab.controller.getNativeViewDiagnostics?.() ?? null;
        const key = JSON.stringify({
            tabId: tab.tabId,
            sessionId: tab.sessionId,
            rendererBounds,
            nativeBounds,
            viewportWidth: viewport?.width ?? null,
            viewportHeight: viewport?.height ?? null,
            visualViewportWidth: viewport?.visualViewport?.width ?? null,
            visualViewportHeight: viewport?.visualViewport?.height ?? null,
            hostWebContentsId,
            hostZoomFactor,
            hostRendererBounds,
            childCount: children.length,
            childBounds: children.map((child) => ({
                webContentsId: child.webContentsId,
                isHostRenderer: child.isHostRenderer,
                bounds: child.bounds,
            })),
            nativeView,
        });
        if (this.lastBoundsDiagnosticKey === key)
            return;
        this.lastBoundsDiagnosticKey = key;
        logger.info({
            msg: '[EmbeddedBrowserBounds] set-bounds',
            tabId: tab.tabId,
            sessionId: tab.sessionId,
            activeTabId: this.activeTabId,
            hostWindowId: hostWindow?.id ?? null,
            hostWindowWebContentsId: hostWindow?.webContents.id ?? null,
            hostWebContentsId,
            hostZoomFactor,
            rendererBounds,
            viewport: viewport ?? null,
            hostRendererBounds,
            coordinateSpace: 'renderer-css-to-native-dip',
            offset,
            nativeBounds,
            nativeView,
            contentViewChildren: children,
        });
    }
    logNativeLayerDiagnostic(tab, browserFocused, hostWebContentsIdOverride) {
        const hostWindow = this.getHostWindow();
        if (!hostWindow || hostWindow.isDestroyed())
            return;
        const children = this.getContentViewChildDiagnostics(hostWebContentsIdOverride);
        const webContents = this.getWebContents(tab);
        const browserWebContentsId = webContents?.id ?? null;
        const hostRendererWebContentsId = hostWebContentsIdOverride ?? this.hostWebContentsId ?? hostWindow.webContents.id;
        const browserChildIndex = children.findIndex((child) => child.webContentsId === browserWebContentsId);
        const hostRendererChildIndex = children.findIndex((child) => child.webContentsId === hostRendererWebContentsId);
        const topmostChildIndex = children.length - 1;
        const browserIsTopmost = browserChildIndex >= 0 && browserChildIndex === topmostChildIndex;
        const hostDevToolsOpened = typeof hostWindow.webContents.isDevToolsOpened === 'function'
            ? hostWindow.webContents.isDevToolsOpened()
            : null;
        const browserDevToolsOpened = webContents && typeof webContents.isDevToolsOpened === 'function'
            ? webContents.isDevToolsOpened()
            : null;
        const diagnostic = {
            tabId: tab.tabId,
            sessionId: tab.sessionId,
            browserWebContentsId,
            hostRendererWebContentsId,
            childCount: children.length,
            browserChildIndex,
            hostRendererChildIndex,
            topmostChildIndex,
            browserIsTopmost,
            browserAttached: browserChildIndex >= 0,
            browserFocused,
            hostDevToolsOpened,
            browserDevToolsOpened,
            commentModeEnabled: tab.commentModeEnabled,
            browserBounds: tab.controller.getNativeViewDiagnostics?.().actualBounds ?? null,
            childOrder: children.map((child) => ({
                index: child.index,
                type: child.type,
                webContentsId: child.webContentsId,
                isHostRenderer: child.isHostRenderer,
            })),
        };
        const key = JSON.stringify(diagnostic);
        if (this.lastNativeLayerDiagnosticKey === key)
            return;
        this.lastNativeLayerDiagnosticKey = key;
        browserInputDiagnosticLogger.info({
            msg: '[EmbeddedBrowserInput] native-layer-state',
            ...diagnostic,
        });
    }
    toContentViewBounds(bounds, layoutContext) {
        if (bounds.x < 0 || bounds.y < 0)
            return bounds;
        const scale = layoutContext?.hostZoomFactor ?? this.hostZoomFactor;
        const offset = this.getHostRendererViewOffset(layoutContext?.hostWebContentsId);
        if (scale === 1 && offset.x === 0 && offset.y === 0)
            return bounds;
        return {
            ...bounds,
            x: bounds.x * scale + offset.x,
            y: bounds.y * scale + offset.y,
            width: bounds.width * scale,
            height: bounds.height * scale,
        };
    }
    normalizeBounds(bounds, _viewport, layoutContext) {
        const contentViewBounds = this.toContentViewBounds(bounds, layoutContext);
        return {
            x: Math.round(contentViewBounds.x),
            y: Math.round(contentViewBounds.y),
            width: Math.max(1, Math.round(contentViewBounds.width)),
            height: Math.max(1, Math.round(contentViewBounds.height)),
        };
    }
    /**
     * Single-visible invariant: stage the target at its real bounds and raise it,
     * then sweep every OTHER tab offscreen before completing the transition. A
     * stale or duplicate setBounds for one session can therefore never leave
     * another session's view painted over the panel. bringToFront only runs for
     * an actual visibility or tab transition. Periodic bounds verification must
     * not detach, reattach, or rewrite unchanged native bounds because those
     * operations can clear focus, interrupt IME composition, or cancel pointer
     * capture.
     */
    async showTabExclusive(target, bounds, options = {}) {
        const handoffStartedAt = (0, embedded_browser_manager_helpers_1.nowMs)();
        const targetWasHidden = target.bounds.x === embedded_browser_manager_helpers_1.OFFSCREEN_BOUNDS.x && target.bounds.y === embedded_browser_manager_helpers_1.OFFSCREEN_BOUNDS.y;
        const previouslyVisibleTabs = Array.from(this.tabs.values()).filter((other) => other.tabId !== target.tabId &&
            !(other.bounds.x === embedded_browser_manager_helpers_1.OFFSCREEN_BOUNDS.x && other.bounds.y === embedded_browser_manager_helpers_1.OFFSCREEN_BOUNDS.y));
        const foregroundHost = this.getHostWindow();
        if (foregroundHost)
            target.controller.addToParent(foregroundHost);
        await target.controller.setBounds(bounds);
        if (this.hasBlockingNativeOverlay()) {
            await target.controller.setBounds(embedded_browser_manager_helpers_1.OFFSCREEN_BOUNDS);
            target.bounds = embedded_browser_manager_helpers_1.OFFSCREEN_BOUNDS;
            target.lastForegroundBounds = bounds;
            this.markTabHidden(target);
            return false;
        }
        if (options.shouldCommit && !options.shouldCommit()) {
            if (targetWasHidden) {
                await target.controller.setBounds(embedded_browser_manager_helpers_1.OFFSCREEN_BOUNDS);
                target.bounds = embedded_browser_manager_helpers_1.OFFSCREEN_BOUNDS;
                this.markTabHidden(target);
            }
            return false;
        }
        target.bounds = bounds;
        target.lastForegroundBounds = bounds;
        if (options.bringToFront !== false)
            target.controller.bringToFront();
        // Keep the previous native surface in place until the target has accepted
        // its real bounds and has been raised. This avoids a blank compositor gap
        // without adding a fixed sleep to the live-to-live switch path.
        for (const other of previouslyVisibleTabs) {
            other.controller.setBounds(embedded_browser_manager_helpers_1.OFFSCREEN_BOUNDS);
            other.bounds = embedded_browser_manager_helpers_1.OFFSCREEN_BOUNDS;
            this.markTabHidden(other);
        }
        this.markTabVisible(target);
        // A non-selected Tab must not keep timers, media decoders, or video
        // playback alive in the background. Preserve its logical metadata and
        // resume snapshot, then release its WebContents immediately. If an Agent
        // action is still using it, withTabOperation retries once that lease ends.
        for (const other of previouslyVisibleTabs) {
            void this.suspendTab(other, 'background-tab-switch');
        }
        if (previouslyVisibleTabs.length > 0) {
            browserInputDiagnosticLogger.info({
                msg: '[EmbeddedBrowserLifecycle] staged-handoff',
                event: 'staged-handoff',
                sourceTabIds: previouslyVisibleTabs.map((tab) => tab.tabId),
                targetTabId: target.tabId,
                sessionId: target.sessionId,
                durationMs: (0, embedded_browser_manager_helpers_1.nowMs)() - handoffStartedAt,
            });
        }
        try {
            this.getWebContents(target)?.invalidate();
        }
        catch {
            // The tab may be destroyed between foreground attachment and repaint.
        }
        return true;
    }
    async ensureActiveTab(bounds, sessionId) {
        const existing = this.getActiveTab();
        if (existing) {
            if (sessionId)
                existing.sessionId = sessionId;
            return existing;
        }
        return this.openTab({ active: true, bounds, sessionId });
    }
    async ensureTabForSession(bounds, sessionId, initialUrl, loadMode = 'agent', active = true) {
        const existing = this.resolveTabBySession(sessionId);
        if (existing)
            return existing;
        if (typeof sessionId === 'string') {
            const selectedTabId = this.sessions.get(sessionId)?.selectedTabId;
            if (typeof selectedTabId === 'number' && this.suspendedTabs.has(selectedTabId)) {
                const resumed = await this.resumeSuspendedTab(selectedTabId, sessionId);
                if (resumed)
                    return resumed;
            }
        }
        return this.openPersistedOrBlankTab({ active, bounds, sessionId, initialUrl, loadMode });
    }
    async openPersistedOrBlankTab(args) {
        const persisted = typeof args.sessionId === 'string' ? this.registry.getSelectedTab(args.sessionId) : null;
        const coldResume = persisted && typeof args.sessionId === 'string'
            ? this.coldResumeSnapshots.get(this.coldResumeKey({
                sessionId: args.sessionId,
                persistentTabId: persisted.persistentTabId,
            }))
            : undefined;
        const navigationHistory = args.initialUrl
            ? undefined
            : (coldResume?.navigationHistory ??
                (persisted?.navigationHistory
                    ? {
                        activeIndex: persisted.navigationHistory.activeIndex,
                        entries: persisted.navigationHistory.entries.map((entry) => ({ ...entry })),
                    }
                    : undefined));
        const tab = await this.openTab({
            ...args,
            ...(navigationHistory ? { navigationHistory } : {}),
            ...(!args.initialUrl && coldResume?.pageResume ? { pageResume: coldResume.pageResume } : {}),
            ...(persisted
                ? {
                    persistentTabId: persisted.persistentTabId,
                    url: args.initialUrl ?? persisted.url,
                }
                : args.initialUrl
                    ? { url: args.initialUrl }
                    : {}),
        });
        if (coldResume) {
            this.coldResumeSnapshots.delete(this.coldResumeKey({
                sessionId: args.sessionId,
                persistentTabId: persisted?.persistentTabId ?? null,
            }));
        }
        return tab;
    }
    async openTab(args) {
        const parentWindow = this.resolveParentWindow();
        if (!parentWindow)
            throw new Error('Main window not found');
        const tabId = args.tabId ?? this.nextTabId++;
        if (this.tabs.has(tabId))
            throw new Error(`Embedded browser tab already exists: tabId=${tabId}`);
        this.nextTabId = Math.max(this.nextTabId, tabId + 1);
        const controller = new controller_1.BrowserController();
        const bounds = args.bounds ?? embedded_browser_manager_helpers_1.DEFAULT_BOUNDS;
        const created = await controller.create(parentWindow, bounds, {
            skipInitialLoad: Boolean(args.navigationHistory),
        });
        if (!created.success) {
            throw new Error(created.error ?? 'Failed to create embedded browser');
        }
        const normalizedSessionId = args.sessionId ?? null;
        const persistedTab = typeof normalizedSessionId === 'string'
            ? this.registry.createTab(normalizedSessionId, {
                ...(args.persistentTabId ? { persistentTabId: args.persistentTabId } : {}),
            })
            : null;
        const tab = {
            tabId,
            persistentTabId: persistedTab?.persistentTabId ?? null,
            controller,
            createdAt: (0, embedded_browser_manager_helpers_1.nowMs)(),
            lastUsedAt: (0, embedded_browser_manager_helpers_1.nowMs)(),
            hiddenAt: bounds.x === embedded_browser_manager_helpers_1.OFFSCREEN_BOUNDS.x && bounds.y === embedded_browser_manager_helpers_1.OFFSCREEN_BOUNDS.y ? (0, embedded_browser_manager_helpers_1.nowMs)() : null,
            operationCount: 0,
            sessionId: normalizedSessionId,
            bounds,
            ...(bounds.x >= 0 && bounds.y >= 0 ? { lastForegroundBounds: bounds } : {}),
            title: '',
            url: 'about:blank',
            commentModeEnabled: false,
            commentSelectionMode: 'dom_node',
            commentTheme: 'system',
            commentEvents: [],
            navigationGeneration: 0,
            devicePreviewTaskTail: Promise.resolve(),
            commentTaskTail: Promise.resolve(),
            inFlightCommentMessages: new Map(),
            processedCommentMessageIds: new Set(),
            disposers: [],
            lastLoadError: null,
            ...(args.pageResume ? { pendingPageResume: args.pageResume } : {}),
        };
        controller.configureAgentCursor?.({
            isEnabled: () => this.isAgentCursorEnabled(),
            identity: () => typeof tab.sessionId === 'string' ? { sessionId: tab.sessionId, tabId: tab.tabId } : null,
            isVisible: () => this.isAgentCursorVisible(tab),
            diagnose: (reason) => browserInputDiagnosticLogger.info({
                msg: '[EmbeddedBrowserAgentCursor] degraded',
                reason,
                tabId: tab.tabId,
                sessionId: tab.sessionId,
                pageHost: (0, embedded_browser_manager_helpers_1.urlHost)(tab.url),
            }),
        });
        this.tabs.set(tabId, tab);
        this.attachTabToSession(tab);
        if (args.active !== false)
            this.markTabSelected(tab);
        else if (args.selectInSession === true)
            this.markTabSessionSelected(tab);
        this.bindWebContentsEvents(tab);
        this.bindWebContentsResourceAudit(tab);
        this.logTabLifecycle('created', tab);
        this.ensureHiddenSweepTimer();
        this.browserResourceDiagnostics.onTabCreated();
        const historyRestored = args.navigationHistory
            ? await this.restoreNavigationSnapshot(tab, args.navigationHistory)
            : false;
        if (args.url && !historyRestored) {
            const url = (0, embedded_browser_manager_helpers_1.normalizeUrl)(args.url);
            const result = await this.withTabOperation(tab, 'open-navigate', () => args.loadMode === 'presentation'
                ? controller.loadForPresentation({ url })
                : controller.navigate({ url }));
            if (args.loadMode === 'presentation') {
                tab.lastLoadError = (0, embedded_browser_manager_helpers_1.presentationLoadError)(tab.lastLoadError, result, url);
            }
            this.refreshTabState(tab);
        }
        return tab;
    }
    async resumeSuspendedTab(tabId, requestedSessionId) {
        const live = this.tabs.get(tabId);
        if (live)
            return live;
        const suspended = this.suspendedTabs.get(tabId);
        if (!suspended)
            return null;
        if (typeof requestedSessionId === 'string' && suspended.sessionId !== requestedSessionId) {
            throw new Error(`Embedded browser tab ${tabId} does not belong to session ${requestedSessionId}`);
        }
        const existingResume = this.resumingTabs.get(tabId);
        if (existingResume)
            return existingResume;
        const resume = this.rehydrateSuspendedTab(suspended);
        this.resumingTabs.set(tabId, resume);
        try {
            return await resume;
        }
        finally {
            if (this.resumingTabs.get(tabId) === resume)
                this.resumingTabs.delete(tabId);
        }
    }
    async rehydrateSuspendedTab(suspended) {
        const persisted = this.registry
            .getSession(suspended.sessionId)
            ?.tabs.find((tab) => tab.persistentTabId === suspended.persistentTabId);
        const resumeKey = this.coldResumeKey(suspended);
        const coldResume = this.coldResumeSnapshots.get(resumeKey);
        const navigationHistory = coldResume?.navigationHistory ??
            (persisted?.navigationHistory
                ? {
                    activeIndex: persisted.navigationHistory.activeIndex,
                    entries: persisted.navigationHistory.entries.map((entry) => ({ ...entry })),
                }
                : undefined);
        const fallbackUrl = persisted?.url ?? suspended.url;
        const tab = await this.openTab({
            tabId: suspended.tabId,
            active: false,
            bounds: embedded_browser_manager_helpers_1.OFFSCREEN_BOUNDS,
            sessionId: suspended.sessionId,
            persistentTabId: suspended.persistentTabId,
            ...(navigationHistory
                ? { navigationHistory }
                : fallbackUrl && fallbackUrl !== 'about:blank'
                    ? { url: fallbackUrl, loadMode: 'presentation' }
                    : {}),
            ...(coldResume?.pageResume ? { pageResume: coldResume.pageResume } : {}),
        });
        if (this.suspendedTabs.get(suspended.tabId) !== suspended) {
            this.destroyTab(tab, 'explicit');
            throw new Error(`Embedded browser tab was closed while resuming: tabId=${suspended.tabId}`);
        }
        this.suspendedTabs.delete(suspended.tabId);
        this.coldResumeSnapshots.delete(resumeKey);
        return tab;
    }
    coldResumeKey(tab) {
        return `${tab.sessionId ?? ''}\u0000${tab.persistentTabId ?? ''}`;
    }
    deleteColdResumeSnapshot(tab) {
        if (typeof tab.sessionId !== 'string' || typeof tab.persistentTabId !== 'string')
            return;
        this.coldResumeSnapshots.delete(this.coldResumeKey(tab));
    }
    captureNavigationSnapshot(tab, includePageState = true) {
        if (typeof tab.sessionId !== 'string' || typeof tab.persistentTabId !== 'string')
            return null;
        const wc = this.getWebContents(tab);
        if (!wc || wc.isDestroyed())
            return null;
        try {
            const entries = wc.navigationHistory.getAllEntries();
            if (entries.length === 0)
                return null;
            const sourceActiveIndex = Math.max(0, Math.min(entries.length - 1, wc.navigationHistory.getActiveIndex()));
            const start = Math.min(Math.max(0, sourceActiveIndex - Math.floor(persistent_browser_registry_1.MAX_PERSISTED_BROWSER_HISTORY_ENTRIES / 2)), Math.max(0, entries.length - persistent_browser_registry_1.MAX_PERSISTED_BROWSER_HISTORY_ENTRIES));
            const boundedEntries = entries.slice(start, start + persistent_browser_registry_1.MAX_PERSISTED_BROWSER_HISTORY_ENTRIES);
            const activeIndex = sourceActiveIndex - start;
            this.registry.updateNavigationHistory(tab.sessionId, tab.persistentTabId, {
                activeIndex,
                entries: boundedEntries.map((entry) => ({ url: entry.url, title: entry.title })),
            });
            if (!includePageState)
                return null;
            let remainingPageStateBytes = MAX_IN_MEMORY_HISTORY_PAGE_STATE_BYTES;
            return {
                activeIndex,
                entries: boundedEntries.map((entry) => {
                    const pageStateBytes = typeof entry.pageState === 'string' ? Buffer.byteLength(entry.pageState, 'utf8') : 0;
                    if (pageStateBytes === 0 || pageStateBytes <= remainingPageStateBytes) {
                        remainingPageStateBytes -= pageStateBytes;
                        return { ...entry };
                    }
                    return { url: entry.url, title: entry.title };
                }),
            };
        }
        catch {
            return null;
        }
    }
    async restoreNavigationSnapshot(tab, snapshot) {
        const wc = this.getWebContents(tab);
        if (!wc || wc.isDestroyed() || snapshot.entries.length === 0)
            return false;
        try {
            await this.withTabOperation(tab, 'restore-navigation-history', () => wc.navigationHistory.restore({
                entries: snapshot.entries.map((entry) => ({ ...entry })),
                index: snapshot.activeIndex,
            }));
            await tab.controller.completeDeferredInitialization();
            this.refreshTabState(tab);
            return true;
        }
        catch (error) {
            logger.warn(`[EmbeddedBrowser] navigation history restore failed: ${(0, embedded_browser_manager_helpers_1.safeError)(error)}`);
            try {
                if (!wc.isDestroyed() && !wc.getURL())
                    await wc.loadURL('about:blank');
                await tab.controller.completeDeferredInitialization();
            }
            catch (initializationError) {
                logger.warn(`[EmbeddedBrowser] history fallback initialization failed: ${(0, embedded_browser_manager_helpers_1.safeError)(initializationError)}`);
            }
            return false;
        }
    }
    /**
     * Remember the renderer window that drives the FilePanel browser UI so
     * tabs attach to it regardless of the active window type (main/archon).
     */
    setHostWindow(window, hostWebContentsId, hostZoomFactor) {
        const nextWindow = window && !window.isDestroyed() ? window : null;
        const nextZoomFactor = typeof hostZoomFactor === 'number' &&
            Number.isFinite(hostZoomFactor) &&
            hostZoomFactor > 0.25 &&
            hostZoomFactor < 4
            ? hostZoomFactor
            : 1;
        if (this.hostWindow === nextWindow) {
            if (hostWebContentsId !== undefined)
                this.hostWebContentsId = hostWebContentsId;
            this.hostZoomFactor = nextZoomFactor;
            return;
        }
        this.clearHostWindowListeners();
        this.hostWindow = nextWindow;
        this.hostWebContentsId = hostWebContentsId ?? null;
        this.hostZoomFactor = nextZoomFactor;
        if (!nextWindow)
            return;
        for (const tab of this.tabs.values()) {
            if (tab.hiddenAt != null || tab.bounds.x < 0 || tab.bounds.y < 0)
                continue;
            tab.controller.addToParent(nextWindow);
        }
        const disposeForHostTeardown = () => {
            this.clearHostWindowListeners();
            // Renderer-owned modal leases cannot be released after a navigation,
            // crash, or window teardown. Drop them with their owner so a stale lease
            // cannot keep future Browser views parked forever.
            this.nativeOverlayOcclusionLeases.clear();
            for (const tab of this.tabs.values()) {
                if (tab.hiddenAt != null || tab.bounds.x < 0 || tab.bounds.y < 0)
                    continue;
                tab.controller.setBounds(embedded_browser_manager_helpers_1.OFFSCREEN_BOUNDS);
                tab.bounds = embedded_browser_manager_helpers_1.OFFSCREEN_BOUNDS;
                this.markTabHidden(tab);
            }
            if (this.hostWindow === nextWindow) {
                this.hostWindow = null;
                this.hostWebContentsId = null;
                this.hostZoomFactor = 1;
            }
        };
        const onDidStartNavigation = (...args) => {
            if ((0, embedded_browser_manager_helpers_1.isMainDocumentNavigation)(args))
                disposeForHostTeardown();
        };
        const onWillNavigate = () => disposeForHostTeardown();
        const onRenderProcessGone = () => disposeForHostTeardown();
        const onWindowClose = () => disposeForHostTeardown();
        const verifyVisibleBounds = () => {
            for (const tab of this.tabs.values()) {
                if (tab.hiddenAt != null || tab.bounds.x < 0 || tab.bounds.y < 0)
                    continue;
                tab.controller.setBounds(tab.bounds);
            }
        };
        this.addHostWindowListener(nextWindow.webContents, 'did-start-navigation', onDidStartNavigation);
        this.addHostWindowListener(nextWindow.webContents, 'will-navigate', onWillNavigate);
        this.addHostWindowListener(nextWindow.webContents, 'render-process-gone', onRenderProcessGone);
        // Detach while the window is still alive. Waiting for `closed` can let
        // Electron destroy child WebContentsView renderers with their UI host.
        this.addHostWindowListener(nextWindow, 'close', onWindowClose);
        for (const event of ['focus', 'resize', 'restore', 'maximize', 'unmaximize']) {
            this.addHostWindowListener(nextWindow, event, verifyVisibleBounds);
        }
    }
    addHostWindowListener(source, event, listener) {
        source.on(event, listener);
        this.hostWindowDisposers.push(() => {
            try {
                source.removeListener(event, listener);
            }
            catch {
                // Ignore listener cleanup races while the host window is navigating away.
            }
        });
    }
    clearHostWindowListeners() {
        for (const dispose of this.hostWindowDisposers.splice(0)) {
            dispose();
        }
    }
    resolveParentWindow() {
        if (this.hostWindow && !this.hostWindow.isDestroyed())
            return this.hostWindow;
        return manager_1.windowManager.getWindowByType('archon') || (0, mainWindow_1.getMainWindow)();
    }
    bindWebContentsEvents(tab) {
        const wc = this.getWebContents(tab);
        if (!wc)
            return;
        this.addTabListener(tab, wc, 'page-title-updated', () => this.refreshTabState(tab));
        this.addTabListener(tab, wc, 'page-favicon-updated', (_event, favicons) => {
            const faviconUrl = Array.isArray(favicons)
                ? (favicons.map(embedded_browser_tab_metadata_1.safeEmbeddedBrowserFaviconUrl).find(Boolean) ?? null)
                : null;
            if (faviconUrl) {
                tab.faviconUrl = faviconUrl;
            }
            else {
                delete tab.faviconUrl;
            }
        });
        this.addTabListener(tab, wc, 'did-navigate', () => this.refreshTabState(tab));
        this.addTabListener(tab, wc, 'did-navigate-in-page', () => this.refreshTabState(tab));
        this.addTabListener(tab, wc, 'did-start-navigation', (...args) => {
            if (!(0, embedded_browser_manager_helpers_1.isMainDocumentNavigation)(args))
                return;
            tab.controller.handleAgentSurfaceNavigationStarted?.();
            void tab.controller.resetAgentCursor?.();
            tab.navigationGeneration = (tab.navigationGeneration ?? 0) + 1;
            tab.commentTaskTail = Promise.resolve();
            tab.processedCommentMessageIds?.clear();
            tab.agentSnapshots?.clear();
            tab.agentSnapshots = undefined;
            delete tab.faviconUrl;
        });
        this.addTabListener(tab, wc, 'did-finish-load', () => {
            this.refreshTabState(tab);
            const pageResume = tab.pendingPageResume;
            if (pageResume) {
                delete tab.pendingPageResume;
                void (0, embedded_browser_page_resume_1.restorePageResume)(tab.controller, pageResume).catch((error) => {
                    logger.warn(`[EmbeddedBrowser] page resume failed: ${(0, embedded_browser_manager_helpers_1.safeError)(error)}`);
                });
            }
            if (this.isAgentCursorEnabled() || (tab.agentExecutionGlowLeases ?? 0) > 0) {
                void tab.controller.installAgentCursorBridge?.();
            }
            if (tab.hiddenAt == null && tab.bounds.x >= 0 && tab.bounds.y >= 0) {
                try {
                    wc.invalidate();
                }
                catch {
                    // The view may be torn down between did-finish-load and repaint.
                }
            }
            if (tab.commentModeEnabled || embedded_browser_manager_helpers_1.ENABLE_BROWSER_INPUT_DIAGNOSTICS) {
                browserInputDiagnosticLogger.info({
                    msg: '[EmbeddedBrowserInput] page-load',
                    tabId: tab.tabId,
                    sessionId: tab.sessionId,
                    pageHost: (0, embedded_browser_manager_helpers_1.urlHost)(tab.url),
                    commentModeEnabled: tab.commentModeEnabled,
                    diagnosticsEnabled: embedded_browser_manager_helpers_1.ENABLE_BROWSER_INPUT_DIAGNOSTICS,
                });
                void this.installCommentBridge(tab)
                    .then(() => {
                    if (!tab.commentModeEnabled)
                        return;
                    return this.postCommentBridgeMessage(tab, {
                        type: 'set-enabled',
                        enabled: true,
                        selectionMode: tab.commentSelectionMode ?? 'dom_node',
                        theme: tab.commentTheme ?? 'system',
                        ...(tab.commentThemePalette ? { palette: tab.commentThemePalette } : {}),
                        ...(tab.commentPlaceholder ? { placeholder: tab.commentPlaceholder } : {}),
                    });
                })
                    .catch((error) => {
                    logger.warn(`[EmbeddedBrowser] comment bridge reapply failed: ${(0, embedded_browser_manager_helpers_1.safeError)(error)}`);
                });
            }
        });
        this.addTabListener(tab, wc, 'devtools-opened', () => {
            void tab.controller.hideAgentCursor?.();
        });
        // NOTE: lastLoadError is cleared by explicit navigation actions, not by
        // 'did-start-loading' — after a failure Chromium loads its internal
        // chrome-error page, which fires did-start-loading and would wipe the
        // error before the UI ever saw it.
        this.addTabListener(tab, wc, 'did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
            // ERR_ABORTED (-3) covers cancelled/replaced loads; only main-frame
            // failures should surface as the UI error page.
            if (isMainFrame && errorCode !== -3 && errorCode !== 0) {
                tab.lastLoadError = {
                    code: errorCode,
                    description: String(errorDescription ?? ''),
                    url: String(validatedURL ?? ''),
                    ts: (0, embedded_browser_manager_helpers_1.nowMs)(),
                };
            }
        });
    }
    getWebContents(tab) {
        return tab.controller.getWebContents();
    }
    refreshTabState(tab) {
        const state = tab.controller.getState();
        const changed = tab.url !== state.url || tab.title !== state.title;
        tab.url = state.url;
        tab.title = state.title;
        if (changed)
            this.commitTabState(tab);
    }
    commitTabState(tab) {
        if (typeof tab.sessionId !== 'string' || typeof tab.persistentTabId !== 'string')
            return;
        const persistedSession = this.registry.getSession(tab.sessionId);
        const persistedTab = persistedSession?.tabs.find((item) => item.persistentTabId === tab.persistentTabId);
        const normalizedUrl = (0, persistent_browser_registry_1.normalizePersistedBrowserUrl)(tab.url);
        const keepRestorableUrl = normalizedUrl === 'about:blank' && persistedTab && persistedTab.url !== 'about:blank';
        this.registry.updateTab(tab.sessionId, tab.persistentTabId, {
            ...(!keepRestorableUrl && normalizedUrl ? { url: normalizedUrl } : {}),
            title: tab.title,
        });
        // Chromium can temporarily expose an about:blank stack after a failed
        // history restore. Keep both the last restorable URL and its matching
        // persisted history so the next cold open does not prefer a blank stack.
        if (!keepRestorableUrl)
            this.captureNavigationSnapshot(tab, false);
    }
    async installCommentBridge(tab) {
        const result = await tab.controller.evaluateInIsolatedWorld(embedded_comment_bridge_1.EMBEDDED_COMMENT_WORLD_ID, embedded_comment_bridge_1.EMBEDDED_COMMENT_BRIDGE_SCRIPT);
        const resultPayload = (0, embedded_browser_manager_helpers_1.asRecord)(result.result);
        browserInputDiagnosticLogger.info({
            msg: '[EmbeddedBrowserInput] bridge-install',
            tabId: tab.tabId,
            sessionId: tab.sessionId,
            pageHost: (0, embedded_browser_manager_helpers_1.urlHost)(tab.url),
            commentModeEnabled: tab.commentModeEnabled,
            success: result.success !== false,
            bridgeVersion: (0, embedded_browser_manager_helpers_1.asString)(resultPayload.bridgeVersion, 'unknown'),
            error: result.success === false ? (0, embedded_browser_manager_helpers_1.asString)(result.error).slice(0, 240) : null,
        });
        if (result.success === false) {
            throw new Error(result.error ?? 'Failed to install browser comment bridge');
        }
        logger.info({
            msg: '[EmbeddedBrowserComment] comment-bridge-installed',
            tabId: tab.tabId,
            sessionId: tab.sessionId,
            pageHost: (0, embedded_browser_manager_helpers_1.urlHost)(tab.url),
            bridgeVersion: (0, embedded_browser_manager_helpers_1.asString)((0, embedded_browser_manager_helpers_1.asRecord)(result.result).bridgeVersion, 'unknown'),
        });
    }
    async postCommentBridgeMessage(tab, message) {
        const result = await tab.controller.evaluateInIsolatedWorld(embedded_comment_bridge_1.EMBEDDED_COMMENT_WORLD_ID, `(() => {
        const control = globalThis[${JSON.stringify(embedded_comment_bridge_1.EMBEDDED_COMMENT_CONTROL_NAME)}];
        if (typeof control !== 'function') return false;
        return control(${JSON.stringify(message)});
      })()`);
        if (result.success === false) {
            throw new Error(result.error ?? 'Failed to post browser comment bridge message');
        }
    }
    async handleCommentBridgeMessage(tab, message, generation) {
        if (message.type === 'diagnostic') {
            this.logBrowserInputDiagnostic(tab, message.payload);
            return {};
        }
        if (message.type === 'ready')
            return {};
        if (message.type === 'comments-renumbered') {
            const payload = (0, embedded_browser_manager_helpers_1.asRecord)(message.payload);
            const comments = (0, embedded_browser_manager_helpers_1.asCommentRenumberMap)(payload.comments);
            if (comments.length === 0)
                return {};
            const event = {
                eventId: this.nextCommentEventId++,
                type: 'comments-renumbered',
                tabId: tab.tabId,
                pageUrl: tab.url,
                comments,
                ts: (0, embedded_browser_manager_helpers_1.nowMs)(),
            };
            this.enqueueCommentEvent(tab, event);
            return {};
        }
        if (message.type === 'comment-removed') {
            const payload = (0, embedded_browser_manager_helpers_1.asRecord)(message.payload);
            const commentId = (0, embedded_browser_manager_helpers_1.asNumber)(payload.commentId);
            if (!commentId)
                return {};
            const event = {
                eventId: this.nextCommentEventId++,
                type: 'comment-removed',
                tabId: tab.tabId,
                commentId,
                pageUrl: tab.url,
                ts: (0, embedded_browser_manager_helpers_1.nowMs)(),
            };
            this.enqueueCommentEvent(tab, event);
            return {};
        }
        const payload = (0, embedded_browser_manager_helpers_1.normalizeCommentPayload)(message.payload);
        if (!payload) {
            logger.info({
                msg: '[EmbeddedBrowserComment] comment-event-dropped',
                reason: 'invalid-payload',
                tabId: tab.tabId,
                sessionId: tab.sessionId,
                globalActiveTabId: this.activeTabId,
                pageHost: (0, embedded_browser_manager_helpers_1.urlHost)(tab.url),
            });
            return {};
        }
        payload.pageUrl = tab.url;
        const screenshotStartedAt = (0, embedded_browser_manager_helpers_1.nowMs)();
        const screenshotDataUrl = await this.withTabOperation(tab, 'comment-screenshot', () => this.captureCommentScreenshot(tab, payload));
        const screenshotMs = (0, embedded_browser_manager_helpers_1.nowMs)() - screenshotStartedAt;
        if (generation !== tab.navigationGeneration)
            return { dropped: 'stale-navigation' };
        if (!tab.commentModeEnabled)
            return { dropped: 'comment-mode-disabled' };
        const eventPayload = {
            ...payload,
            ...(screenshotDataUrl ? { screenshotDataUrl } : {}),
        };
        const event = {
            eventId: this.nextCommentEventId++,
            type: 'comment-added',
            tabId: tab.tabId,
            commentId: eventPayload.commentId,
            pageUrl: eventPayload.pageUrl,
            payload: eventPayload,
            ts: (0, embedded_browser_manager_helpers_1.nowMs)(),
        };
        this.enqueueCommentEvent(tab, event, {
            screenshotMs,
            hasScreenshot: Boolean(screenshotDataUrl),
        });
        return {};
    }
    async handleCommentBridgeEvent(sender, envelope) {
        const tab = Array.from(this.tabs.values()).find((candidate) => {
            const webContents = this.getWebContents(candidate);
            return Boolean(sender && webContents && webContents === sender);
        });
        if (!tab)
            return { success: false, error: 'Invalid embedded browser event sender' };
        const message = (0, embedded_comment_bridge_1.normalizeCommentBridgeMessage)(envelope);
        if (!message)
            return { success: false, error: 'Invalid embedded browser event envelope' };
        let envelopeSize = Number.POSITIVE_INFINITY;
        try {
            envelopeSize = Buffer.byteLength(JSON.stringify(envelope), 'utf8');
        }
        catch {
            // Non-serializable input is not a valid IPC envelope.
        }
        if (envelopeSize > 256 * 1024) {
            return { success: false, error: 'Embedded browser event envelope is too large' };
        }
        tab.navigationGeneration ?? (tab.navigationGeneration = 0);
        const generation = tab.navigationGeneration;
        const messageKey = `${generation}:${message.messageId ?? `unkeyed-${(0, embedded_browser_manager_helpers_1.nowMs)()}`}`;
        tab.commentTaskTail ?? (tab.commentTaskTail = Promise.resolve());
        tab.inFlightCommentMessages ?? (tab.inFlightCommentMessages = new Map());
        tab.processedCommentMessageIds ?? (tab.processedCommentMessageIds = new Set());
        if (tab.processedCommentMessageIds.has(messageKey)) {
            return { success: true, tabId: tab.tabId, duplicate: true };
        }
        const inFlight = tab.inFlightCommentMessages.get(messageKey);
        if (inFlight)
            return inFlight;
        const task = tab.commentTaskTail
            .catch(() => undefined)
            .then(async () => {
            if (generation !== tab.navigationGeneration) {
                return { success: true, tabId: tab.tabId, dropped: 'stale-navigation' };
            }
            const mutation = message.type === 'comment-added' ||
                message.type === 'comment-removed' ||
                message.type === 'comments-renumbered';
            if (mutation && !tab.commentModeEnabled) {
                return { success: false, tabId: tab.tabId, error: 'Browser comment mode is disabled' };
            }
            try {
                this.logCommentBridgeMessage(tab, message, 'preload-ipc');
                const outcome = await this.handleCommentBridgeMessage(tab, message, generation);
                tab.processedCommentMessageIds.add(messageKey);
                if (tab.processedCommentMessageIds.size > 1000) {
                    tab.processedCommentMessageIds = new Set(Array.from(tab.processedCommentMessageIds).slice(-500));
                }
                return { success: true, tabId: tab.tabId, ...outcome };
            }
            catch (error) {
                logger.warn({
                    msg: '[EmbeddedBrowserComment] preload bridge event failed',
                    tabId: tab.tabId,
                    sessionId: tab.sessionId,
                    pageHost: (0, embedded_browser_manager_helpers_1.urlHost)(tab.url),
                    error: (0, embedded_browser_manager_helpers_1.safeError)(error),
                });
                return {
                    success: false,
                    tabId: tab.tabId,
                    error: (0, embedded_browser_manager_helpers_1.safeError)(error),
                    ...(error instanceof BrowserCommentBackpressureError ? { retryable: true } : {}),
                };
            }
        });
        tab.commentTaskTail = task.then(() => undefined, () => undefined);
        tab.inFlightCommentMessages.set(messageKey, task);
        void task.finally(() => {
            if (tab.inFlightCommentMessages.get(messageKey) === task) {
                tab.inFlightCommentMessages.delete(messageKey);
            }
        });
        return task;
    }
    async handleAgentCursorBridgeEvent(sender, envelope) {
        return (0, embedded_browser_agent_cursor_1.handleAgentCursorBridgeEvent)({
            sender,
            envelope,
            getTab: (tabId) => this.tabs.get(tabId),
            getWebContents: (tab) => this.getWebContents(tab),
        });
    }
    enqueueCommentEvent(tab, event, extra) {
        if (tab.commentEvents.length >= embedded_browser_manager_helpers_1.PENDING_COMMENT_EVENT_LIMIT) {
            logger.error({
                msg: '[EmbeddedBrowserComment] comment-event-dropped',
                reason: 'pending-limit-exceeded',
                eventId: event.eventId,
                type: event.type,
                tabId: tab.tabId,
                sessionId: tab.sessionId,
                pendingCount: tab.commentEvents.length,
                pageHost: (0, embedded_browser_manager_helpers_1.urlHost)(event.pageUrl ?? tab.url),
            });
            throw new BrowserCommentBackpressureError('Browser comment event backlog is full');
        }
        tab.commentEvents = [...tab.commentEvents, event];
        this.logCommentEventEnqueued(tab, event, extra);
    }
    logCommentEventEnqueued(tab, event, extra) {
        logger.info({
            msg: '[EmbeddedBrowserComment] comment-event-enqueued',
            eventId: event.eventId,
            type: event.type,
            tabId: tab.tabId,
            sessionId: tab.sessionId,
            globalActiveTabId: this.activeTabId,
            commentId: event.commentId ?? null,
            eventCount: tab.commentEvents.length,
            pageHost: (0, embedded_browser_manager_helpers_1.urlHost)(event.pageUrl ?? tab.url),
            ...(extra?.screenshotMs !== undefined ? { screenshotMs: extra.screenshotMs } : {}),
            ...(extra?.hasScreenshot !== undefined ? { hasScreenshot: extra.hasScreenshot } : {}),
        });
    }
    logCommentEventsCleared(tab, reason, countBefore) {
        if (countBefore === 0)
            return;
        logger.info({
            msg: '[EmbeddedBrowserComment] comment-events-cleared',
            reason,
            tabId: tab.tabId,
            sessionId: tab.sessionId,
            globalActiveTabId: this.activeTabId,
            countBefore,
            pageHost: (0, embedded_browser_manager_helpers_1.urlHost)(tab.url),
        });
    }
    logCommentBridgeMessage(tab, message, transport) {
        if (message.type === 'diagnostic')
            return;
        const payload = (0, embedded_browser_manager_helpers_1.asRecord)(message.payload);
        logger.info({
            msg: message.type === 'ready'
                ? '[EmbeddedBrowserComment] comment-bridge-ready'
                : '[EmbeddedBrowserComment] comment-bridge-message',
            type: message.type,
            transport,
            tabId: tab.tabId,
            sessionId: tab.sessionId,
            globalActiveTabId: this.activeTabId,
            commentModeEnabled: tab.commentModeEnabled,
            commentId: (0, embedded_browser_manager_helpers_1.asNumber)(payload.commentId) ?? null,
            pageHost: (0, embedded_browser_manager_helpers_1.urlHost)((0, embedded_browser_manager_helpers_1.asString)(payload.pageUrl, tab.url)),
            pendingCount: tab.commentEvents.length,
        });
    }
    logBrowserInputDiagnostic(tab, payloadValue) {
        const payload = (0, embedded_browser_manager_helpers_1.asRecord)(payloadValue);
        const stringField = (key) => typeof payload[key] === 'string' ? String(payload[key]).slice(0, 120) : null;
        const booleanField = (key) => typeof payload[key] === 'boolean' ? Boolean(payload[key]) : null;
        const numberField = (key) => typeof payload[key] === 'number' && Number.isFinite(payload[key])
            ? Number(payload[key])
            : null;
        browserInputDiagnosticLogger.info({
            msg: '[EmbeddedBrowserInput] diagnostic',
            tabId: tab.tabId,
            sessionId: tab.sessionId,
            pageHost: (0, embedded_browser_manager_helpers_1.urlHost)(tab.url),
            event: stringField('event'),
            bridgeVersion: stringField('bridgeVersion'),
            selectionMode: stringField('selectionMode'),
            interactionState: stringField('interactionState'),
            pointerState: stringField('pointerState'),
            activeTag: stringField('activeTag'),
            activeIsCommentInput: booleanField('activeIsCommentInput'),
            activeIsBridgeUi: booleanField('activeIsBridgeUi'),
            documentHasFocus: booleanField('documentHasFocus'),
            reason: stringField('reason'),
            result: stringField('result'),
            skipReason: stringField('skipReason'),
            eventType: stringField('eventType'),
            listenerPhase: stringField('listenerPhase'),
            controlDetected: booleanField('controlDetected'),
            inputType: stringField('inputType'),
            keyKind: stringField('keyKind'),
            eventPhase: numberField('eventPhase'),
            defaultPrevented: booleanField('defaultPrevented'),
            isComposing: booleanField('isComposing'),
            composing: booleanField('composing'),
            valueLength: numberField('valueLength'),
            relatedTag: stringField('relatedTag'),
            relatedIsBridgeUi: booleanField('relatedIsBridgeUi'),
            targetTag: stringField('targetTag'),
            targetId: stringField('targetId'),
            targetClass: stringField('targetClass'),
            targetInputType: stringField('targetInputType'),
            targetRole: stringField('targetRole'),
            targetDisabled: booleanField('targetDisabled'),
            targetHasPointerCapture: booleanField('targetHasPointerCapture'),
            targetIsCommentInput: booleanField('targetIsCommentInput'),
            targetIsBridgeUi: booleanField('targetIsBridgeUi'),
            commentModeEnabled: booleanField('commentModeEnabled'),
            propagationStopped: booleanField('propagationStopped'),
            button: numberField('button'),
            buttons: numberField('buttons'),
            pointerType: stringField('pointerType'),
            hitTestTag: stringField('hitTestTag'),
            hitTestId: stringField('hitTestId'),
            nearestRangeId: stringField('nearestRangeId'),
            nearestRangeInputType: stringField('nearestRangeInputType'),
            pointerInsideNearestRange: booleanField('pointerInsideNearestRange'),
            nearestRangeDeltaX: numberField('nearestRangeDeltaX'),
            nearestRangeDeltaY: numberField('nearestRangeDeltaY'),
            nearestRangeWidth: numberField('nearestRangeWidth'),
            nearestRangeHeight: numberField('nearestRangeHeight'),
            pageInnerWidth: numberField('pageInnerWidth'),
            pageInnerHeight: numberField('pageInnerHeight'),
            pageDevicePixelRatio: numberField('pageDevicePixelRatio'),
            pageVisualViewportScale: numberField('pageVisualViewportScale'),
            sceneTransform: stringField('sceneTransform'),
            stage: stringField('stage'),
            hostConnected: booleanField('hostConnected'),
            rootAvailable: booleanField('rootAvailable'),
            uiRootConnected: booleanField('uiRootConnected'),
            composerConnected: booleanField('composerConnected'),
            inputConnected: booleanField('inputConnected'),
            composerWidth: numberField('composerWidth'),
            composerHeight: numberField('composerHeight'),
            composerLeft: numberField('composerLeft'),
            composerTop: numberField('composerTop'),
            errorName: stringField('errorName'),
            errorMessage: stringField('errorMessage'),
            selectionKind: stringField('selectionKind'),
            existingComment: booleanField('existingComment'),
            dragged: booleanField('dragged'),
            width: numberField('width'),
            height: numberField('height'),
            pageTs: numberField('ts'),
        });
    }
    logGetStateDiagnostic(input) {
        const resolvedTabId = input.tab?.tabId ?? null;
        const isScoped = input.requestedSessionId !== undefined;
        const activeMismatch = isScoped && resolvedTabId !== this.activeTabId;
        const commentModeEnabled = Boolean(input.tab?.commentModeEnabled);
        if (input.commentEvents.length === 0 && !activeMismatch && !commentModeEnabled)
            return;
        const maxEventId = input.commentEvents.reduce((max, event) => Math.max(max, event.eventId), 0);
        const requestedSessionKey = input.requestedSessionId === undefined
            ? '__legacy__'
            : (input.requestedSessionId ?? '__null__');
        const key = [
            requestedSessionKey,
            resolvedTabId ?? 'none',
            this.activeTabId ?? 'none',
            input.commentEvents.length,
            maxEventId,
            commentModeEnabled ? 'comment-mode' : 'normal',
        ].join(':');
        if (this.lastGetStateDiagnosticKey === key)
            return;
        this.lastGetStateDiagnosticKey = key;
        logger.info({
            msg: '[EmbeddedBrowserComment] get-state',
            requestedSessionId: input.requestedSessionId ?? null,
            scoped: isScoped,
            resolvedTabId,
            resolvedSessionId: input.tab?.sessionId ?? null,
            globalActiveTabId: this.activeTabId,
            activeMismatch,
            commentModeEnabled,
            commentEventCount: input.commentEvents.length,
            maxEventId: maxEventId || null,
            pendingCount: input.tab?.commentEvents.length ?? 0,
            pageHost: (0, embedded_browser_manager_helpers_1.urlHost)(input.tab?.url),
            durationMs: input.durationMs,
        });
    }
    async captureCommentScreenshot(tab, payload) {
        const wc = this.getWebContents(tab);
        if (!wc || wc.isDestroyed())
            return undefined;
        const padding = 64;
        const viewportWidth = payload.viewport.width || tab.bounds.width;
        const viewportHeight = payload.viewport.height || tab.bounds.height;
        const x = Math.max(0, Math.floor(payload.rect.x - padding));
        const y = Math.max(0, Math.floor(payload.rect.y - padding));
        const width = Math.min(viewportWidth - x, Math.ceil(payload.rect.width + padding * 2));
        const height = Math.min(viewportHeight - y, Math.ceil(payload.rect.height + padding * 2));
        if (width <= 0 || height <= 0)
            return undefined;
        try {
            // Read the already composed WebContents surface. Asking CDP to force a
            // fresh Page.captureScreenshot frame here can visibly flash GPU-heavy pages.
            const image = await (0, embedded_browser_agent_cursor_1.withAgentCursorHiddenForCapture)(tab, () => wc.capturePage({ x, y, width, height }));
            return image.isEmpty()
                ? undefined
                : `data:image/png;base64,${image.toPNG().toString('base64')}`;
        }
        catch (error) {
            logger.warn(`[EmbeddedBrowser] browser comment screenshot failed: ${(0, embedded_browser_manager_helpers_1.safeError)(error)}`);
            return undefined;
        }
    }
    resolveBrowserTab(target, options = {}) {
        const normalized = (0, embedded_browser_manager_helpers_1.normalizeBrowserTarget)(target);
        if (typeof normalized.tabId === 'number') {
            const tab = this.tabs.get(normalized.tabId) ?? null;
            if (tab && typeof normalized.sessionId === 'string') {
                (0, embedded_browser_manager_helpers_1.assertBrowserTabBelongsToSession)(tab, normalized.sessionId);
            }
            return tab;
        }
        if (typeof normalized.sessionId === 'string') {
            return this.resolveSelectedTabBySession(normalized.sessionId);
        }
        return options.allowLegacyActive ? this.getActiveTab() : null;
    }
    async requireBrowserTab(target, options = {}) {
        const normalized = (0, embedded_browser_manager_helpers_1.normalizeBrowserTarget)(target);
        const existing = this.resolveBrowserTab(normalized, {
            allowLegacyActive: options.allowLegacyActive,
        });
        if (existing)
            return existing;
        if (typeof normalized.tabId === 'number') {
            const resumed = await this.resumeSuspendedTab(normalized.tabId, normalized.sessionId);
            if (resumed)
                return resumed;
            throw new Error(`Embedded browser tab not found: tabId=${normalized.tabId}`);
        }
        if (typeof normalized.sessionId === 'string') {
            const selectedTabId = this.sessions.get(normalized.sessionId)?.selectedTabId;
            if (typeof selectedTabId === 'number' && this.suspendedTabs.has(selectedTabId)) {
                const resumed = await this.resumeSuspendedTab(selectedTabId, normalized.sessionId);
                if (resumed)
                    return resumed;
            }
        }
        if (!options.createIfMissing) {
            throw new Error('No embedded tab is available');
        }
        const sessionId = typeof normalized.sessionId === 'string' ? normalized.sessionId : null;
        const persisted = sessionId ? this.registry.getSelectedTab(sessionId) : null;
        if (sessionId &&
            persisted &&
            this.coldResumeSnapshots.has(this.coldResumeKey({
                sessionId,
                persistentTabId: persisted.persistentTabId,
            }))) {
            return this.openPersistedOrBlankTab({
                active: true,
                bounds: options.bounds ?? embedded_browser_manager_helpers_1.OFFSCREEN_BOUNDS,
                sessionId,
            });
        }
        return this.openTab({
            active: true,
            bounds: options.bounds ?? embedded_browser_manager_helpers_1.OFFSCREEN_BOUNDS,
            sessionId,
            ...(persisted ? { persistentTabId: persisted.persistentTabId } : {}),
        });
    }
    resolveSelectedTabBySession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session?.selectedTabId !== null && session?.selectedTabId !== undefined) {
            const selected = this.tabs.get(session.selectedTabId);
            if (selected?.sessionId === sessionId)
                return selected;
            if (this.suspendedTabs.get(session.selectedTabId)?.sessionId === sessionId)
                return null;
        }
        for (const tab of this.tabs.values()) {
            if (tab.sessionId !== sessionId)
                continue;
            this.attachTabToSession(tab);
            const nextSession = this.getOrCreateSession(sessionId);
            if (nextSession.selectedTabId === null)
                nextSession.selectedTabId = tab.tabId;
            return tab;
        }
        return null;
    }
    resolveTabBySession(sessionId) {
        if (typeof sessionId === 'string')
            return this.resolveSelectedTabBySession(sessionId);
        if (sessionId === undefined)
            return null;
        for (const tab of this.tabs.values()) {
            if (tab.sessionId === null)
                return tab;
        }
        return null;
    }
    addTabListener(tab, source, event, listener) {
        source.on(event, listener);
        tab.disposers.push(() => source.removeListener(event, listener));
    }
    resolveTab(args) {
        return this.resolveBrowserTab(args, { allowLegacyActive: true });
    }
    async executeAgentTool(sessionId, tool, rawArgs, signal) {
        // Agent tool routing trusts the runtime-owned session, never model-provided
        // target fields in rawArgs. Keep the preview/action lease on that same tab.
        if (!embedded_browser_manager_helpers_1.AGENT_BROWSER_ACTIONS.has(tool)) {
            throw new Error(`Unsupported Agent browser action: ${tool}`);
        }
        if (tool === 'open_tab') {
            return this.openAgentTab(sessionId, rawArgs, signal);
        }
        const tab = await this.requireBrowserTab({ sessionId }, { allowLegacyActive: false, createIfMissing: true, bounds: embedded_browser_manager_helpers_1.OFFSCREEN_BOUNDS });
        if (tool === 'navigate' &&
            hasLoadedBrowserPage(tab.url) &&
            rawArgs.replaceCurrentTab !== true) {
            throw new Error('CURRENT_TAB_OCCUPIED: Current Browser tab already has a loaded page; retry with open_tab');
        }
        const trustedArgs = tool === 'navigate'
            ? Object.fromEntries(Object.entries(rawArgs).filter(([key]) => key !== 'replaceCurrentTab'))
            : rawArgs;
        const execute = () => this.toolRuntime.executeAgentTool(sessionId, tool, trustedArgs, signal);
        return (0, embedded_browser_agent_cursor_1.executeWithAgentExecutionGlow)(tab, () => (0, embedded_browser_agent_cursor_1.executeWithAgentCursorLease)(tab, execute, {
            hideBeforeAction: tool === 'navigate' ||
                tool === 'back' ||
                tool === 'forward' ||
                tool === 'reload' ||
                tool === 'drag' ||
                tool === 'scroll',
        }));
    }
    async openAgentTab(sessionId, rawArgs, signal) {
        const trustedSessionId = sessionId.trim();
        if (!trustedSessionId)
            throw new Error('Browser tool requires an active session');
        if (signal?.aborted)
            throw new Error('Operation aborted');
        const url = (0, embedded_browser_manager_helpers_1.asString)(rawArgs.url).trim();
        if (!url)
            throw new Error('url is required');
        const previousTab = this.resolveSelectedTabBySession(trustedSessionId);
        const previousBounds = previousTab &&
            previousTab.hiddenAt == null &&
            previousTab.bounds.x >= 0 &&
            previousTab.bounds.y >= 0
            ? previousTab.bounds
            : null;
        let openedTab = null;
        try {
            openedTab = await this.openTab({
                active: false,
                bounds: embedded_browser_manager_helpers_1.OFFSCREEN_BOUNDS,
                sessionId: trustedSessionId,
            });
            const navigation = (0, embedded_browser_manager_helpers_1.asRecord)(await this.toolRuntime.executeTool('navigate', { sessionId: trustedSessionId, tabId: openedTab.tabId, url }, signal));
            if (signal?.aborted)
                throw new Error('Operation aborted');
            if (previousBounds) {
                const shown = await this.show(previousBounds, {
                    sessionId: trustedSessionId,
                    tabId: openedTab.tabId,
                });
                if (shown.success === false) {
                    throw new Error((0, embedded_browser_manager_helpers_1.asString)(shown.error, 'Failed to show the new Browser tab'));
                }
            }
            else {
                this.markTabSessionSelected(openedTab);
            }
            return {
                ...navigation,
                tabId: openedTab.tabId,
                previousTabId: previousTab?.tabId ?? null,
                openedInNewTab: true,
            };
        }
        catch (error) {
            if (openedTab && this.tabs.has(openedTab.tabId)) {
                this.destroyTab(openedTab, 'explicit');
            }
            throw error;
        }
    }
    async executeTool(tool, rawArgs) {
        return this.toolRuntime.executeTool(tool, rawArgs);
    }
    tabSummary(tab) {
        this.refreshTabState(tab);
        const state = tab.controller.getState();
        return {
            tabId: tab.tabId,
            persistentTabId: tab.persistentTabId,
            url: tab.url,
            title: tab.title,
            ...(tab.faviconUrl ? { faviconUrl: tab.faviconUrl } : {}),
            active: tab.tabId === this.activeTabId,
            canGoBack: state.canGoBack,
            canGoForward: state.canGoForward,
            isLoading: state.isLoading,
            annotationEnabled: tab.commentModeEnabled,
            zoomFactor: tab.controller.getZoomFactor(),
            devicePreviewMode: tab.controller.getDevicePreviewMode(),
            lastLoadError: tab.lastLoadError,
        };
    }
    suspendedTabSummary(tab) {
        return {
            tabId: tab.tabId,
            persistentTabId: tab.persistentTabId,
            url: tab.url,
            title: tab.title,
            ...(tab.faviconUrl ? { faviconUrl: tab.faviconUrl } : {}),
            active: false,
            canGoBack: false,
            canGoForward: false,
            isLoading: false,
            annotationEnabled: false,
            zoomFactor: tab.zoomFactor,
            devicePreviewMode: tab.devicePreviewMode,
            lastLoadError: tab.lastLoadError,
            suspended: true,
        };
    }
}
exports.EmbeddedBrowserManager = EmbeddedBrowserManager;
function hasLoadedBrowserPage(url) {
    const normalized = url.trim().toLowerCase();
    return normalized.length > 0 && !normalized.startsWith('about:blank');
}
let embeddedBrowserManager = null;
function getEmbeddedBrowserManager() {
    if (!embeddedBrowserManager) {
        embeddedBrowserManager = new EmbeddedBrowserManager({
            registry: (0, persistent_browser_registry_1.createPersistentBrowserRegistry)(),
            isAgentCursorEnabled: () => (0, config_1.getConfig)().beta.browserAgentCursor === true,
        });
    }
    return embeddedBrowserManager;
}
async function openEmbeddedBrowserExternally(target) {
    const state = getEmbeddedBrowserManager().getState(target);
    const tabs = state.tabs;
    const activeTab = tabs.find((tab) => tab.tabId === state.selectedTabId) ?? tabs[0];
    const url = activeTab?.url;
    if (url && url !== 'about:blank') {
        await (0, open_external_target_1.openExternalTarget)(url);
        return { success: true, url };
    }
    return { success: false, error: 'No navigated embedded browser tab' };
}
