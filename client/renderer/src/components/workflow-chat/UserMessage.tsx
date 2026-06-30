import { useState, type ReactNode } from "react";
import { FilePenLine, FileText, History, RefreshCw, Wrench } from "lucide-react";
import type { WorkflowUserMessageContent } from "../../../../shared/workflow-read-thread-contract";
import { WorkflowImageLightbox, type WorkflowImagePreview } from "./ImageLightbox";

interface Props {
  text?: string;
  content?: WorkflowUserMessageContent[];
  onEdit?: () => void;
  onRegenerate?: () => void;
  onRewind?: () => void;
}

export function WorkflowUserMessage({
  text = "",
  content = [],
  onEdit,
  onRegenerate,
  onRewind,
}: Props) {
  const parts = content.length
    ? content
    : text
      ? [{ type: "text" as const, text }]
      : [];
  const [previewImage, setPreviewImage] = useState<WorkflowImagePreview | null>(null);

  if (!parts.length) return null;

  return (
    <>
      <div
        className="group mb-4 flex justify-end max-[720px]:mb-3"
        data-kind="user-message"
      >
        <div className="flex max-w-[78%] flex-col items-end gap-1.5">
          <div className="user-message-bubble rounded-[16px] bg-muted px-3.5 py-1.5 text-[14px] leading-[1.55] text-text-normal" data-kind="user-message-bubble">
            <div className="grid gap-2">
              {parts.map((part, index) => (
                <UserContentPart key={`${part.type}-${index}`} part={part} onOpenImage={setPreviewImage} />
              ))}
            </div>
          </div>
          {onEdit || onRegenerate || onRewind ? (
            <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              {onEdit ? (
                <UserAction
                  title="Edit message"
                  onClick={onEdit}
                  icon={<FilePenLine className="h-3.5 w-3.5" />}
                />
              ) : null}
              {onRegenerate ? (
                <UserAction
                  title="Regenerate"
                  onClick={onRegenerate}
                  icon={<RefreshCw className="h-3.5 w-3.5" />}
                />
              ) : null}
              {onRewind ? (
                <UserAction
                  title="Preview file rewind"
                  onClick={onRewind}
                  icon={<History className="h-3.5 w-3.5" />}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <WorkflowImageLightbox image={previewImage} onClose={() => setPreviewImage(null)} />
    </>
  );
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
      className="grid h-6 w-6 place-items-center rounded-md text-text-subtle transition hover:bg-muted hover:text-text-normal"
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}

function UserContentPart({ part, onOpenImage }: { part: WorkflowUserMessageContent; onOpenImage: (image: WorkflowImagePreview) => void }) {
  if (part.type === "text")
    return <span className="whitespace-pre-wrap">{part.text}</span>;

  if (part.type === "image" || part.type === "localImage") {
    const src = part.type === "image" ? part.url : localImageSrc(part.path);
    const name = part.type === "image" ? "Attached image" : basename(part.path);
    return (
      <button
        type="button"
        className="block max-w-full cursor-zoom-in rounded-[10px] p-0 text-left"
        title="Open image preview"
        aria-label={`Open image preview: ${name}`}
        onClick={() => onOpenImage({ src, name })}
      >
        <img
          src={src}
          alt={name}
          className="max-h-[260px] max-w-full rounded-[10px] object-contain"
        />
      </button>
    );
  }

  if (part.type === "skill") {
    return (
      <UserContentChip
        icon={<Wrench className="h-3.5 w-3.5" />}
        label={part.name}
        detail={part.path}
      />
    );
  }

  return (
    <UserContentChip
      icon={<FileText className="h-3.5 w-3.5" />}
      label={`@${part.name}`}
      detail={part.path}
    />
  );
}

function UserContentChip({
  icon,
  label,
  detail,
}: {
  icon: ReactNode;
  label: string;
  detail?: string;
}) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-[12px] leading-4 text-text-muted">
      <span className="shrink-0 text-text-subtle">{icon}</span>
      <span className="truncate text-text-normal">{label}</span>
      {detail ? (
        <span className="truncate text-text-subtle">{basename(detail)}</span>
      ) : null}
    </span>
  );
}

function localImageSrc(path: string): string {
  if (/^(file|https?):\/\//i.test(path)) return path;
  return `file:///${path.replace(/\\/g, "/")}`;
}

function basename(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}
