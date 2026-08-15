import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { FolderOpen, TriangleAlert, X } from "lucide-react";
import type { SkillImportPreview } from "@shared/types";

export function SkillLocalImportDialog({
  preview,
  busy,
  error,
  onSelect,
  onImport,
  onClose,
}: {
  preview: SkillImportPreview | null;
  busy: boolean;
  error: string | null;
  onSelect: () => void;
  onImport: () => void;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, onClose]);

  return createPortal(
    <div
      className="plugin-import-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
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
          <strong id="plugin-import-title">本地导入插件</strong>
          <button
            ref={closeRef}
            className="icon-button compact"
            type="button"
            aria-label="关闭本地导入"
            disabled={busy}
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        </header>

        <div className="plugin-import-content">
          <div className="plugin-import-field">
            <span>插件类型</span>
            <div className="plugin-import-type">Skill</div>
          </div>
          <div className="plugin-import-field">
            <span>本地目录</span>
            <button
              className="plugin-path-picker"
              type="button"
              disabled={busy}
              onClick={onSelect}
            >
              <FolderOpen aria-hidden="true" />
              <span>{preview?.path ?? "选择包含插件清单的目录"}</span>
            </button>
          </div>
          <section
            className={`plugin-manifest-preview${preview ? " is-ready" : ""}`}
          >
            <header>
              <span>清单预览</span>
              <small>{preview ? "检测成功" : "等待选择目录"}</small>
            </header>
            <dl>
              <div>
                <dt>名称</dt>
                <dd>{preview?.name ?? "Workspace Helper"}</dd>
              </div>
              <div>
                <dt>版本</dt>
                <dd>{preview?.version ?? "0.1.0"}</dd>
              </div>
              <div>
                <dt>入口</dt>
                <dd>{preview?.entry ?? "SKILL.md"}</dd>
              </div>
            </dl>
          </section>
          <p className="plugin-import-risk">
            <TriangleAlert aria-hidden="true" />
            本地插件由当前用户维护。导入前请确认来源，并检查清单声明的文件与网络访问权限。
          </p>
          {error ? (
            <p className="plugin-import-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <footer>
          <button type="button" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button
            className="plugin-import-submit"
            type="button"
            disabled={!preview || busy}
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
