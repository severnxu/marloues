import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type ReactNode,
} from "react";
import {
  Bot,
  Check,
  ChevronDown,
  CircleAlert,
  Paperclip,
  Send,
  Shield,
  Square,
} from "lucide-react";
import { notify } from "@/lib/notifications";
import type { Provider, UserMessageContent } from "../../types";
import {
  WorkflowImageLightbox,
  type WorkflowImagePreview,
} from "./ImageLightbox";
import {
  ComposerAttachmentList,
  type ComposerAttachment,
} from "./ComposerAttachmentList";

type ComposerAccessLevel = "default" | "review" | "full";
const MAX_ATTACHMENTS = 6;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

const accessOptions: Array<{
  level: ComposerAccessLevel;
  label: string;
  icon: typeof Shield;
}> = [
  { level: "default", label: "默认权限", icon: Shield },
  { level: "review", label: "自动审查", icon: Bot },
  { level: "full", label: "完全访问", icon: CircleAlert },
];

interface WorkflowComposerShellProps {
  input: string;
  isGenerating: boolean;
  selectedProvider: Provider | null;
  onInputChange: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: (attachments?: UserMessageContent[]) => void;
  onStop: () => void;
  editingBanner?: ReactNode;
  modelControl?: ReactNode;
  focusToken?: string | null;
  placeholder?: string;
}

