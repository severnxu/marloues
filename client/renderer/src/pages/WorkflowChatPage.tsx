/**
 * WorkflowChatPage renders the unified workflow-chat experience.
 * It keeps the marloues CSS hooks used by the existing layout.
 */

import { useRef, useEffect, useState, type KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import { X, ChevronDown, Check, Columns2, PanelRight, RotateCcw, Play, Maximize2, GitBranch, MessageSquarePlus, Box, Info } from "lucide-react";
import { useUnifiedChatStore } from "@/stores/unified-chat-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { notify } from "@/lib/notifications";
import { PermissionRequestOverlay } from "@/components/layout/PermissionRequestOverlay";
import {
  ComposerShell,
  ReadThreadTurnList,
  ScrollToBottomButton,
} from "@/components/workflow-chat";
import type { WorkflowMessageBlock } from "@/components/workflow-chat/workflow-consumption-model";
import type { UserMessageContent } from "../types";
import type { ChatRewindResult, ContextActionRequest, PermissionDialogRequest } from "@shared/types";

interface RewindDialogState {
  message: WorkflowMessageBlock;
  preview: ChatRewindResult;
  selectedFiles: string[];
  applying: boolean;
}

interface PendingModelChangeNotice {
  id: string;
  sessionId: string;
  fromModel: string;
  toModel: string;
  beforeUserMessageId?: string;
}

function isNearScrollBottom(element: HTMLElement, threshold = 96): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight < threshold;
}

function formatSessionTitle(title?: string): string {
  const value = title?.trim();
  if (!value || value === "New chat" || value === "Untitled") {
    return "New chat";
  }
  return value;
}

function workspaceDisplayName(workspace?: { name?: string; path?: string } | null): string {
  const name = workspace?.name?.trim();
  if (name) return name;
  const path = workspace?.path?.trim();
  if (!path) return "当前工作空间";
  return path.split(/[\\/]/).filter(Boolean).pop() ?? "当前工作空间";
}

function genUiId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function ModelChangeDivider({ fromModel, toModel }: { fromModel: string; toModel: string }) {
  return (
    <div className="model-change-divider" role="status" aria-label={`模型已从 ${fromModel} 更改为 ${toModel}`}>
      <span className="model-change-divider-line" />
      <span className="model-change-divider-label">
        <Box size={14} />
        <span>模型已从 <strong>{fromModel}</strong> 更改为 <strong>{toModel}</strong></span>
        <Info size={14} />
      </span>
      <span className="model-change-divider-line" />
    </div>
  );
}

