import { useMemo, useState, type ReactNode } from "react";
import type { WorkflowUserMessageContent } from "@shared/workflow-read-thread-contract";
import { formatConversationTime } from "@shared/conversation-time";
import {
  ConversationCheckIcon,
  ConversationCommentIcon,
  ConversationCopyIcon,
  ConversationEditIcon,
  ConversationFileIcon,
  ConversationSelectedTextIcon,
  ConversationSkillIcon,
  ConversationWebIcon,
} from "../conversation-icons";
import {
  WorkflowImageLightbox,
  type WorkflowImagePreview,
} from "../activity/ImageLightbox";
import {
  workflowUserMessageCopyText,
  workflowUserMessagePresentation,
  type WorkflowUserMessageAttachment,
  type WorkflowUserMessageImage,
} from "./user-message-contract";

interface Props {
  text?: string;
  content?: WorkflowUserMessageContent[];
  createdAt?: number;
  onCopy?: (text: string) => void | Promise<void>;
  onEdit?: () => void;
}

export function WorkflowUserMessage({
  text = "",
  content = [],
  createdAt,
  onCopy,
  onEdit,
}: Props) {
  const presentation = useMemo(
    () => workflowUserMessagePresentation(content, text),
    [content, text],
  );
  const [previewImage, setPreviewImage] = useState<WorkflowImagePreview | null>(
    null,
  );
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const copyText = workflowUserMessageCopyText(presentation);
  const imageGallery = useMemo(
    () => presentation.images.map(imagePreview),
    [presentation.images],
  );

  const copyMessage = async () => {
    if (!copyText) return;
    try {
      if (onCopy) await onCopy(copyText);
      else await copyToClipboard(copyText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_200);
    } catch {
      setCopied(false);
    }
  };

  if (!presentation.protocolContent.length) return null;
  const isLong = userMessageLikelyExceedsCollapsedLines(presentation.text);

  return (
    <>
      <div className="workflow-user-message" data-kind="user-message">
        {presentation.images.length ? (
          <div
            className="workflow-user-message-images hide-scrollbar"
            data-kind="user-message-images"
          >
            {presentation.images.map((image, index) => (
              <UserImage
                key={`${image.type}-${imageSourceKey(image)}-${index}`}
                image={image}
                onOpenImage={setPreviewImage}
              />
            ))}
          </div>
        ) : null}

        {presentation.attachments.length ? (
          <div
            className="workflow-user-message-attachments hide-scrollbar"
            data-kind="user-message-attachments"
          >
            {presentation.attachments.map((attachment, index) => (
              <UserAttachmentPill
                key={`${attachment.kind}-${attachmentKey(attachment)}-${index}`}
                attachment={attachment}
              />
            ))}
          </div>
        ) : null}

        {presentation.text ? (
          <div className="workflow-user-message-bubble-row">
            <div
              className="user-message-bubble"
              data-kind="user-message-bubble"
              data-user-message-bubble="true"
              tabIndex={0}
              onDoubleClick={onEdit}
            >
              <span
                className={`workflow-user-message-text${expanded ? " is-expanded" : ""}`}
                aria-hidden={!expanded && isLong}
              >
                {presentation.text}
              </span>
              {!expanded && isLong ? (
                <span className="sr-only">{presentation.text}</span>
              ) : null}
              {isLong ? (
                <button
                  type="button"
                  className="workflow-user-message-expand"
                  aria-expanded={expanded}
                  onClick={() => setExpanded((value) => !value)}
                >
                  {expanded ? "收起" : "展开"}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {presentation.text && (createdAt || copyText || onEdit) ? (
          <div
            className="workflow-user-message-meta"
            data-kind="user-message-meta"
          >
            {createdAt ? (
              <time dateTime={new Date(createdAt).toISOString()}>
                {formatConversationTime(createdAt)}
              </time>
            ) : null}
            {copyText ? (
              <UserAction
                title={copied ? "已复制" : "复制这条消息"}
                onClick={() => void copyMessage()}
                icon={
                  copied ? <ConversationCheckIcon /> : <ConversationCopyIcon />
                }
              />
            ) : null}
            {onEdit ? (
              <UserAction
                title="编辑这条消息"
                onClick={onEdit}
                icon={<ConversationEditIcon />}
              />
            ) : null}
          </div>
        ) : null}
      </div>
      <WorkflowImageLightbox
        image={previewImage}
        images={imageGallery}
        onNavigate={setPreviewImage}
        onClose={() => setPreviewImage(null)}
      />
    </>
  );
}

function UserImage({
  image,
  onOpenImage,
}: {
  image: WorkflowUserMessageImage;
  onOpenImage: (image: WorkflowImagePreview) => void;
}) {
  const preview = imagePreview(image);
  return (
    <span className="workflow-user-image-shell">
      <button
        type="button"
        className="user-image-chip"
        title="打开图片预览"
        aria-label={`打开图片预览：${preview.name}`}
        data-image-detail={image.detail}
        onClick={() => onOpenImage(preview)}
      >
        <img src={preview.src} alt={preview.name} />
      </button>
      <span className="workflow-user-image-tooltip" role="tooltip">
        <strong>{preview.name}</strong>
        <small>点击放大 · {image.detail || "auto"}</small>
      </span>
    </span>
  );
}

function UserAttachmentPill({
  attachment,
}: {
  attachment: WorkflowUserMessageAttachment;
}) {
  const content = attachmentPresentation(attachment);
  const body = (
    <>
      <span className="workflow-user-content-icon">{content.icon}</span>
      <span className="workflow-user-content-label">{content.label}</span>
      {content.detail ? (
        <span className="workflow-user-content-detail">{content.detail}</span>
      ) : null}
    </>
  );
  if (attachment.kind === "url") {
    return (
      <a
        className="workflow-user-attachment-pill is-link"
        href={attachment.url}
        target="_blank"
        rel="noopener noreferrer"
        title={`打开 ${attachment.url}`}
      >
        {body}
      </a>
    );
  }
  return <span className="workflow-user-attachment-pill">{body}</span>;
}

function attachmentPresentation(attachment: WorkflowUserMessageAttachment): {
  icon: ReactNode;
  label: string;
  detail?: string;
} {
  const iconClass = "workflow-conversation-icon";
  switch (attachment.kind) {
    case "parent-context":
      return {
        icon: <ConversationCommentIcon className={iconClass} />,
        label: "父任务上下文",
        detail: attachment.sourceThreadId,
      };
    case "prior-conversation":
      return {
        icon: <ConversationCommentIcon className={iconClass} />,
        label: `${attachment.count} 个会话引用`,
      };
    case "mcp-app-context":
      return {
        icon: <ConversationWebIcon className={iconClass} />,
        label: "应用上下文",
        detail: attachment.app,
      };
    case "application":
      return {
        icon: <ConversationWebIcon className={iconClass} />,
        label: attachment.name,
        detail: attachment.path,
      };
    case "file":
      return {
        icon: <ConversationFileIcon className={iconClass} />,
        label: attachment.name,
        detail: attachment.path
          ? basename(attachment.path)
          : attachment.mimeType,
      };
    case "url":
      return {
        icon: <ConversationWebIcon className={iconClass} />,
        label: attachment.title || hostLabel(attachment.url),
        detail: attachment.url,
      };
    case "skill":
      return {
        icon: <ConversationSkillIcon className={iconClass} />,
        label: attachment.displayName || attachment.name,
        detail: attachment.path ? basename(attachment.path) : undefined,
      };
    case "mention":
      return {
        icon: <ConversationFileIcon className={iconClass} />,
        label: `@${attachment.name}`,
        detail: attachment.path ? basename(attachment.path) : undefined,
      };
    case "pull-request-merge":
      return {
        icon: <ConversationFileIcon className={iconClass} />,
        label: `${attachment.count} 个合并任务`,
      };
    case "pull-request-checks":
      return {
        icon: <ConversationFileIcon className={iconClass} />,
        label: `${attachment.count} 个失败检查`,
      };
    case "pull-request-conflict":
      return {
        icon: <ConversationFileIcon className={iconClass} />,
        label: `${attachment.count} 个合并冲突`,
      };
    case "response-annotations":
      return {
        icon: <ConversationSelectedTextIcon className={iconClass} />,
        label: `${attachment.count} 条回复批注`,
      };
    case "diff-comments":
      return {
        icon: <ConversationCommentIcon className={iconClass} />,
        label: `${attachment.count} 条代码评论`,
      };
    case "browser-comments":
      return {
        icon: <ConversationCommentIcon className={iconClass} />,
        label: `${attachment.count} 条浏览器评论`,
      };
    case "selected-text":
      return {
        icon: <ConversationSelectedTextIcon className={iconClass} />,
        label: `${attachment.count} 条选中文本`,
      };
  }
}

function UserAction({
  title,
  icon,
  onClick,
}: {
  title: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="workflow-user-message-action"
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}

function userMessageLikelyExceedsCollapsedLines(value: string): boolean {
  return value.split("\n").length > 20 || value.length > 760;
}

function imagePreview(image: WorkflowUserMessageImage): WorkflowImagePreview {
  return {
    src: image.type === "image" ? image.url : localImageSrc(image.path),
    name: image.type === "image" ? "附加图片" : basename(image.path),
  };
}

function localImageSrc(path: string): string {
  if (/^(file|https?):\/\//i.test(path)) return path;
  return `file:///${path.replace(/\\/g, "/")}`;
}

function basename(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

function imageSourceKey(image: WorkflowUserMessageImage): string {
  return image.type === "image" ? image.url : image.path;
}

function attachmentKey(attachment: WorkflowUserMessageAttachment): string {
  if ("path" in attachment && attachment.path) return attachment.path;
  if ("url" in attachment) return attachment.url;
  if ("name" in attachment) return attachment.name;
  if ("count" in attachment) return String(attachment.count);
  if ("sourceThreadId" in attachment)
    return attachment.sourceThreadId ?? attachment.kind;
  if ("app" in attachment) return attachment.app ?? attachment.kind;
  return attachment.kind;
}

function hostLabel(value: string): string {
  try {
    return new URL(value).hostname || value;
  } catch {
    return value;
  }
}

async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand("copy");
  } finally {
    textarea.remove();
  }
}

export { workflowUserMessagePresentation, workflowUserMessageCopyText };

/** Backward-compatible exports kept for existing consumers. */
export function formatUserMessageTime(timestamp?: number): string {
  return typeof timestamp === "number" && Number.isFinite(timestamp)
    ? formatConversationTime(timestamp)
    : "--:--";
}

export function userMessageClipboardText(
  parts: WorkflowUserMessageContent[],
): string {
  return workflowUserMessageCopyText(workflowUserMessagePresentation(parts));
}
