/**
 * WorkflowChatPage renders the unified workflow-chat experience.
 * It keeps the neo-bot CSS hooks used by the existing layout.
 */

import {
  startTransition,
  useRef,
  useEffect,
  useState,
  useMemo,
  useCallback,
  type KeyboardEvent,
} from "react";
import { flushSync } from "react-dom";
import { useUnifiedChatStore } from "@/stores/unified-chat-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useSettingsPageStore } from "@/stores/settings-page-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useInspectorStore } from "@/stores/inspector-store";
import { notify } from "@/lib/notifications";
import { STRINGS } from "@shared/strings.zh";
import { CONVERSATION_PAGE_CONTRACT } from "@shared/conversation-page-contract";
import { PermissionRequestPanel } from "@/components/workbench/interaction";
import {
  ComposerShell,
  ReadThreadTurnList,
  ScrollToBottomButton,
  useConversationScroll,
  type WorkflowMessageBlock,
} from "@/components/workflow-chat";
import { OPEN_GLOBAL_SEARCH_EVENT } from "@/components/workbench/events";
import { WorkflowChatHeader } from "./WorkflowChatHeader";
import type { UserMessageContent } from "../types";
import type { WorkflowUserMessageContent } from "@shared/workflow-read-thread-contract";
import type {
  AgentSecurityMode,
  PermissionDialogRequest,
  ContextActionRequest,
} from "@shared/types";
import { applySecurityMode } from "@shared/security-policy";
import {
  EMPTY_PENDING_STEERS,
  SESSION_CONTENT_SETTLE_MS,
  workspaceDisplayName,
  genUiId,
  summarizeWorkflowFileChanges,
  firstWorkflowFileChangeTarget,
  inferSendWorkMode,
  copyToClipboard,
} from "./workflow-chat-helpers";
import { ModelSelector } from "./WorkflowChatModelSelector";
import {
  ModelChangeDivider,
  PlanImplementationPromptCard,
  ContextActionCard,
} from "./WorkflowChatCards";
import { useComposerCatalogs } from "./use-slash-commands";
import { useModelChangeTracking } from "./use-model-change-tracking";
import {
  TaskContextPanel,
  type TaskContextMode,
  type TaskPresentationModel,
} from "@/components/workflow-chat/task-context";
import type { WorkflowChatHeaderThreadSummary } from "./WorkflowChatHeader";

type BrowserCommentPayload = Extract<
  WorkflowUserMessageContent,
  { type: "browserComment" }
>;

function browserCommentFromEvent(value: unknown): BrowserCommentPayload | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const commentId = Number(raw.commentId);
  const ref = typeof raw.ref === "string" ? raw.ref.trim() : "";
  const comment = typeof raw.comment === "string" ? raw.comment.trim() : "";
  if (!Number.isFinite(commentId) || commentId <= 0 || !ref || !comment) {
    return null;
  }
  const rect = raw.rect as Record<string, unknown> | undefined;
  const viewport = raw.viewport as Record<string, unknown> | undefined;
  const attributes =
    raw.attributes && typeof raw.attributes === "object"
      ? Object.fromEntries(
          Object.entries(raw.attributes as Record<string, unknown>).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : {};
  return {
    type: "browserComment",
    commentId,
    targetType: raw.targetType === "region" ? "region" : "element",
    ref,
    tagName: typeof raw.tagName === "string" ? raw.tagName : "",
    text: typeof raw.text === "string" ? raw.text : "",
    attributes,
    rect: {
      x: Number(rect?.x) || 0,
      y: Number(rect?.y) || 0,
      width: Number(rect?.width) || 0,
      height: Number(rect?.height) || 0,
    },
    viewport: {
      width: Number(viewport?.width) || 0,
      height: Number(viewport?.height) || 0,
    },
    scrollX: Number(raw.scrollX) || 0,
    scrollY: Number(raw.scrollY) || 0,
    comment,
    styleEdits:
      raw.styleEdits && typeof raw.styleEdits === "object"
        ? Object.fromEntries(
            Object.entries(raw.styleEdits as Record<string, unknown>).filter(
              (entry): entry is [string, string] =>
                typeof entry[1] === "string",
            ),
          )
        : undefined,
    pageUrl: typeof raw.pageUrl === "string" ? raw.pageUrl : undefined,
    screenshotDataUrl:
      typeof raw.screenshotDataUrl === "string"
        ? raw.screenshotDataUrl
        : undefined,
  };
}

