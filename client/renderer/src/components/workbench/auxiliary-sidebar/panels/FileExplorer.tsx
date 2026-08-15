import { useCallback, useEffect, useMemo, useState } from "react";
import hljs from "highlight.js/lib/common";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  Folder,
  RefreshCcw,
  Search,
} from "lucide-react";
import type { DirEntry, FileStat } from "@shared/types";
import {
  copyToClipboard,
  formatBytes,
  formatDate,
  joinWorkspacePath,
  languageFromPath,
} from "./helpers";

export function FileExplorer({ workspacePath }: { workspacePath?: string }) {
  const [entriesByPath, setEntriesByPath] = useState<
    Record<string, DirEntry[]>
  >({});
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    () => new Set(["."]),
  );
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [preview, setPreview] = useState("");
  const [previewCopied, setPreviewCopied] = useState(false);
  const [fileStat, setFileStat] = useState<FileStat | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");

  const rootEntries = entriesByPath["."] ?? [];
  const loadDir = useCallback(
    async (nextPath: string) => {
      if (!workspacePath) return;
      setError("");
      setLoadingPaths((paths) => new Set(paths).add(nextPath));
      try {
        const nextEntries = await window.marloues.fs.listDir(nextPath);
        setEntriesByPath((state) => ({
          ...state,
          [nextPath]: [...nextEntries].sort(
            (a, b) =>
              Number(b.isDirectory) - Number(a.isDirectory) ||
              a.name.localeCompare(b.name),
          ),
        }));
      } catch (loadError) {
        setError(
          loadError instanceof Error ? loadError.message : String(loadError),
        );
      } finally {
        setLoadingPaths((paths) => {
          const next = new Set(paths);
          next.delete(nextPath);
          return next;
        });
      }
    },
    [workspacePath],
  );

  useEffect(() => {
    setEntriesByPath({});
    setExpandedPaths(new Set(["."]));
    setSelectedFile(null);
    setPreview("");
    setPreviewCopied(false);
    setFileStat(null);
    setFilter("");
    setError("");
    if (workspacePath) void loadDir(".");
  }, [workspacePath, loadDir]);

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
      const [stat, content] = await Promise.all([
        window.marloues.fs.stat(filePath),
        window.marloues.fs.readFile(filePath),
      ]);
      setFileStat(stat);
      setPreview(content);
    } catch (readError) {
      setPreview("");
      setError(
        readError instanceof Error ? readError.message : String(readError),
      );
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
            <button
              onClick={() => void openFile(selectedFile)}
              disabled={fileLoading}
              title="重新加载"
            >
              <RefreshCcw size={14} />
            </button>
            <button
              onClick={() => void copyPreview()}
              disabled={!preview}
              title={previewCopied ? "已复制" : "复制内容"}
              aria-label={previewCopied ? "已复制内容" : "复制内容"}
            >
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
        <>
          <label className="file-filter">
            <Search size={14} aria-hidden="true" />
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="筛选文件"
              aria-label="筛选文件"
            />
          </label>
          <div className="file-list scrollbar-thin">
            <FileTree
              dirPath="."
              entries={rootEntries}
              entriesByPath={entriesByPath}
              expandedPaths={expandedPaths}
              loadingPaths={loadingPaths}
              onToggleDirectory={toggleDirectory}
              onOpenFile={openFile}
              filter={filter}
            />
          </div>
        </>
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
  filter,
  depth = 0,
}: {
  dirPath: string;
  entries: DirEntry[];
  entriesByPath: Record<string, DirEntry[]>;
  expandedPaths: Set<string>;
  loadingPaths: Set<string>;
  onToggleDirectory: (path: string) => void;
  onOpenFile: (path: string) => void;
  filter: string;
  depth?: number;
}) {
  if (loadingPaths.has(dirPath) && entries.length === 0) {
    return <div className="file-tree-empty">正在读取文件...</div>;
  }

  const normalizedFilter = filter.trim().toLocaleLowerCase();
  const visibleEntries = normalizedFilter
    ? entries.filter((entry) =>
        entry.name.toLocaleLowerCase().includes(normalizedFilter),
      )
    : entries;

  if (visibleEntries.length === 0) {
    return <div className="file-tree-empty">这个目录是空的。</div>;
  }

  return (
    <div className="file-tree">
      {visibleEntries.map((entry) => {
        const itemPath = joinWorkspacePath(dirPath, entry.name);
        const expanded = expandedPaths.has(itemPath);
        const childEntries = entriesByPath[itemPath] ?? [];

        return (
          <div key={itemPath}>
            <button
              className="file-tree-row"
              style={{ paddingLeft: fileTreeRowPadding(depth) }}
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
              {entry.isDirectory ? (
                <Folder size={14} className="folder-icon" />
              ) : (
                <FileText size={14} />
              )}
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
                filter={filter}
                depth={depth + 1}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function fileTreeRowPadding(depth: number): number {
  if (depth <= 0) return 7;
  if (depth === 1) return 21;
  return 37 + (depth - 2) * 14;
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
          <code
            dangerouslySetInnerHTML={{ __html: line.length > 0 ? line : " " }}
          />
        </div>
      ))}
    </div>
  );
}