export function WorkflowComposerShell({
  input,
  isGenerating,
  selectedProvider,
  onInputChange,
  onKeyDown,
  onSend,
  onStop,
  editingBanner,
  modelControl,
  focusToken,
  placeholder = "交给 Marloues 一个本地任务...",
}: WorkflowComposerShellProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const accessMenuRef = useRef<HTMLDivElement>(null);
  const fallbackModelMenuRef = useRef<HTMLDivElement>(null);
  const slashPopoverRef = useRef<HTMLDivElement>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const [accessLevel, setAccessLevel] =
    useState<ComposerAccessLevel>("default");
  const [accessOpen, setAccessOpen] = useState(false);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [previewImage, setPreviewImage] = useState<WorkflowImagePreview | null>(
    null,
  );
  const activeAccess =
    accessOptions.find((option) => option.level === accessLevel) ??
    accessOptions[0];
  const ActiveAccessIcon = activeAccess.icon;

  useEffect(() => {
    setSlashOpen(input.trim() === "/");
  }, [input]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 136)}px`;
  }, [input]);

  useEffect(() => {
    if (!focusToken) return;
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });
  }, [focusToken]);

  useEffect(() => {
    if (!accessOpen && !modelOpen && !slashOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (accessMenuRef.current?.contains(target)) return;
      if (fallbackModelMenuRef.current?.contains(target)) return;
      if (slashPopoverRef.current?.contains(target)) return;

      setAccessOpen(false);
      setModelOpen(false);
      setSlashOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [accessOpen, modelOpen, slashOpen]);

  const fileToImageAttachment = useCallback(
    (file: File): Promise<Extract<ComposerAttachment, { kind: "image" }>> =>
      new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result !== "string") {
            reject(new Error("Unable to read image"));
            return;
          }
          resolve({
            kind: "image",
            id: crypto.randomUUID(),
            name: file.name || "clipboard-image",
            mimeType: file.type || "image/png",
            dataUrl: reader.result,
            size: file.size,
          });
        };
        reader.onerror = () =>
          reject(reader.error ?? new Error("Unable to read image"));
        reader.readAsDataURL(file);
      }),
    [],
  );

  const addFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const availableSlots = Math.max(0, MAX_ATTACHMENTS - attachments.length);
      if (availableSlots === 0) {
        notify({
          title: "附件数量已达上限",
          description: `最多一次添加 ${MAX_ATTACHMENTS} 个附件。`,
          tone: "warning",
        });
        return;
      }
      const accepted = files
        .slice(0, availableSlots)
        .filter((file) => file.size <= MAX_ATTACHMENT_BYTES);
      const skippedCount = files.length - accepted.length;
      if (skippedCount > 0) {
        notify({
          title: "部分附件未添加",
          description: "单个附件不能超过 8 MB，且一次最多添加 6 个。",
          tone: "warning",
        });
      }
      if (accepted.length === 0) return;
      try {
        const nextAttachments = await Promise.all(
          accepted.map((file) =>
            file.type.startsWith("image/")
              ? fileToImageAttachment(file)
              : Promise.resolve<ComposerAttachment>({
                  kind: "file",
                  id: crypto.randomUUID(),
                  name: file.name || "attachment",
                  mimeType: file.type || "application/octet-stream",
                  size: file.size,
                }),
          ),
        );
        setAttachments((prev) =>
          [...prev, ...nextAttachments].slice(0, MAX_ATTACHMENTS),
        );
      } catch (error) {
        notify({
          title: "读取附件失败",
          description: error instanceof Error ? error.message : String(error),
          tone: "error",
        });
      }
    },
    [attachments.length, fileToImageAttachment],
  );

  const handleFileAttach = useCallback(() => {
    attachmentInputRef.current?.click();
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleAttachmentInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = "";
      void addFiles(files);
    },
    [addFiles],
  );

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const files = Array.from(event.clipboardData.items)
        .filter(
          (item) => item.kind === "file" && item.type.startsWith("image/"),
        )
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file));
      if (files.length === 0) return;
      event.preventDefault();
      void addFiles(files);
    },
    [addFiles],
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLFormElement>) => {
      const files = Array.from(event.dataTransfer.files ?? []);
      if (files.length === 0) return;
      event.preventDefault();
      void addFiles(files);
    },
    [addFiles],
  );

  const sendAttachments = useCallback(
    (): UserMessageContent[] =>
      attachments.map((attachment) =>
        attachment.kind === "image"
          ? { type: "image", url: attachment.dataUrl }
          : { type: "mention", name: attachment.name, path: attachment.name },
      ),
    [attachments],
  );

  const slashCommands = [
    { command: "/model", label: "切换模型" },
    { command: "/permissions", label: "权限模式" },
    { command: "/sandbox", label: "Sandbox" },
    { command: "/status", label: "运行状态" },
    { command: "/compact", label: "压缩上下文" },
    { command: "/resume", label: "恢复会话" },
    { command: "/fork", label: "Fork 会话" },
    { command: "/diff", label: "查看变更" },
  ];

  return (
    <div className="composer-wrap">
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
          if (!input.trim() && attachments.length === 0) return;
          onSend(sendAttachments());
          setAttachments([]);
        }}
        className="composer input-glow"
      >
        <input
          ref={attachmentInputRef}
          type="file"
          multiple
          className="composer-file-input"
          onChange={handleAttachmentInputChange}
          tabIndex={-1}
          aria-hidden="true"
        />
        <>
          {editingBanner}
          <ComposerAttachmentList
            attachments={attachments}
            onRemove={removeAttachment}
            onPreview={setPreviewImage}
          />
          <div className="composer-input">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(event) => onInputChange(event.target.value)}
              onKeyDown={(event) => {
                const shouldSend =
                  event.key === "Enter" && !event.shiftKey && !event.ctrlKey;
                if (shouldSend && attachments.length > 0) {
                  event.preventDefault();
                  onSend(sendAttachments());
                  setAttachments([]);
                  return;
                }
                onKeyDown(event);
              }}
              onPaste={handlePaste}
              placeholder={placeholder}
              style={{ height: "auto" }}
              onInput={(event) => {
                const target = event.target as HTMLTextAreaElement;
                target.style.height = "0px";
                target.style.height = `${Math.min(target.scrollHeight, 136)}px`;
              }}
            />
          </div>

          <div className="composer-toolbar">
            <button
              type="button"
              className="tool-button"
              aria-label="添加图片或文件"
              title="添加图片或文件"
              onClick={handleFileAttach}
            >
              <Paperclip size={16} />
            </button>

            <div className="composer-menu" ref={accessMenuRef}>
              <button
                type="button"
                onClick={() => setAccessOpen((value) => !value)}
                className={`mode-button access-${accessLevel}`}
              >
                <ActiveAccessIcon size={16} />
                <span>{activeAccess.label}</span>
                <ChevronDown size={14} />
              </button>
              {accessOpen && (
                <div className="composer-popover access-popover" role="menu">
                  {accessOptions.map(({ level, label, icon: Icon }) => (
                    <button
                      key={level}
                      type="button"
                      role="menuitemradio"
                      aria-checked={accessLevel === level}
                      aria-current={accessLevel === level ? "true" : undefined}
                      onClick={() => {
                        setAccessLevel(level);
                        setAccessOpen(false);
                      }}
                      className={`${accessLevel === level ? "active" : ""} access-${level}`}
                    >
                      <Icon size={16} />
                      <span>{label}</span>
                      <Check className="access-check" size={15} />
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="composer-spacer" />

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

            {isGenerating ? (
              <button type="button" className="send stop" onClick={onStop}>
                <Square size={15} />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim() && attachments.length === 0}
                className="send"
              >
                <Send size={16} />
              </button>
            )}
          </div>

          {slashOpen && (
            <div
              className="absolute left-3 bottom-[calc(100%+8px)] z-70 w-[min(340px,calc(100vw-64px))] overflow-hidden rounded-[10px] border border-line bg-panel p-1 shadow-lg"
              ref={slashPopoverRef}
            >
              <div className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-text-muted">
                输入 / 打开命令
              </div>
              {slashCommands.map((item) => (
                <button
                  key={item.command}
                  type="button"
                  className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left transition hover:bg-muted"
                  onClick={() => {
                    onInputChange(`${item.command} `);
                    textareaRef.current?.focus();
                  }}
                >
                  <span className="font-mono text-[12px] font-bold text-accent">
                    {item.command}
                  </span>
                  <small className="truncate text-[11px] text-text-muted">
                    {item.label}
                  </small>
                </button>
              ))}
            </div>
          )}
        </>
        <WorkflowImageLightbox
          image={previewImage}
          onClose={() => setPreviewImage(null)}
        />
      </form>
    </div>
  );
}
