import { FileText, X } from "lucide-react";
import type { WorkflowImagePreview } from "./ImageLightbox";

export type ComposerAttachment =
  | {
      kind: "image";
      id: string;
      name: string;
      mimeType: string;
      dataUrl: string;
      size: number;
    }
  | {
      kind: "file";
      id: string;
      name: string;
      mimeType: string;
      size: number;
    };

export function ComposerAttachmentList({
  attachments,
  onRemove,
  onPreview,
}: {
  attachments: ComposerAttachment[];
  onRemove: (index: number) => void;
  onPreview: (preview: WorkflowImagePreview) => void;
}) {
  if (attachments.length === 0) return null;

  return (
    <div className="composer-attachments" aria-label="已添加的附件">
      {attachments.map((attachment, index) => (
        <div
          className={`composer-attachment composer-attachment-${attachment.kind}`}
          key={attachment.id}
        >
          {attachment.kind === "image" ? (
            <button
              type="button"
              className="composer-attachment-preview"
              onClick={() =>
                onPreview({
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
          ) : (
            <div className="composer-file-card" title={attachment.name}>
              <span className="composer-file-icon">
                <FileText size={18} />
              </span>
              <span className="composer-file-copy">
                <strong>{attachment.name}</strong>
                <small>{fileTypeLabel(attachment)}</small>
              </span>
            </div>
          )}
          <button
            type="button"
            className="composer-attachment-remove"
            onClick={() => onRemove(index)}
            aria-label={`移除附件：${attachment.name}`}
            title="移除附件"
          >
            <X size={11} />
          </button>
        </div>
      ))}
    </div>
  );
}

function fileTypeLabel(
  attachment: Extract<ComposerAttachment, { kind: "file" }>,
): string {
  const extension = attachment.name.split(".").pop()?.trim();
  const type =
    extension && extension !== attachment.name
      ? extension.toUpperCase()
      : attachment.mimeType
        ? (attachment.mimeType.split("/").pop()?.toUpperCase() ?? "FILE")
        : "FILE";
  return `${type} · ${formatBytes(attachment.size)}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
