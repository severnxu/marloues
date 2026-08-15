import { useId } from "react";
import { FileText } from "lucide-react";
import { PatchDiff } from "@pierre/diffs/react";
import { useThemeStore } from "@/stores/theme-store";
import {
  DIFF_VIEW_SCROLL_CSS,
  normalizePatchForDiffs,
} from "@/components/diff";
import { shortPermissionPath } from "./permission-request-format";

export function PermissionFilePreview({
  path,
  diffPatch,
}: {
  path: string;
  diffPatch?: string;
}) {
  const popoverId = useId();
  const diffThemeType = useThemeStore((state) =>
    state.isDark ? "dark" : "light",
  );
  const patch = diffPatch ? normalizePatchForDiffs(diffPatch, path) : "";
  const fileLabel = (
    <>
      <span className="permission-file-badge">{fileExtension(path)}</span>
      <span className="permission-file-label">{shortPermissionPath(path)}</span>
    </>
  );

  return (
    <div className={`permission-file-preview${patch ? " has-diff" : ""}`}>
      {patch ? (
        <button
          type="button"
          className="permission-file-trigger"
          title={path}
          aria-label={`预览 ${shortPermissionPath(path)} 的变更`}
          aria-describedby={popoverId}
        >
          {fileLabel}
        </button>
      ) : (
        <span className="permission-file-trigger" title={path}>
          {fileLabel}
        </span>
      )}
      {patch ? (
        <div
          id={popoverId}
          className="permission-file-diff-popover"
          role="tooltip"
        >
          <div className="permission-file-diff-head">
            <FileText size={14} aria-hidden="true" />
            <span>{shortPermissionPath(path)}</span>
          </div>
          <div className="permission-file-diff-body">
            <PatchDiff
              patch={patch}
              className="permission-file-diff-view"
              disableWorkerPool
              options={{
                themeType: diffThemeType,
                diffStyle: "unified",
                diffIndicators: "bars",
                lineDiffType: "word-alt",
                overflow: "scroll",
                stickyHeader: false,
                hunkSeparators: "line-info",
                unsafeCSS: DIFF_VIEW_SCROLL_CSS,
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function fileExtension(path: string): string {
  const name = shortPermissionPath(path);
  const extension = name.includes(".") ? name.split(".").at(-1) : "file";
  return (extension || "file").slice(0, 4).toUpperCase();
}
