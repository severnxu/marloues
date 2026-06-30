import { useEffect, useMemo, useState } from "react";
import hljs from "highlight.js/lib/common";
import "highlight.js/styles/atom-one-dark.min.css";
import {
  Activity,
  ArrowLeft,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  FileCode2,
  FileText,
  Folder,
  MessageSquarePlus,
  RefreshCcw,
  Save,
  Search,
  Terminal,
  Wrench,
} from "lucide-react";
import type { ChatSessionRecord, DirEntry, FileStat, MemoryFileRecord, TimelineItem } from "@shared/types";

interface ToolRun {
  id: string;
  name: string;
  start?: TimelineItem;
  result?: TimelineItem;
  status: NonNullable<TimelineItem["status"]>;
  isError: boolean;
  summary: string;
  detail: string;
}

export function TaskPanel({
  workspacePath,
  timeline,
  messageCount,
  isStreaming,
}: {
  workspacePath?: string;
  timeline: TimelineItem[];
  messageCount: number;
  isStreaming: boolean;
}) {
  const tools = buildToolRuns(timeline).slice(-8);
  const status = isStreaming ? "处理中" : timeline.length > 0 ? "已完成" : "空闲";

  return (
    <div className="task-panel scrollbar-thin">
      <section className="task-card">
        <div className="task-card-head">
          <span>运行状态</span>
          <em className={isStreaming ? "running" : ""}>
            <i />
            {status}
          </em>
        </div>
        <div className="task-metrics">
          <div>
            <MessageSquarePlus size={14} />
            <span>消息</span>
            <strong>{messageCount}</strong>
          </div>
          <div>
            <Wrench size={14} />
            <span>工具</span>
            <strong>{tools.length}</strong>
          </div>
        </div>
        {workspacePath ? (
          <p className="task-workspace">
            <FileCode2 size={14} />
            {workspacePath}
          </p>
        ) : null}
      </section>

      <section className="task-card">
        <h3>
          <Activity size={14} />
          时间线
        </h3>
        {timeline.length > 0 ? (
          <div className="task-timeline">
            {timeline.slice(-20).map((item) => (
              <TimelineCard key={`${item.id}-${item.type}-${item.createdAt}`} item={item} compact />
            ))}
          </div>
        ) : (
          <p className="task-empty">发送消息后，这里会显示模型、工具和执行进度。</p>
        )}
      </section>

      <section className="task-card">
        <h3>
          <Terminal size={14} />
          工具调用
        </h3>
        {tools.length > 0 ? (
          <div className="task-tools">
            {tools.map((tool) => (
              <ToolRunCard key={tool.id} tool={tool} />
            ))}
          </div>
        ) : (
          <p className="task-empty">当前会话还没有工具调用。</p>
        )}
      </section>
    </div>
  );
}

