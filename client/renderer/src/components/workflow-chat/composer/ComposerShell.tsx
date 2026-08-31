import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Settings2 } from "lucide-react";
import {
  browserCommentAttachment,
  MAX_ATTACHMENTS,
  skillAttachment,
} from "./composer-attachments";
import type { SlashCommandItem } from "../../../types";
import { WorkflowImageLightbox, type WorkflowImagePreview } from "../";
import { SlashCommandPopover } from "./SlashCommandPopover";
import { QueuedSteersPanel } from "../";
import { ContextUsageRing } from "../";
import { FullAccessConfirmDialog } from "./SandboxInstallBanner";
import {
  type WorkflowComposerShellProps,
  COMPOSER_TEXTAREA_MIN_HEIGHT,
  COMPOSER_TEXTAREA_WITH_ATTACHMENTS_MIN_HEIGHT,
  COMPOSER_TEXTAREA_MAX_HEIGHT,
  securityModeOptions,
} from "./composer-types";
import { ComposerTaskProgress } from "./ComposerTaskProgress";
import { ComposerAttachmentChips } from "./ComposerAttachmentChips";
import { useComposerAttachments } from "./useComposerAttachments";
import { useSecurityModeGate } from "./useSandboxGate";
import { useComposerDockSafeArea } from "./useComposerDockSafeArea";
import { CONVERSATION_PAGE_CONTRACT } from "@shared/conversation-page-contract";
import { CONVERSATION_ICONS } from "../conversation-icon-contract";
import {
  ComposerSuggestionPopover,
  type ComposerSuggestion,
} from "./ComposerSuggestionPopover";
import { replaceComposerSuggestion } from "./composer-contract";
import { useComposerSuggestions } from "./useComposerSuggestions";

const COMPOSER_ICONS = CONVERSATION_ICONS.composer;

