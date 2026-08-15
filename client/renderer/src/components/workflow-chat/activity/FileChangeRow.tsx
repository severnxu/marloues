import { useEffect, useRef, useState } from "react";
import { Check, Copy, FileText, ShieldCheck } from "lucide-react";
import { PatchDiff } from "@pierre/diffs/react";
import type { FileDiffMetadata } from "@pierre/diffs/react";
import type { WorkflowTurnItem } from "../../../../../shared/adapters/workflow-messages-to-read-thread";
import { useThemeStore } from "../../../stores/theme-store";
import { useInspectorStore } from "../../../stores/inspector-store";
import {
  DIFF_VIEW_SCROLL_CSS,
  normalizePatchForDiffs,
} from "../../diff/patch-helpers";
import { WorkflowActivityRow, WorkflowInlineDots } from "./ActivityRow";
import { workflowStatusIsRunning } from "../";

type FileChangeItemModel = Extract<WorkflowTurnItem, { type: "fileChange" }>;
type DiffLine = {
  kind: "add" | "remove" | "meta" | "context";
  prefix: string;
  text: string;
};

interface Props {
  item: FileChangeItemModel;
}

export function WorkflowFileChangeRow({ item }: Props) {
  const [open, setOpen] = useState(false);
  const files = item.changes.map((change) => change.path).filter(Boolean);
  const running = workflowStatusIsRunning(item.status);
  const label =
    item.status === "failed" || item.status === "error"
      ? "编辑失败"
      : running
        ? "正在编辑"
        : "已编辑";
  const patchLines = item.changes.flatMap((change) =>
    patchPreviewLines(change.diff?.text ?? ""),
  );
  const stats = patchStats(patchLines);
  const hasDetail = files.length > 1 || patchLines.length > 0;
  const failed = item.status === "failed" || item.status === "error";

  return (
    <WorkflowActivityRow
      activityKind="fileChange"
      icon={<FileText />}
      iconTone={failed ? "danger" : "muted"}
      label={
        <>
          {label}
          {running ? <WorkflowInlineDots /> : null}
        </>
      }
      meta={
        <>
          <span className="workflow-activity-file-target">
            {fileChangeTargetLabel(files)}
          </span>
          <InlineDiffStats added={stats.added} removed={stats.removed} />
        </>
      }
      hasDetail={hasDetail}
      open={open}
      onToggle={() => setOpen((value) => !value)}
      detail={<FileDetail changes={item.changes} />}
    />
  );
}

function FileDetail({ changes }: { changes: FileChangeItemModel["changes"] }) {
  return (
    <div className="workflow-file-change-details workflow-activity-detail-surface">
      {changes.map((change, index) => (
        <PatchPreviewCard
          key={`${change.path}-${index}`}
          path={change.path}
          lines={patchPreviewLines(change.diff?.text ?? "")}
          rawDiff={change.diff?.text ?? ""}
        />
      ))}
    </div>
  );
}

