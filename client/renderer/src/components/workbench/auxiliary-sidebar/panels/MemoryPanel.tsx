import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, RefreshCcw, Save } from "lucide-react";
import type { MemoryFileRecord, TimelineItem } from "@shared/types";
import {
  compactText,
  formatBytes,
  formatDate,
  readTimelineDetailArray,
} from "./helpers";

export function MemoryPanel({
  workspacePath,
  timeline,
}: {
  workspacePath?: string;
  timeline: TimelineItem[];
}) {
  const memoryItems = timeline.filter((item) => item.type === "memory_recall");
  const [files, setFiles] = useState<MemoryFileRecord[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const selectedFile = files.find((file) => file.id === selectedFileId);
  const isDirty = draft !== savedContent;
  const memoryApi = window.marloues.memory;

  const loadFiles = async () => {
    setError("");
    if (!memoryApi) {
      setFiles([]);
      setSelectedFileId(null);
      setError("记忆接口尚未加载。请重启 Marloues，让新的 preload/IPC 生效。");
      return;
    }
    try {
      const nextFiles = await memoryApi.list();
      setFiles(nextFiles);
      setSelectedFileId((current) =>
        nextFiles.some((file) => file.id === current) ? current : null,
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : String(loadError),
      );
    }
  };

  useEffect(() => {
    void loadFiles();
  }, [workspacePath]); // eslint-disable-line react-hooks/exhaustive-deps -- loadFiles 每次渲染重建（依赖 selectedFileId），加入会导致工作区切换后重复重载

  useEffect(() => {
    if (!selectedFile?.id) {
      setDraft("");
      setSavedContent("");
      return;
    }
    if (!memoryApi) return;
    setLoading(true);
    setError("");
    void memoryApi
      .read(selectedFile.id)
      .then((content) => {
        setDraft(content);
        setSavedContent(content);
      })
      .catch((readError) =>
        setError(
          readError instanceof Error ? readError.message : String(readError),
        ),
      )
      .finally(() => setLoading(false));
  }, [selectedFile?.id, memoryApi]);

  const saveMemory = async () => {
    if (!selectedFile || !memoryApi) return;
    setSaving(true);
    setError("");
    try {
      const updated = await memoryApi.write(selectedFile.id, draft);
      setSavedContent(draft);
      setFiles((items) =>
        items.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : String(saveError),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="memory-panel scrollbar-thin">
      {selectedFile ? (
        <div className="memory-editor">
          <div className="memory-editor-head">
            <button
              type="button"
              onClick={() => setSelectedFileId(null)}
              title="返回记忆列表"
              aria-label="返回记忆列表"
            >
              <ArrowLeft size={14} />
            </button>
            <div>
              <strong>{selectedFile.label}</strong>
              <span>{selectedFile.path}</span>
            </div>
            <button
              type="button"
              onClick={() => void loadFiles()}
              title="刷新记忆文件"
              aria-label="刷新记忆文件"
            >
              <RefreshCcw size={14} />
            </button>
          </div>
          <div className="memory-edit-box">
            <div className="memory-edit-meta">
              <span>{formatMemoryFileMeta(selectedFile)}</span>
              <button
                type="button"
                className={isDirty ? "dirty" : "clean"}
                onClick={() => void saveMemory()}
                disabled={loading || saving || !isDirty}
                title={saving ? "保存中" : isDirty ? "保存记忆文件" : "已保存"}
              >
                {isDirty ? <Save size={14} /> : <CheckCircle2 size={14} />}
              </button>
            </div>
            <textarea
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
              }}
              spellCheck={false}
              disabled={loading}
              placeholder={
                selectedFile.exists
                  ? "正在读取记忆..."
                  : "这个记忆文件还不存在，输入内容并保存后会创建。"
              }
            />
          </div>
        </div>
      ) : (
        <section className="auxiliary-memory-list">
          <header>
            <strong>会话记忆</strong>
            <small>由当前会话积累的可复用信息</small>
          </header>
          {files.map((file) => (
            <button
              key={file.id}
              type="button"
              onClick={() => setSelectedFileId(file.id)}
              title={file.path}
            >
              <span>{file.label}</span>
              <small>{formatMemoryKind(file.kind)}</small>
            </button>
          ))}
          {!files.length && !error ? (
            <p className="memory-overview-empty">暂无会话记忆</p>
          ) : null}
        </section>
      )}
      {error ? <p className="memory-error">{error}</p> : null}
      {memoryItems.length ? (
        <div className="memory-note">
          <strong>最近召回</strong>
          {memoryItems.slice(-4).map((item) => (
            <p key={`${item.id}-${item.createdAt}`}>
              {formatMemoryRecall(item)}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function formatMemoryFileMeta(file: MemoryFileRecord): string {
  const state = file.exists
    ? `${formatBytes(file.size ?? 0)} / ${formatDate(file.modifiedAt ?? Date.now())}`
    : "未创建";
  return `${formatMemoryKind(file.kind)} / ${state}`;
}

function formatMemoryKind(kind: MemoryFileRecord["kind"]): string {
  if (kind === "project") return "项目记忆";
  if (kind === "local") return "本地设置";
  return "本会话";
}

function formatMemoryRecall(item: TimelineItem): string {
  const memories = readTimelineDetailArray(item);
  if (!memories.length) return `${formatDate(item.createdAt)}：${item.label}`;
  return memories
    .slice(0, 3)
    .map((memory) => {
      const path = typeof memory.path === "string" ? memory.path : "memory";
      const content =
        typeof memory.content === "string" && memory.content.trim()
          ? ` - ${compactText(memory.content, 90)}`
          : "";
      return `${path}${content}`;
    })
    .join("\n");
}
