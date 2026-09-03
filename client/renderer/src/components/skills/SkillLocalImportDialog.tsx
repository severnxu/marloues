import { useEffect, useRef, useState, type DragEvent } from "react";
import { createPortal } from "react-dom";
import {
  FileArchive,
  FileText,
  FolderOpen,
  LoaderCircle,
  TriangleAlert,
  UploadCloud,
  X,
} from "lucide-react";
import type { SkillImportPreview } from "@shared/types";

export function SkillLocalImportDialog({
  preview,
  busy,
  inspecting,
  error,
  onSelect,
  onDrop,
  onImport,
  onClose,
}: {
  preview: SkillImportPreview | null;
  busy: boolean;
  inspecting: boolean;
  error: string | null;
  onSelect: (kind: "file" | "directory") => void;
  onDrop: (files: File[]) => void;
  onImport: () => void;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [dragging, setDragging] = useState(false);
  const blocked = busy || inspecting;

  useEffect(() => {
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !blocked) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [blocked, onClose]);

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (blocked) return;
    onDrop(Array.from(event.dataTransfer.files));
  };

  return createPortal(
    <div
      className="plugin-import-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !blocked) onClose();
      }}
    >
      <section
        className="plugin-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="plugin-import-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <strong id="plugin-import-title">导入本地 Skill</strong>
          <button
            ref={closeRef}
            className="icon-button compact"
            type="button"
            aria-label="关闭本地导入"
            disabled={blocked}
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        </header>

        <div className="plugin-import-content">
          <div
            className={`plugin-import-dropzone${
              dragging ? " is-dragging" : ""
            }${preview ? " is-ready" : ""}`}
            onDragEnter={(event) => {
              event.preventDefault();
              if (!blocked) setDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                setDragging(false);
              }
            }}
            onDrop={handleDrop}
          >
            <span className="plugin-import-dropzone-icon" aria-hidden="true">
              {inspecting ? (
                <LoaderCircle className="is-spinning" />
              ) : (
                <UploadCloud />
              )}
            </span>
            <strong>
              {inspecting
                ? "正在检查 Skill…"
                : dragging
                  ? "松开即可检查"
                  : "拖入 Skill 文件夹、ZIP 或 SKILL.md"}
            </strong>
            <p>
              文件夹适合本地开发，ZIP 适合完整分发，SKILL.md 适合单文件 Skill。
            </p>
            <div className="plugin-import-pickers">
              <button
                type="button"
                disabled={blocked}
                onClick={() => onSelect("file")}
              >
                <FileArchive aria-hidden="true" />
                选择文件
              </button>
              <button
                type="button"
                disabled={blocked}
                onClick={() => onSelect("directory")}
              >
                <FolderOpen aria-hidden="true" />
                选择文件夹
              </button>
            </div>
          </div>

          {preview ? (
            <section className="plugin-manifest-preview is-ready">
              <header>
                <span>导入预览</span>
                <small>
                  {preview.replacesExisting ? "将覆盖同名 Skill" : "检查通过"}
                </small>
              </header>
              <div className="plugin-import-source-path" title={preview.path}>
                {preview.sourceKind === "archive" ? (
                  <FileArchive aria-hidden="true" />
                ) : preview.sourceKind === "manifest" ? (
                  <FileText aria-hidden="true" />
                ) : (
                  <FolderOpen aria-hidden="true" />
                )}
                <span>{preview.path}</span>
              </div>
              <dl>
                <div>
                  <dt>名称</dt>
                  <dd>{preview.name}</dd>
                </div>
                <div>
                  <dt>版本</dt>
                  <dd>{preview.version ?? "未声明"}</dd>
                </div>
                <div>
                  <dt>内容</dt>
                  <dd>
                    {sourceKindLabel(preview.sourceKind)} · {preview.fileCount}{" "}
                    个文件 · {formatFileSize(preview.totalBytes)}
                  </dd>
                </div>
                <div>
                  <dt>入口</dt>
                  <dd>{preview.entry}</dd>
                </div>
              </dl>
            </section>
          ) : null}
          <p className="plugin-import-risk">
            <TriangleAlert aria-hidden="true" />
            导入只会安装到全局 Skill
            库，不会自动对任何项目启用。请在项目配置中决定是否使用。
          </p>
          {error ? (
            <p className="plugin-import-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <footer>
          <button type="button" disabled={blocked} onClick={onClose}>
            取消
          </button>
          <button
            className="plugin-import-submit"
            type="button"
            disabled={!preview || blocked}
            onClick={onImport}
          >
            {busy ? "导入中..." : "导入"}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function sourceKindLabel(kind: SkillImportPreview["sourceKind"]): string {
  if (kind === "archive") return "ZIP 压缩包";
  if (kind === "manifest") return "单个 SKILL.md";
  return "Skill 文件夹";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