function ModelSelector({ switchWarningVisible = false }: { switchWarningVisible?: boolean }) {
  const settings = useSettingsStore((s) => s.settings);
  const setModel = useSettingsStore((s) => s.setModel);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const providerGroups =
    settings?.providers
      .filter((provider) => provider.enabled)
      .map((provider) => ({
        provider,
        models: provider.models.filter((model) => model.enabled),
      }))
      .filter((group) => group.models.length > 0)
      ?? [];
  const currentModelId = settings?.defaultModel.modelId;
  const currentProviderId = settings?.defaultModel.providerId;
  const currentProvider = settings?.providers.find(
    (provider) => provider.id === currentProviderId,
  );
  const currentModel = currentProvider?.models.find(
    (model) => model.id === currentModelId,
  );
  const currentProviderLabel =
    currentProvider?.name ??
    currentProviderId ??
    "provider";
  const currentLabel =
    currentModel?.label ??
    currentModelId ??
    "local-loop";

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [open]);

  if (providerGroups.length === 0) return null;

  return (
    <div className="model-selector-surface" ref={menuRef}>
      {switchWarningVisible ? (
        <div className="model-switch-warning-bubble" role="status">
          在对话过程中切换模型会降低性能表现。
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="model-chip"
        title={`${currentProviderLabel} / ${currentLabel}`}
      >
        <span>{currentProviderLabel}</span>
        <strong>{currentLabel}</strong>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="composer-popover model-popover">
          <div className="popover-title">选择模型</div>
          <div className="model-option-list">
            {providerGroups.map(({ provider, models }) => (
              <div className="model-provider-group" key={provider.id}>
                <div className="model-provider-label">
                  <span>{provider.name}</span>
                  <small>{provider.purpose ?? "endpoint"}</small>
                </div>
                {models.map((model) => {
                  const isActive =
                    provider.id === currentProviderId &&
                    model.id === currentModelId;
                  return (
                    <button
                      key={`${provider.id}:${model.id}`}
                      type="button"
                      onClick={() => {
                        void setModel(provider.id, model.id);
                        setOpen(false);
                      }}
                      className={`model-option ${isActive ? "active" : ""}`}
                    >
                      <span className="model-avatar">
                        {(provider.name || model.label || model.id || "M")
                          .slice(0, 1)
                          .toUpperCase()}
                      </span>
                      <span>
                        <strong>{model.label || model.id}</strong>
                        <small>
                          {isActive
                            ? "当前路由模型"
                            : model.id}
                        </small>
                      </span>
                      {isActive ? <Check size={16} /> : null}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function WorkflowChatPage({
  rightOpen,
  onToggleRight,
  leftCollapsed = false,
  permissionRequest,
  onPermissionRespond,
}: {
  rightOpen: boolean;
  onToggleRight: () => void;
  leftCollapsed?: boolean;
  permissionRequest?: PermissionDialogRequest;
  onPermissionRespond: (approved: boolean, scope?: "once" | "session", reason?: string) => void;
}) {
  const sessions = useUnifiedChatStore((s) => s.sessions);
  const activeSessionId = useUnifiedChatStore((s) => s.activeSessionId);
  const inputText = useUnifiedChatStore((s) => s.inputText);
  const setInputText = useUnifiedChatStore((s) => s.setInputText);
  const sendMessage = useUnifiedChatStore((s) => s.sendMessage);
  const createSession = useUnifiedChatStore((s) => s.createSession);
  const forkSession = useUnifiedChatStore((s) => s.forkSession);
  const regenerateMessage = useUnifiedChatStore((s) => s.regenerateMessage);
  const rewindFiles = useUnifiedChatStore((s) => s.rewindFiles);
  const editAndResendMessage = useUnifiedChatStore(
    (s) => s.editAndResendMessage,
  );
  const abort = useUnifiedChatStore((s) => s.abort);
  const contextActionRequest = useUnifiedChatStore((s) => s.contextActionRequest);
  const clearContextActionRequest = useUnifiedChatStore((s) => s.clearContextActionRequest);
  const continueContextAction = useUnifiedChatStore((s) => s.continueContextAction);
  const loadReadThread = useUnifiedChatStore((s) => s.loadReadThread);
  const getActiveReadThreadModel = useUnifiedChatStore((s) => s.getActiveReadThreadModel);
  const activeReadThreadSnapshot = useUnifiedChatStore((s) =>
    s.activeSessionId ? s.readThreads[s.activeSessionId] : undefined,
  );
  const liveTurns = useUnifiedChatStore((s) => s.liveTurns);
  const settings = useSettingsStore((s) => s.settings);
  const setModel = useSettingsStore((s) => s.setModel);
  const workspace = useWorkspaceStore((s) => s.current);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [rewindDialog, setRewindDialog] = useState<RewindDialogState | null>(null);
  const [pendingModelChangeNotice, setPendingModelChangeNotice] = useState<PendingModelChangeNotice | null>(null);
  const [modelSwitchWarningVisible, setModelSwitchWarningVisible] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const messages = activeSession?.messages ?? [];
  const activeLiveTurn = activeSessionId ? liveTurns[activeSessionId] : undefined;
  const activeSessionIsStreaming = activeLiveTurn?.status === "pending" || activeLiveTurn?.status === "running";
  const activeContextActionRequest =
    contextActionRequest?.sessionId === activeSessionId ? contextActionRequest : null;
  const displayReadThread = getActiveReadThreadModel();
  const isEmpty = messages.length === 0;
  const selectedProvider = settings?.providers.find(
    (provider) => provider.id === settings.defaultModel.providerId,
  );
  const selectedModel = selectedProvider?.models.find(
    (model) => model.id === settings?.defaultModel.modelId,
  );
  const modelName =
    selectedModel?.label ??
    settings?.defaultModel.modelId ??
    "Marloues";
  const promptWorkspaceName = workspaceDisplayName(workspace);

  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const lastModelRef = useRef<{ id: string; label: string } | null>(null);
  const modelSwitchWarningTimerRef = useRef<number | null>(null);

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    shouldStickToBottomRef.current = true;
    setIsAtBottom(true);
  };

  const handleMessagesScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const nextIsAtBottom = isNearScrollBottom(el);
    shouldStickToBottomRef.current = nextIsAtBottom;
    setIsAtBottom(nextIsAtBottom);
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (!shouldStickToBottomRef.current) {
      setIsAtBottom(isNearScrollBottom(el));
      return;
    }
    requestAnimationFrame(() => {
      scrollToBottom("auto");
    });
  }, [
    messages.length,
    displayReadThread?.turns.length,
    activeReadThreadSnapshot?.turns.length,
    activeLiveTurn?.blocks.length,
    activeLiveTurn?.timeline.length,
    activeLiveTurn?.content.length,
  ]);

  useEffect(() => {
    shouldStickToBottomRef.current = true;
    setEditingMessageId(null);
    setRewindDialog(null);
    setPendingModelChangeNotice(null);
    setModelSwitchWarningVisible(false);
    requestAnimationFrame(() => {
      scrollToBottom("auto");
    });
  }, [activeSessionId]);

  useEffect(() => {
    return () => {
      if (modelSwitchWarningTimerRef.current != null) {
        window.clearTimeout(modelSwitchWarningTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!settings || !activeSessionId) return;
    const currentModel = {
      id: `${settings.defaultModel.providerId}:${settings.defaultModel.modelId}`,
      label: modelName,
    };
    const previousModel = lastModelRef.current;
    lastModelRef.current = currentModel;
    if (!previousModel || previousModel.id === currentModel.id) return;
    if (!activeSessionIsStreaming) return;

    setPendingModelChangeNotice((existing) => {
      if (existing?.sessionId === activeSessionId && !existing.beforeUserMessageId) {
        if (existing.fromModel === currentModel.label) return null;
        return { ...existing, toModel: currentModel.label };
      }

      notify({
        title: "在对话过程中切换模型会降低性能表现。",
        tone: "info",
      });
      setModelSwitchWarningVisible(true);
      if (modelSwitchWarningTimerRef.current != null) {
        window.clearTimeout(modelSwitchWarningTimerRef.current);
      }
      modelSwitchWarningTimerRef.current = window.setTimeout(() => {
        setModelSwitchWarningVisible(false);
        modelSwitchWarningTimerRef.current = null;
      }, 2400);

      return {
        id: `${Date.now()}-${currentModel.id}`,
        sessionId: activeSessionId,
        fromModel: previousModel.label,
        toModel: currentModel.label,
      };
    });
  }, [activeSessionId, activeSessionIsStreaming, modelName, settings]);

  useEffect(() => {
    if (!activeSessionId || isEmpty) return;
    void loadReadThread(activeSessionId);
  }, [activeSessionId, activeSessionIsStreaming, isEmpty, loadReadThread]);

  const handleSend = (attachments: UserMessageContent[] = []) => {
    const text = inputText.trim();
    if ((!text && attachments.length === 0) || activeSessionIsStreaming) return;
    const pendingNoticeForSend = pendingModelChangeNotice;
    let clientMessageId: string | undefined;
    if (pendingNoticeForSend && activeSessionId && pendingNoticeForSend.sessionId === activeSessionId) {
      clientMessageId = genUiId("user");
      setPendingModelChangeNotice({
        ...pendingNoticeForSend,
        beforeUserMessageId: clientMessageId,
      });
    }
    shouldStickToBottomRef.current = true;
    setIsAtBottom(true);
    if (editingMessageId) {
      if (!text) return;
      void editAndResendMessage(editingMessageId, text);
      setEditingMessageId(null);
    } else {
      void sendMessage(text, attachments, clientMessageId);
    }
    setInputText("");
  };

  const handleEditMessage = (message: WorkflowMessageBlock) => {
    if (activeSessionIsStreaming || !message.user.trim()) return;
    setEditingMessageId(message.userMessageId ?? message.id);
    setInputText(message.user);
  };

  const handlePreviewRewind = async (message: WorkflowMessageBlock) => {
    if (!activeSessionId || activeSessionIsStreaming) return;
    const userMessageId = message.userMessageId ?? message.id;
    try {
      const preview = await rewindFiles(activeSessionId, userMessageId, { dryRun: true });
      if (!preview.canRewind) {
        notify({ title: "Cannot preview rewind", description: preview.error ?? "No checkpoint is available for this message.", tone: "warning" });
        return;
      }
      const files = preview.filesChanged ?? [];
      setRewindDialog({ message, preview, selectedFiles: files, applying: false });
    } catch (error) {
      notify({ title: "Rewind preview failed", description: error instanceof Error ? error.message : String(error), tone: "error" });
    }
  };

  const applyRewind = async () => {
    if (!rewindDialog || !activeSessionId) return;
    const userMessageId = rewindDialog.message.userMessageId ?? rewindDialog.message.id;
    setRewindDialog((state) => state ? { ...state, applying: true } : state);
    try {
      const result = await rewindFiles(activeSessionId, userMessageId, {
        dryRun: false,
        confirmedFiles: rewindDialog.selectedFiles,
      });
      if (!result.canRewind) {
        notify({ title: "Rewind was not applied", description: result.error ?? "The selected files could not be rewound.", tone: "warning" });
        setRewindDialog((state) => state ? { ...state, applying: false, preview: result } : state);
        return;
      }
      notify({ title: "Files rewound", description: `${result.filesChanged?.length ?? 0} file(s) updated`, tone: "success" });
      setRewindDialog(null);
    } catch (error) {
      notify({ title: "Rewind failed", description: error instanceof Error ? error.message : String(error), tone: "error" });
      setRewindDialog((state) => state ? { ...state, applying: false } : state);
    }
  };
  const handleCopyMessage = async (text: string) => {
    try {
      await copyToClipboard(text);
    } catch (error) {
      notify({ title: "Copy failed", description: error instanceof Error ? error.message : String(error), tone: "error" });
      throw error;
    }
  };

  const handleContextAction = async (action: ContextActionRequest["actions"][number]) => {
    if (!activeContextActionRequest) return;
    try {
      if (action === "switch_to_larger_model" && activeContextActionRequest.largerModel) {
        await setModel(activeContextActionRequest.largerModel.providerId, activeContextActionRequest.largerModel.modelId);
        clearContextActionRequest();
        notify({ title: "已切换到大上下文模型", description: activeContextActionRequest.largerModel.modelId, tone: "success" });
        return;
      }
      if (action === "create_small_model_branch" && activeSessionId) {
        await forkSession(activeSessionId);
        clearContextActionRequest();
        notify({ title: "已创建精简分支", tone: "success" });
        return;
      }
      if (action === "new_session") {
        await createSession();
        clearContextActionRequest();
        return;
      }
      if (action === "continue_anyway") {
        await continueContextAction();
      }
    } catch (error) {
      notify({ title: "上下文操作失败", description: error instanceof Error ? error.message : String(error), tone: "error" });
    }
  };

  const cancelEdit = () => {
    setEditingMessageId(null);
    setInputText("");
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const isModifierSend = event.key === "Enter" && event.metaKey;
    const isPlainEnter =
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey;
    const isControlledNewline =
      event.key === "Enter" && event.ctrlKey && !event.metaKey;

    if (event.key.toLowerCase() === "k" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      if (!activeSessionIsStreaming) setInputText("");
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

  return (
    <section className={`chat-page ${isEmpty ? "chat-page-empty" : ""} ${leftCollapsed ? "left-collapsed" : ""}`}>
      <div className="chat-header">
        <span>{formatSessionTitle(activeSession?.title)}</span>
        <button
          className="icon-button"
          type="button"
          onClick={onToggleRight}
          title={rightOpen ? "Hide right sidebar" : "Show right sidebar"}
          aria-label={rightOpen ? "Hide right sidebar" : "Show right sidebar"}
        >
          {rightOpen ? <Columns2 size={16} /> : <PanelRight size={16} />}
        </button>
      </div>

      <div className="messages-scroll scrollbar-thin" ref={scrollRef} onScroll={handleMessagesScroll}>
        <div className="messages-inner">
          {!isEmpty ? (
            <>
              {displayReadThread ? (
                <ReadThreadTurnList
                  readThread={displayReadThread}
                  isStreaming={activeSessionIsStreaming}
                  stateScopeKey={activeSessionId ?? "default"}
                  modelName={modelName}
                  onRegenerate={(message) => {
                    if (!activeSessionIsStreaming)
                      void regenerateMessage(message.userMessageId ?? message.id);
                  }}
                  onEditMessage={handleEditMessage}
                  onRewindMessage={(message) => void handlePreviewRewind(message)}
                  onCopyMessage={handleCopyMessage}
                  renderBeforeTurn={(message) =>
                    pendingModelChangeNotice?.sessionId === activeSessionId &&
                    pendingModelChangeNotice.beforeUserMessageId &&
                    message.userMessageId === pendingModelChangeNotice.beforeUserMessageId ? (
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
      <ScrollToBottomButton visible={!isEmpty && !isAtBottom} onClick={() => scrollToBottom("smooth")} />

      {rewindDialog ? (
        <RewindConfirmDialog
          state={rewindDialog}
          onClose={() => setRewindDialog(null)}
          onApply={() => void applyRewind()}
          onSelectionChange={(selectedFiles) => setRewindDialog((state) => state ? { ...state, selectedFiles } : state)}
        />
      ) : null}
      {isEmpty ? (
        <h1 className="empty-composer-prompt">
          我们应该在 {promptWorkspaceName} 中构建什么？
        </h1>
      ) : null}
      <ComposerShell
        input={inputText}
        isGenerating={activeSessionIsStreaming}
        selectedProvider={null}
        onInputChange={setInputText}
        onKeyDown={handleComposerKeyDown}
        onSend={handleSend}
        onStop={() => void abort(activeSessionId ?? undefined)}
        modelControl={<ModelSelector switchWarningVisible={modelSwitchWarningVisible} />}
        focusToken={editingMessageId}
        editingBanner={
          editingMessageId ? (
            <div className="composer-editing-banner">
              <span>正在编辑上一条消息，发送后会从这里重新生成</span>
              <button type="button" onClick={cancelEdit} aria-label="取消编辑">
                <X size={14} />
              </button>
            </div>
          ) : null
        }
        permissionPanel={
          permissionRequest ? (
            <PermissionRequestOverlay
              request={permissionRequest}
              onRespond={onPermissionRespond}
              variant="embedded"
            />
          ) : null
        }
      />
    </section>
  );
}

function RewindConfirmDialog({
  state,
  onClose,
  onApply,
  onSelectionChange,
}: {
  state: RewindDialogState;
  onClose: () => void;
  onApply: () => void;
  onSelectionChange: (selectedFiles: string[]) => void;
}) {
  const files = state.preview.filesChanged ?? [];
  const selected = new Set(state.selectedFiles);
  const toggleFile = (file: string) => {
    onSelectionChange(selected.has(file) ? state.selectedFiles.filter((item) => item !== file) : [...state.selectedFiles, file]);
  };
  const allSelected = files.length > 0 && state.selectedFiles.length === files.length;

  return (
    <div className="rewind-overlay" role="presentation" onMouseDown={onClose}>
      <section className="rewind-dialog" role="dialog" aria-modal="true" aria-label="Preview file rewind" onMouseDown={(event) => event.stopPropagation()}>
        <div className="rewind-dialog-head">
          <span className="rewind-dialog-icon"><RotateCcw size={16} /></span>
          <div>
            <h2>Preview file rewind</h2>
            <p>Select the files to restore to the checkpoint before this message.</p>
          </div>
          <button type="button" className="rewind-close" onClick={onClose} aria-label="Close rewind preview">
            <X size={15} />
          </button>
        </div>

        {state.preview.error ? <div className="rewind-error">{state.preview.error}</div> : null}

        <div className="rewind-select-row">
          <label>
            <input
              type="checkbox"
              checked={allSelected}
              disabled={files.length === 0 || state.applying}
              onChange={() => onSelectionChange(allSelected ? [] : files)}
            />
            <span>{files.length} file(s) available</span>
          </label>
          <small>{state.selectedFiles.length} selected</small>
        </div>

        <div className="rewind-file-list scrollbar-thin">
          {files.length ? files.map((file) => (
            <label className="rewind-file-item" key={file}>
              <input
                type="checkbox"
                checked={selected.has(file)}
                disabled={state.applying}
                onChange={() => toggleFile(file)}
              />
              <span>{file}</span>
            </label>
          )) : <div className="rewind-empty">No changed files were recorded for this checkpoint.</div>}
        </div>

        <div className="rewind-dialog-foot">
          <button type="button" onClick={onClose} disabled={state.applying}>Cancel</button>
          <button type="button" className="apply" onClick={onApply} disabled={state.applying || state.selectedFiles.length === 0}>
            {state.applying ? "Applying..." : "Apply selected files"}
          </button>
        </div>
      </section>
    </div>
  );
}

async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

function ContextActionCard({
  request,
  onDismiss,
  onAction,
}: {
  request: ContextActionRequest;
  onDismiss: () => void;
  onAction: (action: ContextActionRequest["actions"][number]) => void;
}) {
  const hasLargerModelAction = request.actions.includes("switch_to_larger_model") && Boolean(request.largerModel);
  const hasBranchAction = request.actions.includes("create_small_model_branch");
  const hasNewSessionAction = request.actions.includes("new_session");
  const hasContinueAction = request.actions.includes("continue_anyway");

  return (
    <section className="context-action-card" role="group" aria-labelledby="context-action-title">
      <button type="button" className="context-action-dismiss" onClick={onDismiss} aria-label="关闭上下文提示">
        <X size={14} />
      </button>
      <div className="context-action-main">
        <div className="context-action-copy">
          <h2 id="context-action-title">{request.title}</h2>
          <span>{request.detail ?? "当前会话接近模型上下文上限。"}</span>
        </div>
      </div>
      <div className="context-action-buttons" aria-label="上下文操作">
        {hasLargerModelAction ? (
          <button type="button" className="primary" onClick={() => onAction("switch_to_larger_model")}>
            <Maximize2 size={14} />
            切换到大模型
          </button>
        ) : null}
        {hasBranchAction ? (
          <button type="button" className={hasLargerModelAction ? undefined : "primary"} onClick={() => onAction("create_small_model_branch")}>
            <GitBranch size={14} />
            创建精简分支
          </button>
        ) : null}
        {hasNewSessionAction ? (
          <button type="button" className={hasLargerModelAction || hasBranchAction ? undefined : "primary"} onClick={() => onAction("new_session")}>
            <MessageSquarePlus size={14} />
            新会话
          </button>
        ) : null}
        {hasContinueAction ? (
          <button type="button" onClick={() => onAction("continue_anyway")}>
            <Play size={14} />
            继续发送
          </button>
        ) : null}
      </div>
    </section>
  );
}