function PatchPreviewCard({
  path,
  lines,
  rawDiff,
}: {
  path: string;
  lines: DiffLine[];
  rawDiff: string;
}) {
  const [copied, setCopied] = useState(false);
  const diffHostRef = useRef<HTMLDivElement | null>(null);
  const diffThemeType = useThemeStore((state) =>
    state.isDark ? "dark" : "light",
  );
  const openReview = useInspectorStore((state) => state.openReview);
  const diffsPatch = normalizePatchForDiffs(rawDiff, path);

  useEffect(() => {
    if (!diffsPatch) return;
    const host = diffHostRef.current;
    if (!host) return;

    let disposed = false;
    let attempts = 0;
    let intervalId: number | undefined;

    const install = () => {
      if (disposed) return true;
      const shadowRoot = host.querySelector("diffs-container")?.shadowRoot;
      if (!shadowRoot) return false;
      let style = shadowRoot.querySelector<HTMLStyleElement>(
        "style[data-marloues-diff-scrollbar]",
      );
      if (!style) {
        style = document.createElement("style");
        style.setAttribute("data-marloues-diff-scrollbar", "");
        shadowRoot.appendChild(style);
      }
      style.textContent = DIFF_VIEW_SCROLL_CSS;
      return true;
    };

    if (!install()) {
      intervalId = window.setInterval(() => {
        attempts += 1;
        if (install() || attempts > 20) {
          if (intervalId !== undefined) window.clearInterval(intervalId);
        }
      }, 50);
    }

    return () => {
      disposed = true;
      if (intervalId !== undefined) window.clearInterval(intervalId);
    };
  }, [diffsPatch, diffThemeType]);

  const copyDiff = async () => {
    try {
      await navigator.clipboard?.writeText(
        rawDiff || lines.map((line) => `${line.prefix}${line.text}`).join("\n"),
      );
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="workflow-patch-card workflow-diffs-card">
      <div
        ref={diffHostRef}
        className="workflow-patch-card-body"
        data-kind="diffs-view"
      >
        {diffsPatch ? (
          <PatchDiff
            patch={diffsPatch}
            className="workflow-patch-diff-view"
            disableWorkerPool
            options={{
              themeType: diffThemeType,
              diffStyle: "unified",
              diffIndicators: "bars",
              lineDiffType: "word-alt",
              overflow: "scroll",
              stickyHeader: true,
              hunkSeparators: "line-info",
              unsafeCSS: DIFF_VIEW_SCROLL_CSS,
            }}
            renderCustomHeader={(fileDiff) => (
              <DiffCustomHeader
                fileDiff={fileDiff}
                copied={copied}
                onCopy={copyDiff}
                onReview={() => openReview(path, rawDiff)}
              />
            )}
          />
        ) : (
          lines.map((line, index) => (
            <div
              key={`${line.text}-${index}`}
              className={`workflow-patch-line ${line.kind}`}
            >
              {line.prefix}
              {line.text}
            </div>
          ))
        )}
        {!lines.length ? (
          <div className="workflow-patch-empty">无 diff 预览</div>
        ) : null}
      </div>
    </div>
  );
}

function patchPreviewLines(patch: string): DiffLine[] {
  if (!patch.trim()) return [];

  const rawLines = patch
    .replace(/\r/g, "")
    .split("\n")
    .filter((line) => {
      if (!line.trim()) return false;
      if (line === "*** Begin Patch" || line === "*** End Patch") return false;
      return true;
    });
  return rawLines.map(diffLineFromPatchLine);
}

function diffLineFromPatchLine(line: string): DiffLine {
  if (line.startsWith("+") && !line.startsWith("+++"))
    return { kind: "add", prefix: "+", text: line.slice(1) };
  if (line.startsWith("-") && !line.startsWith("---"))
    return { kind: "remove", prefix: "-", text: line.slice(1) };
  if (line.startsWith("*** ") || line.startsWith("@@"))
    return { kind: "meta", prefix: "", text: line };
  return {
    kind: "context",
    prefix: "",
    text: line.startsWith(" ") ? line.slice(1) : line,
  };
}

function DiffCustomHeader({
  fileDiff,
  copied,
  onCopy,
  onReview,
}: {
  fileDiff: FileDiffMetadata;
  copied: boolean;
  onCopy: () => Promise<void>;
  onReview: () => void;
}) {
  const added = fileDiff.hunks.reduce(
    (sum, hunk) => sum + hunk.additionLines,
    0,
  );
  const removed = fileDiff.hunks.reduce(
    (sum, hunk) => sum + hunk.deletionLines,
    0,
  );

  return (
    <div className="workflow-diffs-custom-header">
      <div className="workflow-diffs-custom-title">
        <span className="workflow-diffs-file-name">{fileDiff.name}</span>
        <span className="workflow-diffs-counts">
          {added ? (
            <span className="workflow-diffs-count workflow-diffs-count-add">
              +{added}
            </span>
          ) : null}
          {removed ? (
            <span className="workflow-diffs-count workflow-diffs-count-delete">
              -{removed}
            </span>
          ) : null}
        </span>
      </div>
      <div className="workflow-diffs-custom-actions">
        <button
          type="button"
          className="workflow-patch-review"
          onClick={onReview}
          aria-label="审核"
          title="在右侧审核面板打开"
        >
          <ShieldCheck />
          <span>审核</span>
        </button>
        <button
          type="button"
          className="workflow-patch-copy"
          onClick={() => void onCopy()}
          aria-label={copied ? "差异已复制" : "复制差异"}
          title={copied ? "已复制" : "复制差异"}
        >
          {copied ? <Check /> : <Copy />}
        </button>
      </div>
    </div>
  );
}

function patchStats(lines: DiffLine[]): { added: number; removed: number } {
  return {
    added: lines.filter((line) => line.kind === "add").length,
    removed: lines.filter((line) => line.kind === "remove").length,
  };
}

function fileChangeTargetLabel(files: string[]): string {
  if (files.length === 1) return basename(files[0]);
  return fileCountLabel(files.length);
}

function fileCountLabel(count: number): string {
  return `${Math.max(1, count)} 个文件`;
}

function basename(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

function InlineDiffStats({
  added,
  removed,
}: {
  added: number;
  removed: number;
}) {
  if (!added && !removed) return null;
  return (
    <span className="workflow-activity-diff-stats">
      {added ? <span className="is-addition">+{added}</span> : null}
      {removed ? <span className="is-deletion">-{removed}</span> : null}
    </span>
  );
}