export function FileExplorer({ workspacePath }: { workspacePath?: string }) {
  const [entriesByPath, setEntriesByPath] = useState<Record<string, DirEntry[]>>({});
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set(["."]));
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(() => new Set());
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [preview, setPreview] = useState("");
  const [previewCopied, setPreviewCopied] = useState(false);
  const [fileStat, setFileStat] = useState<FileStat | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [error, setError] = useState("");

  const rootEntries = entriesByPath["."] ?? [];
  const fileCount = rootEntries.filter((entry) => !entry.isDirectory).length;

  const loadDir = async (nextPath: string) => {
    if (!workspacePath) return;
    setError("");
    setLoadingPaths((paths) => new Set(paths).add(nextPath));
    try {
      const nextEntries = await window.marloues.fs.listDir(nextPath);
      setEntriesByPath((state) => ({
        ...state,
        [nextPath]: [...nextEntries].sort(
          (a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name),
        ),
      }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoadingPaths((paths) => {
        const next = new Set(paths);
        next.delete(nextPath);
        return next;
      });
    }
  };

  useEffect(() => {
    setEntriesByPath({});
    setExpandedPaths(new Set(["."]));
    setSelectedFile(null);
    setPreview("");
    setPreviewCopied(false);
    setFileStat(null);
    setError("");
    if (workspacePath) void loadDir(".");
  }, [workspacePath]);

  const refresh = () => {
    for (const path of Array.from(expandedPaths)) void loadDir(path);
  };

  const toggleDirectory = (path: string) => {
    const isExpanded = expandedPaths.has(path);
    setExpandedPaths((paths) => {
      const next = new Set(paths);
      if (isExpanded) next.delete(path);
      else next.add(path);
      return next;
    });
    if (!isExpanded && !entriesByPath[path]) void loadDir(path);
  };

  const openFile = async (filePath: string) => {
    setSelectedFile(filePath);
    setPreview("");
    setFileStat(null);
    setFileLoading(true);
    setPreviewCopied(false);
    setError("");
    try {
      const [stat, content] = await Promise.all([window.marloues.fs.stat(filePath), window.marloues.fs.readFile(filePath)]);
      setFileStat(stat);
      setPreview(content);
    } catch (readError) {
      setPreview("");
      setError(readError instanceof Error ? readError.message : String(readError));
    } finally {
      setFileLoading(false);
    }
  };

  const copyPreview = async () => {
    if (!preview) return;
    try {
      await copyToClipboard(preview);
      setPreviewCopied(true);
      window.setTimeout(() => setPreviewCopied(false), 1200);
    } catch {
      setPreviewCopied(false);
    }
  };

  if (!workspacePath) {
    return (
      <div className="file-empty-state">
        <Folder size={32} />
        <strong>暂无工作区</strong>
        <p>打开工作区后，这里会显示项目文件。</p>
      </div>
    );
  }

  return (
    <div className="file-panel">
      <div className="file-header">
        <div>
          <strong>{workspacePath.split(/[\\/]/).pop() ?? "文件"}</strong>
          <span>{selectedFile ? selectedFile : `${rootEntries.length} 项 / ${fileCount} 个文件`}</span>
        </div>
        {selectedFile ? (
          <button
            onClick={() => {
              setSelectedFile(null);
              setPreview("");
              setPreviewCopied(false);
            }}
            disabled={!workspacePath}
            title="返回文件列表"
          >
            <ArrowLeft size={14} />
          </button>
        ) : (
          <button onClick={refresh} disabled={!workspacePath} title="刷新文件">
            <RefreshCcw size={14} />
          </button>
        )}
      </div>
      {error ? <p className="file-error">{error}</p> : null}
      {selectedFile ? (
        <div className="file-preview">
          <div className="file-preview-toolbar">
            <button
              onClick={() => {
                setSelectedFile(null);
                setPreview("");
                setPreviewCopied(false);
                setFileStat(null);
              }}
              title="返回文件列表"
            >
              <ArrowLeft size={14} />
            </button>
            <div>
              <strong>{selectedFile.split("/").pop()}</strong>
              <span>{selectedFile}</span>
            </div>
            <button onClick={() => void openFile(selectedFile)} disabled={fileLoading} title="重新加载">
              <RefreshCcw size={14} />
            </button>
            <button onClick={() => void copyPreview()} disabled={!preview} title={previewCopied ? "已复制" : "复制内容"} aria-label={previewCopied ? "已复制内容" : "复制内容"}>
              {previewCopied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
            </button>
          </div>
          <div className="file-preview-meta">
            <span>{selectedFile.split(".").pop() ?? "文本"}</span>
            {fileStat ? (
              <>
                <i />
                <span>{formatBytes(fileStat.size)}</span>
                <i />
                <span>{formatDate(fileStat.modifiedAt)}</span>
              </>
            ) : null}
          </div>
          {fileLoading ? (
            <p className="file-loading">正在读取文件...</p>
          ) : (
            <FilePreviewCode path={selectedFile} content={preview} />
          )}
        </div>
      ) : (
        <div className="file-list tree scrollbar-thin">
          <FileTree
            dirPath="."
            entries={rootEntries}
            entriesByPath={entriesByPath}
            expandedPaths={expandedPaths}
            loadingPaths={loadingPaths}
            onToggleDirectory={toggleDirectory}
            onOpenFile={openFile}
          />
        </div>
      )}
    </div>
  );
}

function FileTree({
  dirPath,
  entries,
  entriesByPath,
  expandedPaths,
  loadingPaths,
  onToggleDirectory,
  onOpenFile,
  depth = 0,
}: {
  dirPath: string;
  entries: DirEntry[];
  entriesByPath: Record<string, DirEntry[]>;
  expandedPaths: Set<string>;
  loadingPaths: Set<string>;
  onToggleDirectory: (path: string) => void;
  onOpenFile: (path: string) => void;
  depth?: number;
}) {
  if (loadingPaths.has(dirPath) && entries.length === 0) {
    return <div className="file-tree-empty">正在读取文件...</div>;
  }

  if (entries.length === 0) {
    return <div className="file-tree-empty">这个目录是空的。</div>;
  }

  return (
    <div className="file-tree">
      {entries.map((entry) => {
        const itemPath = joinWorkspacePath(dirPath, entry.name);
        const expanded = expandedPaths.has(itemPath);
        const childEntries = entriesByPath[itemPath] ?? [];

        return (
          <div key={itemPath}>
            <button
              className="file-tree-row"
              style={{ paddingLeft: 8 + depth * 14 }}
              title={itemPath}
              onClick={() => {
                if (entry.isDirectory) onToggleDirectory(itemPath);
                else void onOpenFile(itemPath);
              }}
            >
              {entry.isDirectory ? (
                expanded ? (
                  <ChevronDown size={14} />
                ) : (
                  <ChevronRight size={14} />
                )
              ) : (
                <span className="file-tree-indent" />
              )}
              {entry.isDirectory ? <Folder size={14} className="folder-icon" /> : <FileText size={14} />}
              <span>{entry.name}</span>
            </button>
            {entry.isDirectory && expanded ? (
              <FileTree
                dirPath={itemPath}
                entries={childEntries}
                entriesByPath={entriesByPath}
                expandedPaths={expandedPaths}
                loadingPaths={loadingPaths}
                onToggleDirectory={onToggleDirectory}
                onOpenFile={onOpenFile}
                depth={depth + 1}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function FilePreviewCode({ path, content }: { path: string; content: string }) {
  const language = languageFromPath(path);
  const lines = useMemo(() => {
    if (!content) return ["文件为空。"];
    const highlighted = hljs.getLanguage(language)
      ? hljs.highlight(content, { language, ignoreIllegals: true }).value
      : hljs.highlightAuto(content).value;
    return highlighted.split(/\r?\n/);
  }, [content, language]);

  return (
    <div className="file-code-view scrollbar-thin">
      {lines.map((line, index) => (
        <div className="file-code-line" key={`${index}-${line.slice(0, 16)}`}>
          <span className="file-code-number">{index + 1}</span>
          <code dangerouslySetInnerHTML={{ __html: line.length > 0 ? line : " " }} />
        </div>
      ))}
    </div>
  );
}

export function MemoryPanel({ workspacePath, timeline }: { workspacePath?: string; timeline: TimelineItem[] }) {
  const memoryItems = timeline.filter((item) => item.type === "memory_recall");
  const [files, setFiles] = useState<MemoryFileRecord[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const selectedFile = files.find((file) => file.id === selectedFileId) ?? files[0];
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
      const nextSelected = nextFiles.find((file) => file.id === selectedFileId)?.id ?? nextFiles[0]?.id ?? null;
      setSelectedFileId(nextSelected);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  };

  useEffect(() => {
    void loadFiles();
  }, [workspacePath]);

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
      .catch((readError) => setError(readError instanceof Error ? readError.message : String(readError)))
      .finally(() => setLoading(false));
  }, [selectedFile?.id]);

  const saveMemory = async () => {
    if (!selectedFile || !memoryApi) return;
    setSaving(true);
    setError("");
    try {
      const updated = await memoryApi.write(selectedFile.id, draft);
      setSavedContent(draft);
      setFiles((items) => items.map((item) => (item.id === updated.id ? updated : item)));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="memory-panel scrollbar-thin">
      <div className="memory-editor">
        <div className="memory-editor-head">
          <div>
            <strong>记忆文件</strong>
            <span>{files.length ? `${files.length} 已创建` : "暂无记忆"}</span>
          </div>
          <button onClick={() => void loadFiles()} title="刷新记忆文件">
            <RefreshCcw size={14} />
          </button>
        </div>
        <div className="memory-file-list">
          {files.map((file) => (
            <button
              key={file.id}
              className={selectedFile?.id === file.id ? "active" : ""}
              onClick={() => setSelectedFileId(file.id)}
              title={file.path}
            >
              <FileText size={14} />
              <span>
                <strong>{file.label}</strong>
                <small>{formatMemoryFileMeta(file)}</small>
              </span>
            </button>
          ))}
        </div>
        {selectedFile ? (
          <div className="memory-edit-box">
            <div className="memory-edit-meta">
              <span>{selectedFile.path}</span>
              <button
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
              placeholder={selectedFile.exists ? "正在读取记忆..." : "这个记忆文件还不存在，输入内容并保存后会创建。"}
            />
          </div>
        ) : null}
        {error ? <p className="memory-error">{error}</p> : null}
      </div>
      {memoryItems.length ? (
        <div className="memory-note">
          <strong>最近召回</strong>
          {memoryItems.slice(-4).map((item) => (
            <p key={`${item.id}-${item.createdAt}`}>{formatMemoryRecall(item)}</p>
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
  return "自动记忆";
}

export function collectSessionTimeline(session?: ChatSessionRecord, liveTimeline: TimelineItem[] = []): TimelineItem[] {
  const persisted = session?.messages.flatMap((message) => message.timeline ?? []) ?? [];
  return [...persisted, ...liveTimeline];
}

function formatMemoryRecall(item: TimelineItem): string {
  const memories = readTimelineDetailArray(item);
  if (!memories.length) return `${formatDate(item.createdAt)}：${item.label}`;
  return memories
    .slice(0, 3)
    .map((memory) => {
      const path = typeof memory.path === "string" ? memory.path : "memory";
      const content =
        typeof memory.content === "string" && memory.content.trim() ? ` - ${compactText(memory.content, 90)}` : "";
      return `${path}${content}`;
    })
    .join("\n");
}

function readTimelineDetailArray(item: TimelineItem): Array<Record<string, unknown>> {
  if (!item.detail) return [];
  try {
    const value = JSON.parse(item.detail) as unknown;
    return Array.isArray(value)
      ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
      : [];
  } catch {
    return [];
  }
}

function compactText(value: string, maxLength: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text || "空内容";
}

function joinWorkspacePath(parent: string, name: string): string {
  return parent === "." ? name : `${parent}/${name}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

function languageFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    cjs: "javascript",
    css: "css",
    html: "xml",
    js: "javascript",
    json: "json",
    jsx: "javascript",
    log: "plaintext",
    md: "markdown",
    mjs: "javascript",
    ts: "typescript",
    tsx: "typescript",
    yaml: "yaml",
    yml: "yaml",
  };
  return map[ext] ?? ext;
}

function TimelineCard({ item, compact = false }: { item: TimelineItem; compact?: boolean }) {
  const Icon = iconForTimelineItem(item);
  const summary = summarizeTimelineItem(item);
  const isTool = item.type.startsWith("tool_");

  return (
    <div
      className={`${compact ? "timeline-item" : "inspector-item"} ${item.isError ? "error" : ""} ${isTool ? "tool-card" : ""}`}
    >
      <div className="timeline-card-head">
        <Icon size={14} />
        <span>{formatTimelineType(item.type)}</span>
        {item.status ? <em className={`status-pill ${item.status}`}>{formatTimelineStatus(item.status)}</em> : null}
      </div>
      <strong>{formatTimelineLabel(item)}</strong>
      {summary ? <p className="tool-summary">{summary}</p> : null}
      {item.detail ? <code>{formatDetail(item)}</code> : null}
    </div>
  );
}

/* PRD 4.2.D — Tool Panel 详情查看：点击展开完整 input/output JSON，带格式化与 copy。 */
function ToolRunCard({ tool }: { tool: ToolRun }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const inputJson = tool.start?.toolInput ?? null;
  const outputJson = tool.result?.toolOutput ?? null;
  const hasInput = typeof inputJson === "string" ? inputJson.trim().length > 0 : Boolean(inputJson);
  const hasOutput = typeof outputJson === "string" ? outputJson.trim().length > 0 : Boolean(outputJson);
  const hasDetail = Boolean(tool.detail);

  const handleCopy = async () => {
    const text = JSON.stringify({ input: inputJson ?? undefined, output: outputJson ?? undefined, detail: tool.detail }, null, 2);
    try {
      await copyToClipboard(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard may be unavailable
    }
  };

  return (
    <div className={`task-tool-run ${tool.isError ? "error" : ""} ${expanded ? "expanded" : ""}`}>
      <button
        type="button"
        className="task-tool-run-head"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        {hasDetail || hasInput || hasOutput ? (
          expanded ? (
            <ChevronDown size={14} />
          ) : (
            <ChevronRight size={14} />
          )
        ) : (
          <Wrench size={14} />
        )}
        <strong>{tool.name}</strong>
        <span className={`status-pill ${tool.status}`}>{formatTimelineStatus(tool.status)}</span>
      </button>
      <div className="task-tool-meta">
        <span>{formatToolPhase(tool)}</span>
        {formatToolDuration(tool) ? <span>{formatToolDuration(tool)}</span> : null}
      </div>
      {tool.summary ? <p>{tool.summary}</p> : null}
      {expanded && (hasDetail || hasInput || hasOutput) ? (
        <div className="task-tool-json">
          <div className="task-tool-json-head">
            <span>详情</span>
            <button type="button" onClick={handleCopy} title="复制 JSON">
              {copied ? <CheckCircle2 size={13} /> : <Copy size={13} />}
              {copied ? "已复制" : "复制"}
            </button>
          </div>
          {hasInput ? (
            <div className="task-tool-json-section">
              <small>Input</small>
              <pre className="task-tool-json-body">{formatJsonValue(inputJson)}</pre>
            </div>
          ) : null}
          {hasOutput ? (
            <div className="task-tool-json-section">
              <small>Output</small>
              <pre className={`task-tool-json-body ${tool.isError ? "error" : ""}`}>{formatJsonValue(outputJson)}</pre>
            </div>
          ) : null}
          {!hasInput && !hasOutput && hasDetail ? (
            <pre className="task-tool-json-body">{tool.detail}</pre>
          ) : null}
        </div>
      ) : null}
      {!expanded && tool.detail ? <code className="task-tool-detail">{tool.detail}</code> : null}
    </div>
  );
}

async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

function formatJsonValue(value: unknown): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return JSON.stringify(JSON.parse(trimmed), null, 2);
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function buildToolRuns(timeline: TimelineItem[]): ToolRun[] {
  const runs = new Map<string, ToolRun>();

  for (const item of timeline) {
    if (item.type !== "tool_start" && item.type !== "tool_result" && item.type !== "tool_delta") continue;
    const key = item.id || `${item.toolName ?? item.label}-${item.createdAt}`;
    const existing =
      runs.get(key) ??
      ({
        id: key,
        name: item.toolName ?? item.label,
        status: "pending",
        isError: false,
        summary: "",
        detail: "",
      } satisfies ToolRun);

    existing.name = item.toolName ?? existing.name;
    existing.isError = existing.isError || Boolean(item.isError);

    if (item.type === "tool_start" || item.type === "tool_delta") {
      if (!existing.start) existing.start = item;
    }
    if (item.type === "tool_result") {
      existing.result = item;
    }

    existing.status = resolveToolRunStatus(existing, item);
    existing.summary = summarizeTimelineItem(item) || existing.summary;
    existing.detail = toolRunDetail(item) || existing.detail;
    runs.set(key, existing);
  }

  return Array.from(runs.values());
}

function resolveToolRunStatus(run: ToolRun, item: TimelineItem): NonNullable<TimelineItem["status"]> {
  if (run.isError || item.isError) return "error";
  if (item.status) return item.status;
  if (item.type === "tool_result") return "completed";
  return "running";
}

function toolRunDetail(item: TimelineItem): string {
  if (item.type === "tool_result" && typeof item.toolOutput === "string") {
    const output = item.toolOutput.trim();
    return output.length > 1200 ? `${output.slice(0, 1200)}\n...` : output;
  }
  if (item.detail) return item.detail.length > 1200 ? `${item.detail.slice(0, 1200)}\n...` : item.detail;
  return "";
}

function formatToolPhase(tool: ToolRun): string {
  if (tool.isError || tool.status === "error") return "结果异常";
  if (tool.result) return "已有结果";
  if (tool.start) return "执行中";
  return "等待中";
}

function formatToolDuration(tool: ToolRun): string {
  const start = tool.start?.createdAt;
  const end = tool.result?.createdAt;
  if (!start || !end || end < start) return "";
  const ms = end - start;
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 60_000)} min`;
}

function iconForTimelineItem(item: TimelineItem) {
  const name = item.toolName || item.label;
  if (item.status === "completed") return CheckCircle2;
  if (/bash/i.test(name)) return Terminal;
  if (/grep|glob|search/i.test(name)) return Search;
  if (/read|write|edit|file/i.test(name)) return FileText;
  if (item.type.startsWith("tool_")) return Wrench;
  return Bot;
}

function formatTimelineType(type: TimelineItem["type"]): string {
  const labels: Record<TimelineItem["type"], string> = {
    thinking: "思考",
    tool_start: "工具开始",
    tool_delta: "工具输入",
    tool_result: "工具结果",
    status: "状态",
    memory_recall: "记忆召回",
    error: "错误",
  };
  return labels[type] ?? type;
}

function formatTimelineStatus(status: NonNullable<TimelineItem["status"]>): string {
  const labels: Record<NonNullable<TimelineItem["status"]>, string> = {
    pending: "等待中",
    running: "运行中",
    completed: "已完成",
    error: "错误",
    aborted: "已停止",
  };
  return labels[status] ?? status;
}

function formatTimelineLabel(item: TimelineItem): string {
  if (item.toolName) return item.toolName;
  const labels: Record<string, string> = {
    Thinking: "思考",
    "Turn started": "任务开始",
    "Turn success": "任务完成",
    "Turn error": "任务出错",
    "Turn aborted": "任务已停止",
    Error: "错误",
  };
  return labels[item.label] ?? item.label;
}

function summarizeTimelineItem(item: TimelineItem): string {
  const input = item.toolInput;
  if (!input || typeof input !== "object") return "";
  const record = input as Record<string, unknown>;
  const name = item.toolName || item.label;
  if (/bash/i.test(name) && typeof record.command === "string") return record.command;
  if (/grep/i.test(name) && typeof record.pattern === "string") return `pattern: ${record.pattern}`;
  if (/glob/i.test(name) && typeof record.pattern === "string") return `glob: ${record.pattern}`;
  for (const key of ["file_path", "path", "notebook_path"]) {
    if (typeof record[key] === "string") return String(record[key]);
  }
  return "";
}

function formatDetail(item: TimelineItem): string {
  if (item.type === "tool_result" && typeof item.toolOutput === "string") {
    return item.toolOutput.length > 4000 ? `${item.toolOutput.slice(0, 4000)}\n...` : item.toolOutput;
  }
  return item.detail ?? "";
}
