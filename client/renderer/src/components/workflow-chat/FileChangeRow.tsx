import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Check, Copy, FileText } from "lucide-react";
import type { FileDiffMetadata } from "@pierre/diffs/react";
import type { WorkflowTurnItem as WorkflowStreamItem } from "../../../../shared/adapters/workflow-messages-to-read-thread";
import { useThemeStore } from "../../stores/theme-store";
import { WorkflowActivityRow, WorkflowInlineDots } from "./ActivityRow";
import { workflowStatusIsRunning } from "./turn-collapse-rules";

type FileChangeItemModel = Extract<WorkflowStreamItem, { type: "fileChange" }>;
type DiffLine = {
  kind: "add" | "remove" | "meta" | "context";
  prefix: string;
  text: string;
};

const LazyPatchDiff = lazy(async () => {
  const { PatchDiff } = await import("@pierre/diffs/react");
  return { default: PatchDiff };
});

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
      icon={<FileText className="h-3.5 w-3.5" />}
      iconClassName={failed ? "text-danger" : "text-text-subtle"}
      label={
        <>
          {label}{" "}
          <span
            className={
              files.length === 1 ? "font-mono text-accent" : "text-text-subtle"
            }
          >
            {fileChangeTargetLabel(files)}
          </span>
          <InlineDiffStats added={stats.added} removed={stats.removed} />
          {running ? <WorkflowInlineDots /> : null}
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
    <div className="ml-[24px] mt-1.5 grid gap-2">
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
          <Suspense
            fallback={
              <div className="workflow-patch-empty">正在加载 diff…</div>
            }
          >
            <LazyPatchDiff
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
                />
              )}
            />
          </Suspense>
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
}: {
  fileDiff: FileDiffMetadata;
  copied: boolean;
  onCopy: () => Promise<void>;
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
      <button
        type="button"
        className="workflow-patch-copy"
        onClick={() => void onCopy()}
        aria-label={copied ? "Copied diff" : "Copy diff"}
        title={copied ? "Copied" : "Copy diff"}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
}

const DIFF_VIEW_SCROLL_CSS = `
[data-diff] {
  overflow: visible !important;
}

[data-code] {
  max-height: 292px;
  overflow: auto !important;
  overscroll-behavior: contain;
  scrollbar-width: auto !important;
  scrollbar-color: auto !important;
}

[data-code]::-webkit-scrollbar {
  -webkit-appearance: none !important;
  width: 8px !important;
  height: 8px !important;
  background: transparent !important;
}

[data-code]::-webkit-scrollbar-button {
  -webkit-appearance: none !important;
  width: 0 !important;
  height: 0 !important;
  display: none !important;
  background: transparent !important;
}

[data-code]::-webkit-scrollbar-button:single-button,
[data-code]::-webkit-scrollbar-button:start:decrement,
[data-code]::-webkit-scrollbar-button:end:increment,
[data-code]::-webkit-scrollbar-button:horizontal:decrement,
[data-code]::-webkit-scrollbar-button:horizontal:increment,
[data-code]::-webkit-scrollbar-button:vertical:decrement,
[data-code]::-webkit-scrollbar-button:vertical:increment {
  -webkit-appearance: none !important;
  width: 0 !important;
  height: 0 !important;
  display: none !important;
  background: transparent !important;
}

[data-code]::-webkit-scrollbar-thumb {
  -webkit-appearance: none !important;
  min-height: 40px !important;
  min-width: 40px !important;
  border: 1px solid transparent !important;
  border-radius: 999px !important;
  background-clip: padding-box !important;
  background-color: transparent !important;
  box-shadow: inset 0 0 0 999px color-mix(in srgb, var(--diffs-fg-number) 34%, transparent) !important;
}

[data-code]::-webkit-scrollbar-thumb:horizontal,
[data-code]::-webkit-scrollbar-thumb:vertical {
  border-radius: 999px !important;
}

[data-code]::-webkit-scrollbar-thumb:hover {
  background-color: transparent !important;
  box-shadow: inset 0 0 0 999px color-mix(in srgb, var(--diffs-fg-number) 54%, transparent) !important;
}

[data-code]::-webkit-scrollbar-track,
[data-code]::-webkit-scrollbar-track-piece,
[data-code]::-webkit-scrollbar-corner {
  -webkit-appearance: none !important;
  border-radius: 999px !important;
  background: transparent !important;
}
`;

function normalizePatchForDiffs(patch: string, fallbackPath: string): string {
  const trimmed = patch.trim();
  if (!trimmed) return "";
  if (/^diff --git\s+/m.test(trimmed) && /^@@\s+-\d+/m.test(trimmed))
    return patch;

  const lines = patch.replace(/\r/g, "").split("\n");
  const path = extractPatchPath(lines) || fallbackPath || "patch";
  const body: string[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    if (line === "*** Begin Patch" || line === "*** End Patch") continue;
    if (/^\*\*\*\s+(Add|Update|Delete) File:/.test(line)) continue;
    if (/^@@/.test(line)) continue;
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) {
      body.push(line);
    }
  }

  if (!body.length) return "";

  const added = body.filter(
    (line) => line.startsWith("+") && !line.startsWith("+++"),
  ).length;
  const removed = body.filter(
    (line) => line.startsWith("-") && !line.startsWith("---"),
  ).length;
  const context = body.length - added - removed;
  const oldCount = removed + context;
  const newCount = added + context;
  const oldStart = oldCount > 0 ? 1 : 0;
  const newStart = newCount > 0 ? 1 : 0;
  const oldFile = oldCount > 0 ? `a/${path}` : "/dev/null";
  const newFile = newCount > 0 ? `b/${path}` : "/dev/null";

  return [
    `diff --git a/${path} b/${path}`,
    `--- ${oldFile}`,
    `+++ ${newFile}`,
    `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
    ...body,
    "",
  ].join("\n");
}

function extractPatchPath(lines: string[]): string {
  for (const line of lines) {
    const match = line.match(/^\*\*\*\s+(?:Add|Update|Delete) File:\s+(.+)$/);
    if (match?.[1]) return match[1].trim();
  }
  return "";
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
    <span className="ml-1.5 inline-flex gap-1.5 font-mono text-[11px]">
      {added ? <span className="text-accent">+{added}</span> : null}
      {removed ? <span className="text-danger">-{removed}</span> : null}
    </span>
  );
}