export function WorkflowChatPage({
  leftCollapsed = false,
  titleHidden = false,
  showHeader = true,
  taskPresentation,
  taskContextMode = "hidden",
  taskContextControl,
  taskContextInWindowTitlebar = true,
  taskContextGitLoading = false,
  onTaskContextRefresh,
  onTaskContextCloseFloating,
  permissionRequest,
  onPermissionRespond,
}: {
  leftCollapsed?: boolean;
  titleHidden?: boolean;
  showHeader?: boolean;
  taskPresentation: TaskPresentationModel;
  taskContextMode?: TaskContextMode;
  taskContextControl?: WorkflowChatHeaderThreadSummary;
  taskContextInWindowTitlebar?: boolean;
  taskContextGitLoading?: boolean;
  onTaskContextRefresh: () => void;
  onTaskContextCloseFloating: () => void;
  permissionRequest?: PermissionDialogRequest;
  onPermissionRespond: (
    approved: boolean,
    scope?: "once" | "session",
    reason?: string,
  ) => void;
}) {
  const activeSessionId = useUnifiedChatStore((s) => s.activeSessionId);
  const openReview = useInspectorStore((state) => state.openReview);
  const activeSession = useUnifiedChatStore((s) =>
    activeSessionId
      ? s.sessions.find((session) => session.id === activeSessionId)
      : undefined,
  );
  const inputText = useUnifiedChatStore((s) => s.inputText);
  const setInputText = useUnifiedChatStore((s) => s.setInputText);
  const sendMessage = useUnifiedChatStore((s) => s.sendMessage);
  const createSession = useUnifiedChatStore((s) => s.createSession);
  const pendingSteers = useUnifiedChatStore((s) =>
    activeSessionId
      ? (s.pendingSteers[activeSessionId] ?? EMPTY_PENDING_STEERS)
      : EMPTY_PENDING_STEERS,
  );
  const steerQueuePaused = useUnifiedChatStore((s) =>
    activeSessionId ? Boolean(s.steerQueuePaused[activeSessionId]) : false,
  );
  const resumeSteerQueue = useUnifiedChatStore((s) => s.resumeSteerQueue);
  const cancelPendingSteer = useUnifiedChatStore((s) => s.cancelPendingSteer);
  const applyPendingSteerNow = useUnifiedChatStore(
    (s) => s.applyPendingSteerNow,
  );
  const reorderSteers = useUnifiedChatStore((s) => s.reorderSteers);
  const planImplementationPrompt = useUnifiedChatStore(
    (s) => s.planImplementationPrompt,
  );
  const dismissPlanImplementationPrompt = useUnifiedChatStore(
    (s) => s.dismissPlanImplementationPrompt,
  );
  const forkSession = useUnifiedChatStore((s) => s.forkSession);
  const abort = useUnifiedChatStore((s) => s.abort);
  const compactSession = useUnifiedChatStore((s) => s.compactSession);
  const contextActionRequest = useUnifiedChatStore(
    (s) => s.contextActionRequest,
  );
  const clearContextActionRequest = useUnifiedChatStore(
    (s) => s.clearContextActionRequest,
  );
  const continueContextAction = useUnifiedChatStore(
    (s) => s.continueContextAction,
  );
  const loadReadThread = useUnifiedChatStore((s) => s.loadReadThread);
  const loadMoreReadThread = useUnifiedChatStore((s) => s.loadMoreReadThread);
  const readThreadPaging = useUnifiedChatStore((s) =>
    activeSessionId ? s.readThreadPaging[activeSessionId] : undefined,
  );
  const getActiveReadThreadModel = useUnifiedChatStore(
    (s) => s.getActiveReadThreadModel,
  );
  const activeReadThreadSnapshot = useUnifiedChatStore((s) =>
    s.activeSessionId ? s.readThreads[s.activeSessionId] : undefined,
  );
  // Dual-source: UIEvent flag (real-time) OR snapshot thread status (cold-start
  // fallback for sessions opened mid-stream — crash recovery, multi-window).
  const isStreamingThisSession = useUnifiedChatStore((s) =>
    activeSessionId
      ? Boolean(s.streamingSessionIds[activeSessionId]) ||
        s.readThreads[activeSessionId]?.thread.status.type === "active"
      : false,
  );
  const currentRequestId = useUnifiedChatStore((s) => s.currentRequestId);
  const activeExecution = useUnifiedChatStore((s) =>
    activeSessionId ? s.executionBySession[activeSessionId] : undefined,
  );
  const sessionInitInfo = useUnifiedChatStore((s) =>
    activeSessionId ? s.sessionInitInfo[activeSessionId] : undefined,
  );

  const { slashCommands, skills: composerSkills } =
    useComposerCatalogs(sessionInitInfo);

  const settings = useSettingsStore((s) => s.settings);
  const setModel = useSettingsStore((s) => s.setModel);
  const loadSettings = useSettingsStore((s) => s.load);
  const saveSettings = useSettingsStore((s) => s.save);
  const openSettings = useSettingsPageStore((state) => state.openSection);
  const workspace = useWorkspaceStore((s) => s.current);
  const composerEpoch = useUnifiedChatStore((s) => s.composerEpoch);
  // Keep this outside React state: a second click/Enter can arrive before a
  // render disables or clears the composer. Without it, each submission gets a
  // fresh steer messageId and is correctly (but unexpectedly) queued by main.
  const sendInFlightRef = useRef(false);
  const browserCommentKeysRef = useRef(new Set<string>());
  const inputTextRef = useRef(inputText);
  const [nextWorkModeOverride, setNextWorkModeOverride] = useState<
    "execute" | "plan" | null
  >(null);
  const [incomingBrowserComment, setIncomingBrowserComment] = useState<{
    eventId: string;
    pageId: string;
    payloads: BrowserCommentPayload[];
  } | null>(null);
  const [browserCommentSubmit, setBrowserCommentSubmit] = useState<{
    eventId: string;
    pageId: string;
    payloads: BrowserCommentPayload[];
  } | null>(null);
  const [browserCommentRemoval, setBrowserCommentRemoval] = useState<{
    eventId: string;
    pageId: string;
    commentId: number;
  } | null>(null);

  useEffect(() => {
    inputTextRef.current = inputText;
  }, [inputText]);

  useEffect(() => {
    const handleBrowserInput = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (!detail || typeof detail !== "object") return;
      const record = detail as {
        type?: unknown;
        pageId?: unknown;
        payload?: unknown;
        payloads?: unknown;
      };
      const values =
        record.type === "submit-comments" && Array.isArray(record.payloads)
          ? record.payloads
          : record.type === "comment"
            ? [record.payload]
            : [];
      const payloads = values
        .map(browserCommentFromEvent)
        .filter((payload): payload is BrowserCommentPayload =>
          Boolean(payload),
        );
      if (payloads.length === 0) return;
      const pageId = typeof record.pageId === "string" ? record.pageId : "";
      if (record.type === "submit-comments") {
        setBrowserCommentSubmit({
          eventId: `${pageId}:${payloads.map((payload) => payload.commentId).join(",")}:${Date.now()}`,
          pageId,
          payloads,
        });
        return;
      }
      const freshPayloads = payloads.filter((payload) => {
        const key = `${pageId}:${payload.commentId}:${payload.ref}`;
        if (browserCommentKeysRef.current.has(key)) return false;
        browserCommentKeysRef.current.add(key);
        return true;
      });
      if (freshPayloads.length === 0) return;
      setIncomingBrowserComment({
        eventId: `${pageId}:${freshPayloads.map((payload) => payload.commentId).join(",")}`,
        pageId,
        payloads: freshPayloads,
      });
    };
    window.addEventListener("browser:send-to-agent", handleBrowserInput);
    return () =>
      window.removeEventListener("browser:send-to-agent", handleBrowserInput);
  }, [setInputText]);

  useEffect(() => {
    const handleBrowserCommentRemoval = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (!detail || typeof detail !== "object") return;
      const record = detail as { pageId?: unknown; commentId?: unknown };
      const pageId = typeof record.pageId === "string" ? record.pageId : "";
      const commentId = Number(record.commentId);
      if (!pageId || !Number.isInteger(commentId) || commentId <= 0) return;
      const keyPrefix = `${pageId}:${commentId}:`;
      for (const key of browserCommentKeysRef.current) {
        if (key.startsWith(keyPrefix))
          browserCommentKeysRef.current.delete(key);
      }
      setBrowserCommentRemoval({
        eventId: `${pageId}:${commentId}:${Date.now()}`,
        pageId,
        commentId,
      });
    };
    window.addEventListener(
      "browser:comment-removed",
      handleBrowserCommentRemoval,
    );
    return () =>
      window.removeEventListener(
        "browser:comment-removed",
        handleBrowserCommentRemoval,
      );
  }, []);

  const handleSecurityModeChange = useCallback(
    (securityMode: AgentSecurityMode) => {
      if (!settings) return;
      void saveSettings(applySecurityMode(settings, securityMode));
    },
    [settings, saveSettings],
  );

  const handleNewSession = useCallback(async () => {
    await createSession();
  }, [createSession]);

  const [contentSessionId, setContentSessionId] = useState(activeSessionId);
  const contentSessionReady = contentSessionId === activeSessionId;

  useEffect(() => {
    if (contentSessionId === activeSessionId) return;
    if (!activeSessionId) return;
    // If the target session's readThread is already cached, switch content
    // immediately — no settle delay needed since the data is in memory and
    // there is nothing to debounce. The delay only helps for sessions that
    // require a fresh fetch (uncached), where it coalesces rapid clicks.
    if (useUnifiedChatStore.getState().readThreads[activeSessionId]) {
      startTransition(() => setContentSessionId(activeSessionId));
      return;
    }
    const timer = window.setTimeout(() => {
      startTransition(() => setContentSessionId(activeSessionId));
    }, SESSION_CONTENT_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [activeSessionId, contentSessionId]);

  // 空态下每次渲染都会新建 []，包一层 useMemo 避免 useMemo(messages) 依赖每次变化
  const messages = useMemo(
    () => (contentSessionReady ? (activeSession?.messages ?? []) : []),
    [activeSession?.messages, contentSessionReady],
  );
  const activeSessionIsStreaming = isStreamingThisSession;
  const displayReadThread = contentSessionReady
    ? getActiveReadThreadModel()
    : null;
  // Phase 2→3: the snapshot's running turn is the canonical streaming source.
  // streamingSessionIds provides the responsive pending/running boolean;
  // per-event blocks/timeline/content are no longer read by the page.
  const activeRunningTurn = useMemo(() => {
    if (!displayReadThread) return undefined;
    const ordered =
      displayReadThread.page.order === "newest_first"
        ? [...displayReadThread.turns].reverse()
        : displayReadThread.turns;
    return ordered.find((turn) => turn.status === "running");
  }, [displayReadThread]);

  const composerContextUsage = useUnifiedChatStore((s) =>
    activeSessionId ? s.contextUsage[activeSessionId] : undefined,
  );
  const composerUsage = useMemo(() => {
    if (!displayReadThread?.turns.length) return undefined;
    for (const turn of displayReadThread.turns) {
      if (turn.usage) return turn.usage;
    }
    return undefined;
  }, [displayReadThread]);
  const activePlanImplementationPrompt =
    planImplementationPrompt?.sessionId === activeSessionId
      ? planImplementationPrompt
      : null;
  const activeTaskProgress = useMemo(() => {
    const turnId =
      activeRunningTurn?.id ??
      (isStreamingThisSession ? currentRequestId : undefined);
    return Object.values(activeExecution?.tasks ?? {})
      .filter((task) => !turnId || !task.turnId || task.turnId === turnId)
      .sort((a, b) => a.ordinal - b.ordinal);
  }, [
    activeExecution?.tasks,
    activeRunningTurn?.id,
    isStreamingThisSession,
    currentRequestId,
  ]);
  const hasIncompleteTasks = activeTaskProgress.some(
    (task) => task.status === "creating" || task.status === "running",
  );
  const activeContextActionRequest =
    contextActionRequest?.sessionId === activeSessionId
      ? contextActionRequest
      : null;
  // Streaming content signal derived from the snapshot's running turn,
  // derived from the snapshot's running turn items.
  const runningContentSignal = useMemo(() => {
    const turn = activeRunningTurn;
    if (!turn) return 0;
    let len = 0;
    for (const item of turn.items) {
      if (item.type === "agentMessage") len += item.text.length;
      else if (item.type === "reasoning") len += item.summary.length;
    }
    return len;
  }, [activeRunningTurn]);
  const isReadThreadLoading =
    Boolean(activeSessionId) &&
    (!contentSessionReady ||
      (Boolean(readThreadPaging?.loading) && !displayReadThread?.turns.length));
  const composerFileChanges = useMemo(() => {
    const orderedTurns = displayReadThread
      ? displayReadThread.page.order === "newest_first"
        ? [...displayReadThread.turns].reverse()
        : displayReadThread.turns
      : [];
    // Snapshot running turn is the canonical source; fall back to the last
    // turn when none is running (pending / just-completed gap).
    const readTurn = activeRunningTurn ?? orderedTurns.at(-1);
    const summary = readTurn
      ? summarizeWorkflowFileChanges(readTurn.items)
      : undefined;
    return {
      summary,
      target: readTurn
        ? firstWorkflowFileChangeTarget(readTurn.items)
        : undefined,
    };
  }, [activeRunningTurn, displayReadThread]);
  const composerReviewTarget = composerFileChanges.target;
  const composerPlaceholder = CONVERSATION_PAGE_CONTRACT.composer.placeholder;
  const isEmpty =
    !isReadThreadLoading &&
    messages.length === 0 &&
    !displayReadThread?.turns.length;
  const selectedProvider = settings?.providers.find(
    (provider) => provider.id === settings.defaultModel.providerId,
  );
  const selectedModel = selectedProvider?.models.find(
    (model) => model.id === settings?.defaultModel.modelId,
  );
  const modelName =
    selectedModel?.label ?? settings?.defaultModel.modelId ?? "Marloues";
  const promptWorkspaceName = workspaceDisplayName(workspace);

  const {
    pendingModelChangeNotice,
    setPendingModelChangeNotice,
    modelSwitchWarningVisible,
  } = useModelChangeTracking(
    activeSessionId,
    activeSessionIsStreaming,
    modelName,
    settings,
  );
  const activeRunningItemCount = activeRunningTurn?.items.length ?? 0;

  // 融合吸底 + 滚动位置记忆 + 向上加载更多的滚动 hook
  const {
    viewportRef: scrollRef,
    contentRef: messagesContentRef,
    handleScroll: handleMessagesScroll,
    isAtBottom,
    scrollToBottom,
  } = useConversationScroll({
    contentSignal: useMemo(
      () => [
        messages.length,
        displayReadThread?.turns.length,
        activeReadThreadSnapshot?.turns.length,
        activeRunningItemCount,
        runningContentSignal,
      ],
      [
        messages.length,
        displayReadThread?.turns.length,
        activeReadThreadSnapshot?.turns.length,
        activeRunningItemCount,
        runningContentSignal,
      ],
    ),
    sessionKey: activeSessionId ?? "default",
    hasMore: Boolean(readThreadPaging?.hasMore),
    loadingMore: Boolean(readThreadPaging?.loadingMore),
    onLoadMore: () =>
      activeSessionId ? loadMoreReadThread(activeSessionId) : Promise.resolve(),
  });

  // Scroll to bottom on session switch (model change notice reset is handled
  // by useModelChangeTracking).
  useEffect(() => {
    requestAnimationFrame(() => {
      scrollToBottom("auto");
    });
  }, [activeSessionId, scrollToBottom]);

  useEffect(() => {
    if (!activeSessionId) return;
    const timer = window.setTimeout(() => {
      const state = useUnifiedChatStore.getState();
      if (
        state.activeSessionId !== activeSessionId ||
        state.readThreads[activeSessionId] ||
        state.readThreadPaging[activeSessionId]?.loading
      ) {
        return;
      }
      void loadReadThread(activeSessionId);
    }, 60);
    return () => window.clearTimeout(timer);
  }, [activeSessionId, loadReadThread]);

  // When a turn finishes, re-sync the model selector with persisted settings.
  // Mid-turn model switches are persisted by the main process; this guarantees
  // the input box reflects the user's last choice and is not reverted by any
  // turn-completion data flow (e.g. read-thread reload carrying the request-time
  // model snapshot). The re-read is a no-op when settings already match.
  const prevStreamingRef = useRef(false);
  useEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = activeSessionIsStreaming;
    if (wasStreaming && !activeSessionIsStreaming) {
      void loadSettings();
    }
  }, [activeSessionIsStreaming, loadSettings]);

  const handleSend = async (attachments: UserMessageContent[] = []) => {
    // The form can receive Enter and a pointer submit before async IPC resolves.
    // Treat those as one submission, otherwise the same steer is queued once per
    // event with different message ids.
    if (sendInFlightRef.current) return;

    const text = inputText.trim();
    if (!text && attachments.length === 0) return;
    const isSteer = activeSessionIsStreaming;
    if (!workspace?.path) {
      notify({
        title: "未选择工作区",
        description: "请先在左侧边栏选择一个工作区目录。",
        tone: "warning",
      });
      return;
    }
    // Local UI-side builtin commands: execute directly instead of forwarding
    // the raw "/<cmd> ..." text to the LLM runtime.
    const BUILTIN_LOCAL_COMMANDS: Record<string, () => Promise<void> | void> = {
      compact: () => compactSession(activeSessionId ?? undefined),
    };
    const localCommandName = text.match(/^\/(\w+)\b/)?.[1];
    const localHandler = localCommandName
      ? BUILTIN_LOCAL_COMMANDS[localCommandName]
      : undefined;
    if (localHandler && !isSteer) {
      void localHandler();
      setInputText("");
      return;
    }
    sendInFlightRef.current = true;
    // 发送即吸底：让用户消息立即可见，并重新武装 shouldStick，
    // 保证后续 AI 回复流式内容持续跟随（此前若用户上翻阅读历史，回复会在视口外）。
    scrollToBottom("auto");
    try {
      const pendingNoticeForSend = pendingModelChangeNotice;
      let clientMessageId: string | undefined;
      if (
        pendingNoticeForSend &&
        activeSessionId &&
        pendingNoticeForSend.sessionId === activeSessionId
      ) {
        clientMessageId = genUiId("user");
        setPendingModelChangeNotice({
          ...pendingNoticeForSend,
          beforeUserMessageId: clientMessageId,
        });
      }
      // 发送后由 contentSignal 变化驱动吸底（shouldStick 已在发送时重新武装）
      const result = await sendMessage(text, attachments, clientMessageId, {
        deliveryMode: isSteer ? "steer" : "normal",
        workMode: isSteer
          ? undefined
          : (nextWorkModeOverride ??
            inferSendWorkMode(text, settings?.workMode)),
      });
      // 仅当消息被处理（ok）时清输入；失败时保留，供用户重发。
      // steer 不可用会在 sendMessage 内降级为新 turn（仍 ok），消息不丢。
      if (result.ok) setInputText("");
      if (!isSteer) setNextWorkModeOverride(null);
      // Notify the browser panel to exit annotation mode and clear overlays —
      // this syncs the main composer send with the annotation bar send.
      if (result.ok)
        window.dispatchEvent(new CustomEvent("browser:annotations-sent"));
    } finally {
      sendInFlightRef.current = false;
    }
  };

  const handleCopyMessage = async (text: string) => {
    try {
      await copyToClipboard(text);
    } catch (error) {
      notify({
        title: "复制失败",
        description: error instanceof Error ? error.message : String(error),
        tone: "error",
      });
      throw error;
    }
  };
  const handleForkConversation = async (message: WorkflowMessageBlock) => {
    if (!activeSessionId) return;
    try {
      await forkSession(activeSessionId, message.id);
      notify({
        title: STRINGS.system.workflow.forkCreatedTitle,
        description: STRINGS.system.workflow.forkCreatedDescription,
        tone: "success",
      });
    } catch (error) {
      notify({
        title: STRINGS.system.update.branchCreateFailed,
        description: error instanceof Error ? error.message : String(error),
        tone: "error",
      });
    }
  };

  const handleContextAction = async (
    action: ContextActionRequest["actions"][number],
  ) => {
    if (!activeContextActionRequest) return;
    try {
      if (
        action === "switch_to_larger_model" &&
        activeContextActionRequest.largerModel
      ) {
        await setModel(
          activeContextActionRequest.largerModel.providerId,
          activeContextActionRequest.largerModel.modelId,
        );
        clearContextActionRequest();
        notify({
          title: "已切换到大上下文模型",
          description: activeContextActionRequest.largerModel.modelId,
          tone: "success",
        });
        return;
      }
      if (action === "create_small_model_branch" && activeSessionId) {
        await forkSession(activeSessionId);
        clearContextActionRequest();
        notify({
          title: STRINGS.system.workflow.compactBranchCreated,
          tone: "success",
        });
        return;
      }
      if (action === "new_session") {
        await handleNewSession();
        clearContextActionRequest();
        return;
      }
      if (action === "continue_anyway") {
        await continueContextAction();
      }
    } catch (error) {
      notify({
        title: STRINGS.system.update.contextActionFailed,
        description: error instanceof Error ? error.message : String(error),
        tone: "error",
      });
    }
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // IME composition in progress (e.g. typing pinyin then Enter to pick a
    // Chinese candidate): let the input method own the keystroke so confirming
    // a candidate does not also send the message.
    if (event.nativeEvent.isComposing || event.keyCode === 229) {
      return;
    }
    const isModifierSend = event.key === "Enter" && event.metaKey;
    const isPlainEnter =
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey;
    const isControlledNewline =
      event.key === "Enter" && event.ctrlKey && !event.metaKey;

    if (event.key.toLowerCase() === "k" && (event.ctrlKey || event.metaKey)) {
      // ⌘K / Ctrl+K inside the composer should open the global search
      // overlay, not silently clear the input (the previous behaviour was
      // a bug). Dispatch the workbench event so WorkbenchRoot owns the state.
      event.preventDefault();
      window.dispatchEvent(new CustomEvent(OPEN_GLOBAL_SEARCH_EVENT));
      return;
    }

    if (event.key === "Escape" && activeSessionIsStreaming) {
      event.preventDefault();
      void abort(activeSessionId ?? undefined);
      return;
    }

    if (isControlledNewline) {
      event.preventDefault();
      const target = event.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const nextValue = `${inputText.slice(0, start)}\n${inputText.slice(end)}`;
      flushSync(() => setInputText(nextValue));
      target.selectionStart = start + 1;
      target.selectionEnd = start + 1;
      return;
    }

    if (isPlainEnter || isModifierSend) {
      event.preventDefault();
      handleSend();
    }
  };

  const implementPlan = (clearContext = false) => {
    const prompt = activePlanImplementationPrompt;
    if (!prompt) return;
    dismissPlanImplementationPrompt();
    void (async () => {
      if (clearContext) {
        await handleNewSession();
        await sendMessage(
          [
            "A previous agent produced the plan below to accomplish the user's task.",
            "Implement the plan in a fresh context. Treat the plan as the source of user intent, re-read files as needed, and carry the work through implementation and verification.",
            "",
            prompt.planText,
          ].join("\n"),
          [],
          undefined,
          { workMode: "execute" },
        );
        return;
      }
      await sendMessage("Implement the plan.", [], undefined, {
        workMode: "execute",
      });
    })();
  };

  const continuePlanning = () => {
    dismissPlanImplementationPrompt();
    setNextWorkModeOverride("plan");
    setInputText("继续完善这个计划：");
  };

  return (
    <section
      className={`chat-page ${isEmpty ? "chat-page-empty" : ""} ${leftCollapsed ? "left-collapsed" : ""} ${titleHidden ? "chat-title-hidden" : ""} ${showHeader ? "has-inline-header" : ""} ${taskContextMode === "docked" ? "task-context-docked" : ""}`}
    >
      {showHeader && !isEmpty ? (
        <WorkflowChatHeader
          titleHidden={titleHidden}
          threadSummary={taskContextControl}
          threadSummaryInWindowTitlebar={taskContextInWindowTitlebar}
        />
      ) : null}

      <TaskContextPanel
        model={taskPresentation}
        mode={taskContextMode}
        gitLoading={taskContextGitLoading}
        onRefresh={onTaskContextRefresh}
        onCloseFloating={onTaskContextCloseFloating}
        onOpenChanges={
          taskPresentation.changes?.reviewTarget
            ? () => {
                const { path, diff } = taskPresentation.changes!.reviewTarget!;
                openReview(path, diff);
              }
            : undefined
        }
      />

      <div
        className="messages-scroll scrollbar-thin"
        ref={scrollRef}
        onScroll={handleMessagesScroll}
        tabIndex={-1}
        aria-label="会话内容"
      >
        <div ref={messagesContentRef} className="messages-inner">
          {readThreadPaging?.hasMore ? (
            <div className="load-more-indicator" aria-live="polite">
              {readThreadPaging.loadingMore
                ? "加载历史中…"
                : "向上滚动加载更多"}
            </div>
          ) : null}
          {isReadThreadLoading && !displayReadThread ? (
            <div className="conversation-loading" role="status">
              正在加载会话…
            </div>
          ) : null}
          {!isEmpty ? (
            <>
              {displayReadThread ? (
                <ReadThreadTurnList
                  readThread={displayReadThread}
                  isStreaming={activeSessionIsStreaming}
                  scrollParentRef={scrollRef}
                  stateScopeKey={activeSessionId ?? "default"}
                  modelName={modelName}
                  onFork={handleForkConversation}
                  onCopyMessage={handleCopyMessage}
                  onEditUserMessage={(text) => {
                    setInputText(text);
                    requestAnimationFrame(() => {
                      document
                        .querySelector<HTMLTextAreaElement>(
                          ".composer textarea",
                        )
                        ?.focus();
                    });
                  }}
                  renderBeforeTurn={(message) =>
                    pendingModelChangeNotice?.sessionId === activeSessionId &&
                    pendingModelChangeNotice.beforeUserMessageId &&
                    message.userMessageId ===
                      pendingModelChangeNotice.beforeUserMessageId ? (
                      <ModelChangeDivider
                        fromModel={pendingModelChangeNotice.fromModel}
                        toModel={pendingModelChangeNotice.toModel}
                      />
                    ) : null
                  }
                />
              ) : null}
              {activeContextActionRequest ? (
                <ContextActionCard
                  request={activeContextActionRequest}
                  onDismiss={clearContextActionRequest}
                  onAction={(action) => void handleContextAction(action)}
                />
              ) : null}
            </>
          ) : null}
        </div>
      </div>
      <ScrollToBottomButton
        visible={!isEmpty && !isAtBottom}
        onClick={() => scrollToBottom("smooth")}
      />
      {activePlanImplementationPrompt && !activeSessionIsStreaming ? (
        <PlanImplementationPromptCard
          planText={activePlanImplementationPrompt.planText}
          onImplement={() => implementPlan(false)}
          onImplementFresh={() => implementPlan(true)}
          onStayInPlan={continuePlanning}
          onDismiss={dismissPlanImplementationPrompt}
        />
      ) : null}
      <ComposerShell
        conversationKey={`${activeSessionId ?? "new-session"}:${composerEpoch}`}
        input={inputText}
        incomingBrowserComment={incomingBrowserComment ?? undefined}
        browserCommentSubmit={browserCommentSubmit ?? undefined}
        browserCommentRemoval={browserCommentRemoval ?? undefined}
        isGenerating={activeSessionIsStreaming}
        securityMode={settings?.securityMode ?? "request"}
        permissionPanel={
          permissionRequest ? (
            <PermissionRequestPanel
              request={permissionRequest}
              onRespond={onPermissionRespond}
            />
          ) : undefined
        }
        emptyHeader={
          isEmpty ? (
            <h1 className="empty-composer-prompt" title={workspace?.path}>
              {workspace?.path
                ? `你想让我们在 ${promptWorkspaceName} 中构建什么？`
                : "我们要构建什么？"}
            </h1>
          ) : undefined
        }
        taskProgress={
          activeSessionIsStreaming || hasIncompleteTasks
            ? activeTaskProgress
            : undefined
        }
        fileChangeSummary={
          activeSessionIsStreaming || hasIncompleteTasks
            ? composerFileChanges.summary
            : undefined
        }
        onFileChangeSummaryClick={
          composerReviewTarget
            ? () => {
                const { path, diff } = composerReviewTarget;
                openReview(path, diff);
              }
            : undefined
        }
        selectedProvider={null}
        placeholder={composerPlaceholder}
        onInputChange={setInputText}
        onKeyDown={handleComposerKeyDown}
        onSend={handleSend}
        onStop={() => void abort(activeSessionId ?? undefined)}
        onSecurityModeChange={handleSecurityModeChange}
        onOpenSecuritySettings={() => openSettings("security")}
        modelControl={
          <ModelSelector switchWarningVisible={modelSwitchWarningVisible} />
        }
        slashCommands={slashCommands}
        skills={composerSkills}
        workspacePath={workspace?.path}
        contextUsage={composerContextUsage}
        usage={composerUsage}
        pendingSteers={pendingSteers}
        steerQueuePaused={steerQueuePaused}
        onResumeSteerQueue={() => {
          if (activeSessionId) void resumeSteerQueue(activeSessionId);
        }}
        onApplyPendingSteer={(messageId) => {
          if (!activeSessionId) return;
          void applyPendingSteerNow(activeSessionId, messageId);
        }}
        onCancelPendingSteer={(messageId) => {
          if (!activeSessionId) return;
          void cancelPendingSteer(activeSessionId, messageId);
        }}
        onEditPendingSteer={(messageId, text) => {
          if (!activeSessionId) return;
          void cancelPendingSteer(activeSessionId, messageId);
          setInputText(text);
        }}
        onReorderPendingSteer={(orderedIds) => {
          if (!activeSessionId) return;
          void reorderSteers(activeSessionId, orderedIds);
        }}
      />
    </section>
  );
}
