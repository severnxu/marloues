import {
  ChevronDown,
  FileText,
  Link,
  MessageSquareText,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ComposerAttachment } from "./composer-attachments";
import type { WorkflowImagePreview } from "../";

function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kilobytes = bytes / 1024;
  return `${kilobytes >= 10 ? kilobytes.toFixed(0) : kilobytes.toFixed(1)} KB`;
}

function fileAttachmentMeta(
  attachment: Extract<ComposerAttachment, { kind: "file" }>,
): string {
  const extension = attachment.name.includes(".")
    ? attachment.name.split(".").pop()?.toUpperCase()
    : undefined;
  const type =
    extension ||
    attachment.mimeType.replace(/^text\//, "").toUpperCase() ||
    "文件";
  return `${type} · ${formatAttachmentSize(attachment.size)}`;
}

function browserCommentTarget(
  attachment: Extract<ComposerAttachment, { kind: "browser-comment" }>,
): string {
  if (attachment.payload.targetType === "region") return "页面区域";
  return attachment.payload.tagName
    ? attachment.payload.tagName.toLowerCase()
    : "页面元素";
}

function BrowserReviewAttachmentGroup({
  attachments,
  onRemove,
  onPreviewImage,
}: {
  attachments: Extract<ComposerAttachment, { kind: "browser-comment" }>[];
  onRemove: (id: string) => void;
  onPreviewImage: (image: WorkflowImagePreview) => void;
}) {
  const [open, setOpen] = useState(false);
  const groupRef = useRef<HTMLDivElement>(null);
  const count = attachments.length;
  const label = `页面批注，${count} 条`;
  const leadAttachment = attachments.find(
    (attachment) => attachment.payload.screenshotDataUrl,
  );

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!groupRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="composer-browser-review" ref={groupRef}>
      <button
        type="button"
        className="composer-browser-review-trigger"
        aria-label={label}
        aria-expanded={open}
        aria-controls="composer-browser-review-details"
        onClick={() => setOpen((value) => !value)}
      >
        {leadAttachment?.payload.screenshotDataUrl ? (
          <img
            className="composer-browser-review-thumbnail"
            src={leadAttachment.payload.screenshotDataUrl}
            alt=""
          />
        ) : (
          <MessageSquareText size={14} aria-hidden="true" />
        )}
        <span>{count} 条</span>
        <ChevronDown
          size={13}
          aria-hidden="true"
          className={open ? "is-open" : undefined}
        />
      </button>
      <button
        type="button"
        className="composer-browser-review-remove-all"
        onClick={() =>
          attachments.forEach((attachment) => onRemove(attachment.id))
        }
        aria-label="移除全部页面批注"
        title="移除全部页面批注"
      >
        <X size={12} />
      </button>

      {open ? (
        <section
          className="composer-browser-review-popover"
          id="composer-browser-review-details"
          aria-label={label}
        >
          <header className="composer-browser-review-header">
            <span>页面批注</span>
            <span>{count} 条</span>
          </header>
          <div className="composer-browser-review-list">
            {attachments.map((attachment, index) => {
              const target = browserCommentTarget(attachment);
              const preview = attachment.payload.screenshotDataUrl;
              return (
                <article
                  className="composer-browser-review-item"
                  key={attachment.id}
                >
                  <span className="composer-browser-review-index">
                    {index + 1}
                  </span>
                  {preview ? (
                    <button
                      type="button"
                      className="composer-browser-review-image"
                      onClick={() =>
                        onPreviewImage({
                          src: preview,
                          name: `页面批注 ${index + 1}`,
                        })
                      }
                      aria-label={`预览第 ${index + 1} 条页面批注截图`}
                    >
                      <img src={preview} alt={`第 ${index + 1} 条页面批注`} />
                    </button>
                  ) : (
                    <span className="composer-browser-review-image is-empty">
                      <MessageSquareText size={16} aria-hidden="true" />
                    </span>
                  )}
                  <span className="composer-browser-review-copy">
                    <span className="composer-browser-review-context">
                      <code>{target}</code>
                      <span>
                        {attachment.payload.text || attachment.payload.ref}
                      </span>
                    </span>
                    <span className="composer-browser-review-note">
                      {attachment.payload.comment}
                    </span>
                    {Object.keys(attachment.payload.styleEdits ?? {}).length >
                    0 ? (
                      <span className="composer-browser-review-edits">
                        已编辑{" "}
                        {
                          Object.keys(attachment.payload.styleEdits ?? {})
                            .length
                        }{" "}
                        项样式
                      </span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    className="composer-browser-review-remove"
                    onClick={() => onRemove(attachment.id)}
                    aria-label={`移除第 ${index + 1} 条页面注释`}
                    title="移除页面注释"
                  >
                    <X size={13} />
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}

export function ComposerAttachmentChips({
  attachments,
  onRemove,
  onPreviewImage,
}: {
  attachments: ComposerAttachment[];
  onRemove: (id: string) => void;
  onPreviewImage: (image: WorkflowImagePreview) => void;
}) {
  if (attachments.length === 0) return null;
  const browserComments = attachments.filter(
    (
      attachment,
    ): attachment is Extract<ComposerAttachment, { kind: "browser-comment" }> =>
      attachment.kind === "browser-comment",
  );
  const firstBrowserCommentId = browserComments[0]?.id;

  return (
    <div className="composer-attachments" aria-label="已添加的附件">
      {attachments.map((attachment) => {
        if (attachment.kind === "image") {
          return (
            <span
              className="composer-chip composer-chip-image"
              key={attachment.id}
            >
              <button
                type="button"
                className="composer-chip-image-btn"
                onClick={() =>
                  onPreviewImage({
                    src: attachment.dataUrl,
                    name: attachment.name || "聊天图片",
                  })
                }
                title={attachment.name || "预览图片"}
                aria-label={
                  "预览图片" + (attachment.name ? `：${attachment.name}` : "")
                }
              >
                <img
                  src={attachment.dataUrl}
                  alt={attachment.name || "待发送图片"}
                />
              </button>
              <button
                type="button"
                className="composer-chip-remove"
                onClick={() => onRemove(attachment.id)}
                aria-label="移除图片"
                title="移除图片"
              >
                <X size={12} />
              </button>
            </span>
          );
        }

        if (attachment.kind === "url") {
          return (
            <span
              className="composer-chip composer-chip-url"
              key={attachment.id}
              title={attachment.url}
            >
              <a
                className="composer-chip-link"
                href={attachment.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Link size={14} aria-hidden="true" />
                <span className="composer-chip-copy">
                  <span className="composer-chip-name">{attachment.url}</span>
                  <span className="composer-chip-meta">链接</span>
                </span>
              </a>
              <button
                type="button"
                className="composer-chip-remove"
                onClick={() => onRemove(attachment.id)}
                aria-label="移除链接"
                title="移除链接"
              >
                <X size={12} />
              </button>
            </span>
          );
        }

        if (attachment.kind === "file") {
          return (
            <span
              className="composer-chip composer-chip-file"
              key={attachment.id}
              title={attachment.name}
            >
              <FileText size={14} aria-hidden="true" />
              <span className="composer-chip-copy">
                <span className="composer-chip-name">{attachment.name}</span>
                <span className="composer-chip-meta">
                  {fileAttachmentMeta(attachment)}
                </span>
              </span>
              <button
                type="button"
                className="composer-chip-remove"
                onClick={() => onRemove(attachment.id)}
                aria-label="移除文件"
                title="移除文件"
              >
                <X size={12} />
              </button>
            </span>
          );
        }

        if (attachment.kind === "mention") {
          return (
            <span className="composer-skill-token" key={attachment.id}>
              <FileText size={14} aria-hidden="true" />
              <span className="composer-skill-token-name">
                @{attachment.name}
              </span>
              <button
                type="button"
                className="composer-skill-token-remove"
                onClick={() => onRemove(attachment.id)}
                aria-label="移除文件引用"
                title="移除文件引用"
              >
                <X size={12} />
              </button>
            </span>
          );
        }

        if (attachment.kind === "browser-comment") {
          if (attachment.id !== firstBrowserCommentId) return null;
          return (
            <BrowserReviewAttachmentGroup
              attachments={browserComments}
              key={attachment.id}
              onRemove={onRemove}
              onPreviewImage={onPreviewImage}
            />
          );
        }

        return (
          <span className="composer-skill-token" key={attachment.id}>
            <Wrench size={14} aria-hidden="true" />
            <span className="composer-skill-token-name">
              {attachment.skill.name}
            </span>
            <button
              type="button"
              className="composer-skill-token-remove"
              onClick={() => onRemove(attachment.id)}
              aria-label="移除技能"
              title="移除技能"
            >
              <X size={12} />
            </button>
          </span>
        );
      })}
    </div>
  );
}