export function WorkflowComposerShell({
  conversationKey,
  input,
  incomingBrowserComment,
  isGenerating,
  securityMode: controlledSecurityMode,
  selectedProvider,
  onInputChange,
  onKeyDown,
  onSend,
  onStop,
  onSecurityModeChange,
  onOpenSecuritySettings,
  permissionPanel,
  emptyHeader,
  runtimeControl,
  modelControl,
  placeholder = CONVERSATION_PAGE_CONTRACT.composer.placeholder,
  slashCommands,
  skills = [],
  taskProgress,
  contextUsage,
  usage,
  fileChangeSummary,
  onFileChangeSummaryClick,
  pendingSteers = [],
  steerQueuePaused = false,
  onResumeSteerQueue,
  onApplyPendingSteer,
  onCancelPendingSteer,
  onEditPendingSteer,
  onReorderPendingSteer,
}: WorkflowComposerShellProps) {
  const dockRef = useComposerDockSafeArea();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const securityMenuRef = useRef<HTMLDivElement>(null);
  const fallbackModelMenuRef = useRef<HTMLDivElement>(null);
  const slashPopoverRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const previousPermissionPanelRef = useRef(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashFilter, setSlashFilter] = useState("");
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
  const [suggestionSelectedIndex, setSuggestionSelectedIndex] = useState(0);
  const [caret, setCaret] = useState(0);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState<WorkflowImagePreview | null>(
    null,
  );

  const {
    attachments,
    setAttachments,
    removeAttachment,
    handleFileInputChange,
    handlePaste,
    handleInputChange,
    handleDrop,
    sendAttachments,
    fileAccept,
  } = useComposerAttachments(onInputChange);

  useEffect(() => {
    setAttachments([]);
    setPreviewImage(null);
  }, [conversationKey, setAttachments]);

  useEffect(() => {
    if (!incomingBrowserComment) return;
    setAttachments((previous) => {
      const additions = incomingBrowserComment.payloads
        .filter(
          (payload) =>
            !previous.some(
              (attachment) =>
                attachment.kind === "browser-comment" &&
                attachment.payload.commentId === payload.commentId &&
                attachment.payload.pageUrl === payload.pageUrl,
            ),
        )
        .slice(0, Math.max(0, MAX_ATTACHMENTS - previous.length))
        .map(browserCommentAttachment);
      return additions.length > 0 ? [...previous, ...additions] : previous;
    });
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [incomingBrowserComment, setAttachments]);
  const {
    query: composerQuery,
    items: composerSuggestions,
    attachmentFor,
  } = useComposerSuggestions({ input, caret, skills });

  useEffect(
    () => setSuggestionSelectedIndex(0),
    [composerQuery?.kind, composerQuery?.query],
  );

  const {
    securityMode,
    fullAccessConfirmationOpen,
    handleSecurityModeSelect,
    handleFullAccessConfirm,
    handleFullAccessCancel,
  } = useSecurityModeGate(onSecurityModeChange, controlledSecurityMode);

  const activeSecurityMode =
    securityModeOptions.find((option) => option.mode === securityMode) ??
    securityModeOptions[0];
  const ActiveSecurityIcon = activeSecurityMode.icon;
  const hasPermissionPanel = Boolean(permissionPanel);
  const textareaMinHeight =
    attachments.length > 0
      ? COMPOSER_TEXTAREA_WITH_ATTACHMENTS_MIN_HEIGHT
      : COMPOSER_TEXTAREA_MIN_HEIGHT;

  useEffect(() => {
    // Open slash menu when input starts with "/" and the first token has no space.
    // The trailing `$` anchor is essential: after selecting a command the input
    // becomes `/cmd ` (with a space). Without `$` the regex still matches the
    // `/cmd` prefix and reopens the popover, making it look like selection failed.
    const match = input.match(/^\/(\S*)$/);
    if (match) {
      setSlashOpen(true);
      setSlashFilter(match[1]);
      setSlashSelectedIndex(0);
    } else {
      setSlashOpen(false);
    }
  }, [input]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(
      Math.max(textarea.scrollHeight, textareaMinHeight),
      COMPOSER_TEXTAREA_MAX_HEIGHT,
    )}px`;
  }, [input, textareaMinHeight]);

  useEffect(() => {
    const wasShowingPermission = previousPermissionPanelRef.current;
    previousPermissionPanelRef.current = hasPermissionPanel;
    if (!wasShowingPermission || hasPermissionPanel) return;

    const frame = window.requestAnimationFrame(() =>
      textareaRef.current?.focus(),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [hasPermissionPanel]);

  useEffect(() => {
    if (!securityOpen && !contextOpen && !modelOpen && !slashOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (securityMenuRef.current?.contains(target)) return;
      if (contextMenuRef.current?.contains(target)) return;
      if (fallbackModelMenuRef.current?.contains(target)) return;
      if (slashPopoverRef.current?.contains(target)) return;

      setSecurityOpen(false);
      setContextOpen(false);
      setModelOpen(false);
      setSlashOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [contextOpen, modelOpen, securityOpen, slashOpen]);

  const filteredSlashCommands = useMemo<SlashCommandItem[]>(() => {
    const items = slashCommands ?? [];
    const q = slashFilter.toLowerCase().trim();
    const categoryOrder: SlashCommandItem["category"][] = ["skill", "builtin"];
    const matched = q
      ? items.filter(
          (item) =>
            item.command.toLowerCase().includes(q) ||
            item.label.toLowerCase().includes(q),
        )
      : items;
    return [...matched].sort((a, b) => {
      if (q) {
        const aStarts = a.command.toLowerCase().startsWith("/" + q) ? 0 : 1;
        const bStarts = b.command.toLowerCase().startsWith("/" + q) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
      }
      const ca = categoryOrder.indexOf(a.category);
      const cb = categoryOrder.indexOf(b.category);
      if (ca !== cb) return ca - cb;
      return a.command.localeCompare(b.command);
    });
  }, [slashCommands, slashFilter]);

  const canSubmit = input.trim().length > 0 || attachments.length > 0;

  const activateContextTrigger = useCallback(
    (trigger: "$" | "@" | "/") => {
      const textarea = textareaRef.current;
      const start = textarea?.selectionStart ?? input.length;
      const end = textarea?.selectionEnd ?? start;
      const needsSpace = start > 0 && !/\s/u.test(input[start - 1] ?? "");
      const token = `${needsSpace ? " " : ""}${trigger}`;
      const value = `${input.slice(0, start)}${token}${input.slice(end)}`;
      const nextCaret = start + token.length;
      onInputChange(value);
      setCaret(nextCaret);
      setContextOpen(false);
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(nextCaret, nextCaret);
      });
    },
    [input, onInputChange],
  );

  const handleSlashSelect = useCallback(
    (item: SlashCommandItem) => {
      setSlashOpen(false);
      if (item.category === "skill") {
        // Skills become solid chips in the composer, not text
        setAttachments((prev) => {
          if (prev.length >= MAX_ATTACHMENTS) return prev;
          return [...prev, skillAttachment(item.label, item.command)];
        });
        onInputChange("");
        requestAnimationFrame(() => textareaRef.current?.focus());
        return;
      }
      // Builtin commands remain text-based
      onInputChange(`${item.command} `);
      requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        textarea.focus();
        textarea.setSelectionRange(
          textarea.value.length,
          textarea.value.length,
        );
      });
    },
    [onInputChange, setAttachments],
  );

  const handleSuggestionSelect = useCallback(
    (suggestion: ComposerSuggestion) => {
      if (!composerQuery) return;
      setAttachments((previous) => {
        if (previous.length >= MAX_ATTACHMENTS) return previous;
        return [...previous, attachmentFor(suggestion)];
      });
      const next = replaceComposerSuggestion(input, composerQuery, "");
      onInputChange(next.value);
      setCaret(next.caret);
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(next.caret, next.caret);
      });
    },
    [attachmentFor, composerQuery, input, onInputChange, setAttachments],
  );

  const handleTextareaKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // IME composition in progress (e.g. pinyin Enter to pick a candidate):
      // let the input method own the keystroke. Must run before slash-menu
      // handling, otherwise confirming a candidate triggers slash selection.
      if (event.nativeEvent.isComposing || event.keyCode === 229) {
        return;
      }
      if (slashOpen && filteredSlashCommands.length > 0) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setSlashSelectedIndex((i) => (i + 1) % filteredSlashCommands.length);
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setSlashSelectedIndex(
            (i) =>
              (i - 1 + filteredSlashCommands.length) %
              filteredSlashCommands.length,
          );
          return;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault();
          handleSlashSelect(filteredSlashCommands[slashSelectedIndex]);
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          setSlashOpen(false);
          return;
        }
      }
      if (composerQuery && composerSuggestions.length > 0) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const delta = event.key === "ArrowDown" ? 1 : -1;
          setSuggestionSelectedIndex(
            (index) =>
              (index + delta + composerSuggestions.length) %
              composerSuggestions.length,
          );
          return;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault();
          handleSuggestionSelect(composerSuggestions[suggestionSelectedIndex]);
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          setCaret(-1);
          return;
        }
      }
      // Plain Enter / Cmd+Enter → send with current attachments.
      // 必须在这里处理而不是 page 层 keydown：page 不知道 composer 的 attachments，
      // 纯附件场景下不传 attachments 会被 handleSend 里的 `!text && attachments.length === 0` 拦掉。
      // page 仍然处理 Ctrl+Enter（换行）、Esc（中断）、Cmd+K（清空）等。
      if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey) {
        if (canSubmit) {
          event.preventDefault();
          onSend(sendAttachments());
        }
        return;
      }
      onKeyDown(event);
    },
    [
      slashOpen,
      filteredSlashCommands,
      slashSelectedIndex,
      handleSlashSelect,
      composerQuery,
      composerSuggestions,
      suggestionSelectedIndex,
      handleSuggestionSelect,
      canSubmit,
      onSend,
      sendAttachments,
      onKeyDown,
    ],
  );

  return (
    <div ref={dockRef} className="composer-wrap">
      {emptyHeader ? (
        <div className="composer-empty-header">{emptyHeader}</div>
      ) : null}
      {hasPermissionPanel ? (
        <div className="composer-permission-slot">{permissionPanel}</div>
      ) : (
        <>
          {taskProgress?.length || fileChangeSummary?.filesChanged ? (
            <ComposerTaskProgress
              tasks={taskProgress}
              fileChangeSummary={fileChangeSummary}
              onFileChangeSummaryClick={onFileChangeSummaryClick}
            />
          ) : null}
          <div
            className={`composer-steer-stack${pendingSteers.length > 0 ? " has-pending-steers" : ""}`}
          >
            {/* 排队 steer 是独立的上层面板，主输入框从其下方承接。 */}
            <QueuedSteersPanel
              pendingSteers={pendingSteers}
              paused={steerQueuePaused}
              onApply={onApplyPendingSteer}
              onCancel={onCancelPendingSteer}
              onEdit={onEditPendingSteer}
              onReorder={onReorderPendingSteer}
              onResume={onResumeSteerQueue}
            />
            <form
              onDragOver={(event) => {
                if (
                  Array.from(event.dataTransfer.items ?? []).some(
                    (item) => item.kind === "file",
                  )
                ) {
                  event.preventDefault();
                }
              }}
              onDrop={handleDrop}
              onSubmit={(event) => {
                event.preventDefault();
                if (!canSubmit) return;
                onSend(sendAttachments());
                setAttachments([]);
              }}
              className="composer input-glow"
            >
              <input
                ref={imageInputRef}
                type="file"
                accept={fileAccept}
                multiple
                className="composer-file-input"
                onChange={handleFileInputChange}
                tabIndex={-1}
                aria-hidden="true"
              />
              <div
                className={`composer-input${attachments.length > 0 ? " has-chips" : ""}`}
              >
                <ComposerAttachmentChips
                  attachments={attachments}
                  onRemove={removeAttachment}
                  onPreviewImage={setPreviewImage}
                />
                <textarea
                  ref={textareaRef}
                  rows={2}
                  value={input}
                  onChange={handleInputChange}
                  onClick={(event) =>
                    setCaret(event.currentTarget.selectionStart)
                  }
                  onKeyUp={(event) =>
                    setCaret(event.currentTarget.selectionStart)
                  }
                  onKeyDown={handleTextareaKeyDown}
                  onPaste={handlePaste}
                  placeholder={placeholder}
                  style={{ height: "auto" }}
                  onInput={(event) => {
                    const target = event.target as HTMLTextAreaElement;
                    target.style.height = "0px";
                    target.style.height = `${Math.min(
                      Math.max(target.scrollHeight, textareaMinHeight),
                      COMPOSER_TEXTAREA_MAX_HEIGHT,
                    )}px`;
                  }}
                />
              </div>

              <div className="composer-toolbar">
                <div className="composer-menu" ref={contextMenuRef}>
                  <button
                    type="button"
                    className="tool-button"
                    aria-label="添加文件及更多内容"
                    title="添加文件及更多内容"
                    aria-haspopup="menu"
                    aria-expanded={contextOpen}
                    data-composer-navigation-target="add-context"
                    onClick={() => setContextOpen((value) => !value)}
                  >
                    <COMPOSER_ICONS.addContext
                      size={16}
                      aria-hidden="true"
                      data-icon-contract="add-context"
                    />
                  </button>
                  {contextOpen ? (
                    <div
                      className="composer-popover add-context-popover"
                      role="menu"
                      aria-label="添加内容"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setContextOpen(false);
                          imageInputRef.current?.click();
                        }}
                      >
                        <COMPOSER_ICONS.uploadFile
                          size={16}
                          aria-hidden="true"
                          data-icon-contract="composer-upload-file"
                        />
                        <span>上传文件</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => activateContextTrigger("$")}
                      >
                        <COMPOSER_ICONS.skill
                          size={16}
                          aria-hidden="true"
                          data-icon-contract="composer-skill"
                        />
                        <span>添加 Skill</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => activateContextTrigger("@")}
                      >
                        <COMPOSER_ICONS.workspaceFile
                          size={16}
                          aria-hidden="true"
                          data-icon-contract="composer-workspace-file"
                        />
                        <span>引用工作区文件</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => activateContextTrigger("/")}
                      >
                        <COMPOSER_ICONS.command
                          size={16}
                          aria-hidden="true"
                          data-icon-contract="composer-command"
                        />
                        <span>使用命令</span>
                      </button>
                    </div>
                  ) : null}
                </div>

                <div className="composer-menu" ref={securityMenuRef}>
                  <button
                    type="button"
                    aria-label={`权限：${activeSecurityMode.label}`}
                    aria-haspopup="menu"
                    aria-expanded={securityOpen}
                    onClick={() => setSecurityOpen((value) => !value)}
                    className={`mode-button security-${securityMode}`}
                  >
                    <ActiveSecurityIcon size={16} />
                    <span>{activeSecurityMode.label}</span>
                    <ChevronDown size={14} />
                  </button>
                  {securityOpen && (
                    <div
                      className="composer-popover security-mode-popover"
                      role="menu"
                      aria-label="权限模式"
                    >
                      <div className="security-popover-title">
                        应如何批准 Marloues 操作？
                      </div>
                      {securityModeOptions.map(
                        ({ mode, label, description, icon: Icon }) => (
                          <button
                            key={mode}
                            type="button"
                            role="menuitemradio"
                            aria-checked={securityMode === mode}
                            aria-current={
                              securityMode === mode ? "true" : undefined
                            }
                            onClick={() => {
                              setSecurityOpen(false);
                              handleSecurityModeSelect(mode);
                            }}
                            className={`${securityMode === mode ? "active" : ""} security-${mode}`}
                          >
                            <Icon size={16} />
                            <span className="security-option-copy">
                              <strong>{label}</strong>
                              <small>{description}</small>
                            </span>
                            <Check className="access-check" size={15} />
                          </button>
                        ),
                      )}
                      <div className="security-popover-separator" />
                      <button
                        type="button"
                        role="menuitem"
                        className="security-settings-link"
                        onClick={() => {
                          setSecurityOpen(false);
                          onOpenSecuritySettings?.();
                        }}
                      >
                        <Settings2 size={16} />
                        <span>权限与沙箱设置</span>
                      </button>
                    </div>
                  )}
                </div>

                <div className="composer-spacer" />

                {contextUsage ? (
                  <ContextUsageRing snapshot={contextUsage} usage={usage} />
                ) : null}

                {runtimeControl ? (
                  <div className="composer-menu runtime-menu">
                    {runtimeControl}
                  </div>
                ) : null}

                <div
                  className="composer-menu model-menu"
                  ref={fallbackModelMenuRef}
                >
                  {modelControl ?? (
                    <>
                      <button
                        type="button"
                        onClick={() => setModelOpen((value) => !value)}
                        className="model-chip"
                      >
                        <span>custom</span>
                        <strong>{selectedProvider?.name ?? "默认模型"}</strong>
                        <ChevronDown size={14} />
                      </button>

                      {modelOpen && (
                        <div className="composer-popover model-popover">
                          <div className="popover-title">选择模型</div>
                          <button
                            type="button"
                            className="model-option active"
                            onClick={() => setModelOpen(false)}
                          >
                            <span className="model-avatar">
                              {(selectedProvider?.name ?? "M")[0]}
                            </span>
                            <span>
                              <strong>
                                {selectedProvider?.name ?? "默认模型"}
                              </strong>
                              <small>
                                {selectedProvider?.model ?? "当前 Provider"}
                              </small>
                            </span>
                            <Check size={16} />
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {isGenerating && !canSubmit ? (
                  <button type="button" className="send stop" onClick={onStop}>
                    <COMPOSER_ICONS.stop
                      size={12}
                      fill="currentColor"
                      strokeWidth={0}
                      data-icon-contract="composer-stop"
                    />
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!canSubmit}
                    className={`send ${isGenerating ? "steer-submit" : ""}`}
                    aria-label={isGenerating ? "发送追加消息" : "发送消息"}
                    title={isGenerating ? "发送追加消息" : "发送消息"}
                  >
                    <COMPOSER_ICONS.send
                      size={15}
                      data-icon-contract="composer-send"
                    />
                  </button>
                )}
              </div>

              {slashOpen && filteredSlashCommands.length > 0 && (
                <SlashCommandPopover
                  items={filteredSlashCommands}
                  selectedIndex={slashSelectedIndex}
                  onSelect={handleSlashSelect}
                  onClose={() => setSlashOpen(false)}
                  popoverRef={slashPopoverRef}
                />
              )}
              {composerQuery && composerSuggestions.length > 0 ? (
                <ComposerSuggestionPopover
                  items={composerSuggestions}
                  selectedIndex={suggestionSelectedIndex}
                  onSelect={handleSuggestionSelect}
                />
              ) : null}
              <WorkflowImageLightbox
                image={previewImage}
                onClose={() => setPreviewImage(null)}
              />
            </form>
          </div>
        </>
      )}
      {fullAccessConfirmationOpen ? (
        <FullAccessConfirmDialog
          onConfirm={handleFullAccessConfirm}
          onCancel={handleFullAccessCancel}
        />
      ) : null}
    </div>
  );
}
