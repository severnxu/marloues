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
  X,
} from "lucide-react";
import { notify } from "@/lib/notifications";
import type { Provider, UserMessageContent } from "../../types";
import {
  WorkflowImageLightbox,
  type WorkflowImagePreview,
} from "./ImageLightbox";

type ComposerAccessLevel = "default" | "review" | "full";
type ComposerImageAttachment = {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  size: number;
};

const MAX_IMAGE_ATTACHMENTS = 6;
const MAX_IMAGE_ATTACHMENT_BYTES = 8 * 1024 * 1024;

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
  permissionPanel?: ReactNode;
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
  permissionPanel,
  modelControl,
  focusToken,
  placeholder = "交给 Marloues 一个本地任务...",
}: WorkflowComposerShellProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const accessMenuRef = useRef<HTMLDivElement>(null);
  const fallbackModelMenuRef = useRef<HTMLDivElement>(null);
  const slashPopoverRef = useRef<HTMLDivElement>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const [accessLevel, setAccessLevel] =
    useState<ComposerAccessLevel>("default");
  const [accessOpen, setAccessOpen] = useState(false);
  const [attachments, setAttachments] = useState<ComposerImageAttachment[]>([]);
  const [previewImage, setPreviewImage] = useState<WorkflowImagePreview | null>(
    null,
  );
  const activeAccess =
    accessOptions.find((option) => option.level === accessLevel) ??
    accessOptions[0];
  const ActiveAccessIcon = activeAccess.icon;
  const hasPermissionPanel = Boolean(permissionPanel);

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
    (file: File): Promise<ComposerImageAttachment> =>
      new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result !== "string") {
            reject(new Error("Unable to read image"));
            return;
          }
          resolve({
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

  const addImageFiles = useCallback(
    async (files: File[]) => {
      const imageFiles = files.filter((file) => file.type.startsWith("image/"));
      if (imageFiles.length === 0) return;
      const availableSlots = Math.max(
        0,
        MAX_IMAGE_ATTACHMENTS - attachments.length,
      );
      if (availableSlots === 0) {
        notify({
          title: "图片数量已达上限",
          description: `最多一次发送 ${MAX_IMAGE_ATTACHMENTS} 张图片。`,
          tone: "warning",
        });
        return;
      }
      const accepted = imageFiles
        .slice(0, availableSlots)
        .filter((file) => file.size <= MAX_IMAGE_ATTACHMENT_BYTES);
      const skippedCount = imageFiles.length - accepted.length;
      if (skippedCount > 0) {
        notify({
          title: "部分图片未添加",
          description: "单张图片不能超过 8 MB，且一次最多发送 6 张。",
          tone: "warning",
        });
      }
      if (accepted.length === 0) return;
      try {
        const nextAttachments = await Promise.all(
          accepted.map(fileToImageAttachment),
        );
        setAttachments((prev) =>
          [...prev, ...nextAttachments].slice(0, MAX_IMAGE_ATTACHMENTS),
        );
      } catch (error) {
        notify({
          title: "读取图片失败",
          description: error instanceof Error ? error.message : String(error),
          tone: "error",
        });
      }
    },
    [attachments.length, fileToImageAttachment],
  );

  const handleFileAttach = useCallback(() => {
    imageInputRef.current?.click();
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleImageInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = "";
      void addImageFiles(files);
    },
    [addImageFiles],
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
      void addImageFiles(files);
    },
    [addImageFiles],
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLFormElement>) => {
      const files = Array.from(event.dataTransfer.files ?? []);
      if (!files.some((file) => file.type.startsWith("image/"))) return;
      event.preventDefault();
      void addImageFiles(files);
    },
    [addImageFiles],
  );

  const sendAttachments = useCallback(
    (): UserMessageContent[] =>
      attachments.map((attachment) => ({
        type: "image",
        url: attachment.dataUrl,
      })),
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
          if (hasPermissionPanel) return;
          if (!input.trim() && attachments.length === 0) return;
          onSend(sendAttachments());
          setAttachments([]);
        }}
        className={`composer input-glow ${hasPermissionPanel ? "permission-mode" : ""}`}
      >
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          multiple
          className="composer-file-input"
          onChange={handleImageInputChange}
          tabIndex={-1}
          aria-hidden="true"
        />
        {hasPermissionPanel ? (
          <div className="composer-permission-slot">{permissionPanel}</div>
        ) : (
          <>
            {editingBanner}
            {attachments.length > 0 && (
              <div className="composer-attachments" aria-label="待发送图片">
                {attachments.map((attachment, index) => (
                  <div className="composer-attachment" key={attachment.id}>
                    <button
                      type="button"
                      className="composer-attachment-preview"
                      onClick={() =>
                        setPreviewImage({
                          src: attachment.dataUrl,
                          name: attachment.name || "聊天图片",
                        })
                      }
                      title={attachment.name || "预览图片"}
                      aria-label={`预览图片${attachment.name ? `：${attachment.name}` : ""}`}
                    >
                      <img
                        src={attachment.dataUrl}
                        alt={attachment.name || "待发送图片"}
                      />
                    </button>
                    <button
                      type="button"
                      className="composer-attachment-remove"
                      onClick={() => removeAttachment(index)}
                      aria-label="移除图片"
                      title="移除图片"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="composer-input">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(event) => onInputChange(event.target.value)}
                onKeyDown={onKeyDown}
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
                aria-label="添加图片"
                title="添加图片"
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
                        aria-current={
                          accessLevel === level ? "true" : undefined
                        }
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
        )}
        <WorkflowImageLightbox
          image={previewImage}
          onClose={() => setPreviewImage(null)}
        />
      </form>
    </div>
  );
}
