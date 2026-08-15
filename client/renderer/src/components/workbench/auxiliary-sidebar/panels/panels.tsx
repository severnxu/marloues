import { useCallback, useState } from "react";
import { ChevronRight, FileOutput, Shield } from "lucide-react";
import type { TimelineItem } from "@shared/types";
import { useInspectorStore } from "@/stores/inspector-store";
import { buildFileChanges } from "./timeline-builders";
import type { FileChange } from "./types";

export function OutputsPanel({ timeline }: { timeline: TimelineItem[] }) {
  const fileChanges = buildFileChanges(timeline);
  const openReview = useInspectorStore((state) => state.openReview);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const insertions = fileChanges.reduce(
    (total, change) => total + change.insertions,
    0,
  );
  const deletions = fileChanges.reduce(
    (total, change) => total + change.deletions,
    0,
  );

  return (
    <div className="tab-panel-content scrollbar-thin">
      {fileChanges.length > 0 ? (
        <div className="outputs-list">
          <div className="outputs-summary">
            <strong>{fileChanges.length} 个文件已变更</strong>
            {insertions || deletions ? (
              <span>
                {insertions ? <b>+{insertions}</b> : null}
                {deletions ? <em>−{deletions}</em> : null}
              </span>
            ) : null}
          </div>
          {fileChanges.map((change) => (
            <FileChangeRow
              key={`${change.path}-${change.operation}`}
              change={change}
              expanded={expanded.has(change.path)}
              onToggle={() => toggle(change.path)}
              onReview={() => openReview(change.path, change.rawDiff ?? "")}
            />
          ))}
        </div>
      ) : (
        <div className="tab-panel-empty-state">
          <FileOutput size={28} />
          <strong>暂无产出</strong>
          <p>Agent 修改或创建文件后，变更会显示在这里。</p>
        </div>
      )}
    </div>
  );
}

function FileChangeRow({
  change,
  expanded,
  onToggle,
  onReview,
}: {
  change: FileChange;
  expanded: boolean;
  onToggle: () => void;
  onReview: () => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleToggle = useCallback(async () => {
    if (!expanded && content === null && !loading) {
      setLoading(true);
      setError(null);
      try {
        const text = await window.marloues.fs.readFile(change.path);
        setContent(text);
      } catch (e) {
        setError(e instanceof Error ? e.message : "读取失败");
      } finally {
        setLoading(false);
      }
    }
    onToggle();
  }, [expanded, content, loading, change.path, onToggle]);

  return (
    <div className={`outputs-item ${expanded ? "is-expanded" : ""}`}>
      <button
        type="button"
        className="outputs-row"
        onClick={handleToggle}
        title={change.path}
      >
        <ChevronRight
          size={14}
          className={`outputs-chevron ${expanded ? "is-open" : ""}`}
        />
        <FileOutput size={14} />
        <span className="outputs-path">{fileName(change.path)}</span>
        <span className="outputs-stats">
          {change.insertions ? <b>+{change.insertions}</b> : null}
          {change.deletions ? <em>−{change.deletions}</em> : null}
          {!change.insertions && !change.deletions ? (
            <small>{change.operationLabel}</small>
          ) : null}
        </span>
      </button>
      {expanded ? (
        <div className="outputs-content">
          {loading ? (
            <span className="outputs-placeholder">读取中…</span>
          ) : error ? (
            <span className="outputs-error">{error}</span>
          ) : content != null ? (
            <pre className="outputs-code scrollbar-thin">{content}</pre>
          ) : (
            <span className="outputs-placeholder">…</span>
          )}
          {change.rawDiff ? (
            <button
              type="button"
              className="outputs-review-link"
              onClick={onReview}
            >
              <Shield size={12} />
              审核 diff
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function fileName(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? path;
}
