import { FileText, Link, Wrench, X } from "lucide-react";
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
