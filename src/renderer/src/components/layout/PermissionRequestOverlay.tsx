import { useEffect, useState } from "react";
import { Check, Copy, FileText, Terminal } from "lucide-react";
import type { PermissionDialogRequest } from "@shared/types";

type PermissionDetails = {
  toolName: string;
  title: string;
  description: string;
  command?: string;
  target?: string;
  previewLabel?: string;
  preview?: string;
  copyText?: string;
};

function formatPermissionRequest(request: PermissionDialogRequest): PermissionDetails {
  const raw = request.inputSummary || request.reason || "";
  const parsed = parsePermissionInput(raw);
  const displayName = readString(parsed, "displayName") ?? request.toolName;
  const input = readRecord(parsed, "input") ?? parsed;
  const command = readString(input, "command");
  const filePath = readString(input, "file_path") ?? readString(input, "path");
  const content = readString(input, "content") ?? readString(input, "new_string");
  const oldString = readString(input, "old_string");
  const description = readString(input, "description") ?? readString(parsed, "description") ?? request.reason;

  if (request.toolName === "Write" && filePath) {
    return {
      toolName: displayName,
      title: `需要允许 Marloues 写入 ${shortPath(filePath)}？`,
      description: "这个操作会创建或覆盖文件，请先确认目标和内容。",
      target: filePath,
      previewLabel: "将写入内容",
      preview: content ? createNewFilePatch(filePath, content) : raw,
      copyText: content ?? filePath,
    };
  }

  if ((request.toolName === "Edit" || request.toolName === "MultiEdit") && filePath) {
    return {
      toolName: displayName,
      title: `需要允许 Marloues 修改 ${shortPath(filePath)}？`,
      description: description || "这个操作会修改文件内容。",
      target: filePath,
      previewLabel: oldString || content ? "修改预览" : "请求参数",
      preview: oldString || content ? formatEditPreview(oldString, content) : formatPreviewValue(input ?? raw),
      copyText: filePath,
    };
  }

  if (request.toolName === "Bash" && command) {
    return {
      toolName: displayName,
      title: "需要允许 Marloues 运行命令？",
      description: description || "Marloues 想运行一个需要确认的命令。",
      command,
      previewLabel: "命令",
      preview: command,
      copyText: command,
    };
  }

  if (command) {
    return {
      toolName: displayName,
      title: `需要允许 Marloues 运行 ${displayName}？`,
      description: description || "Marloues 想运行一个需要确认的工具。",
      command,
      previewLabel: "命令",
      preview: command,
      copyText: command,
    };
  }

  return {
    toolName: displayName,
    title: `需要允许 Marloues 使用 ${displayName}？`,
    description: description || "Marloues 想运行一个需要确认的工具。",
    target: request.cwd,
    previewLabel: raw.trim() ? "请求参数" : undefined,
    preview: raw.includes("\n") ? raw : formatPreviewValue(parsed ?? raw),
    copyText: raw.trim() ? raw : undefined,
  };
}

type PermissionChoice = "once" | "session" | "deny";
const DEFAULT_DENY_REASON = "否，请告诉 Marloues 如何调整";

export function PermissionRequestOverlay({
  request,
  onRespond,
  variant = "overlay",
}: {
  request?: PermissionDialogRequest;
  onRespond: (approved: boolean, scope?: "once" | "session", reason?: string) => void;
  variant?: "overlay" | "embedded";
}) {
  const [choice, setChoice] = useState<PermissionChoice>("once");
  const [denyReason, setDenyReason] = useState(DEFAULT_DENY_REASON);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setChoice("once");
    setDenyReason(DEFAULT_DENY_REASON);
    setCopied(false);
  }, [request?.id]);

  if (!request) return null;
  const details = formatPermissionRequest(request);

  const submitPermissionChoice = () => {
    const reason = denyReason.trim();
    onRespond(false, "once", reason && reason !== DEFAULT_DENY_REASON ? reason : undefined);
  };

  const copyPreview = async () => {
    if (!details.copyText) return;
    try {
      await copyToClipboard(details.copyText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  const card = (
      <section className={`permission-card ${variant === "embedded" ? "embedded" : ""}`} role="dialog" aria-label="工具权限确认">
        <div className="permission-card-main">
          <div className="permission-card-head">
            <div>
              <h2>{details.title}</h2>
              <span>{details.description}</span>
            </div>
          </div>
          {details.target ? (
            <div className="permission-target">
              <FileText size={15} />
              <code>{details.target}</code>
            </div>
          ) : null}
          {details.command ? (
            <div className="permission-command">
              <Terminal size={15} />
              <code>{details.command}</code>
            </div>
          ) : null}
          {details.preview ? (
            <div className="permission-preview">
              <div className="permission-preview-head">
                <span>{details.previewLabel ?? "预览"}</span>
                {details.copyText ? (
                  <button type="button" onClick={() => void copyPreview()} title={copied ? "已复制" : "复制内容"} aria-label={copied ? "已复制内容" : "复制内容"}>
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                    {copied ? "已复制" : "复制"}
                  </button>
                ) : null}
              </div>
              <pre>{details.preview}</pre>
            </div>
          ) : null}
          <div className="permission-options" role="radiogroup" aria-label="选择如何处理权限请求">
            <button
              className={`permission-option ${choice === "once" ? "selected" : ""}`}
              type="button"
              role="radio"
              aria-checked={choice === "once"}
              onFocus={() => setChoice("once")}
              onClick={() => {
                setChoice("once");
                onRespond(true, "once");
              }}
            >
              <span className="permission-option-index">1</span>
              <span>是</span>
              <small>允许这一次操作</small>
              <span className="permission-option-shortcuts">↑ ↓</span>
            </button>
            <button
              className={`permission-option ${choice === "session" ? "selected" : ""}`}
              type="button"
              role="radio"
              aria-checked={choice === "session"}
              onFocus={() => setChoice("session")}
              onClick={() => {
                setChoice("session");
                onRespond(true, "session");
              }}
            >
              <span className="permission-option-index">2</span>
              <span>是，并且之后类似请求不再询问</span>
              <small>{details.toolName}</small>
            </button>
            <div className="permission-deny-row">
              <label
                className={`permission-option permission-option-input ${choice === "deny" ? "selected" : ""}`}
                role="radio"
                aria-checked={choice === "deny"}
              >
                <span className="permission-option-index edit">3</span>
                <textarea
                  className="permission-deny-input"
                  value={denyReason}
                  onFocus={() => setChoice("deny")}
                  onChange={(event) => {
                    setChoice("deny");
                    setDenyReason(event.target.value);
                  }}
                  rows={1}
                />
              </label>
              <div className="permission-deny-actions">
                <button type="button" onClick={() => onRespond(false, "once")}>
                  跳过
                </button>
                <button className="allow" type="button" onClick={submitPermissionChoice}>
                  提交
                  <Check size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
  );

  if (variant === "embedded") return card;

  return (
    <div className="permission-overlay" role="presentation">
      {card}
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

function parsePermissionInput(inputSummary: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(inputSummary) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function readRecord(record: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  const value = record?.[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function readString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function shortPath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function formatPreviewValue(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() ? value : undefined;
  if (value === undefined) return undefined;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatEditPreview(oldString: string | undefined, newString: string | undefined): string {
  const lines: string[] = [];
  if (oldString) {
    lines.push("--- 原内容", ...oldString.split(/\r?\n/).slice(0, 80).map((line) => `- ${line}`));
  }
  if (newString) {
    if (lines.length) lines.push("");
    lines.push("+++ 新内容", ...newString.split(/\r?\n/).slice(0, 80).map((line) => `+ ${line}`));
  }
  return lines.join("\n");
}

function createNewFilePatch(filePath: string, content: string): string {
  const normalizedPath = filePath.replace(/\\/g, "/");
  const lines = content.split(/\r?\n/);
  const addedLines = lines
    .slice(0, 120)
    .map((line) => `+${line}`)
    .join("\n");
  const truncated = lines.length > 120 ? "\n+..." : "";
  return [
    `diff --git a/${normalizedPath} b/${normalizedPath}`,
    "new file mode 100644",
    "index 0000000..0000000",
    "--- /dev/null",
    `+++ b/${normalizedPath}`,
    `@@ -0,0 +1,${Math.max(lines.length, 1)} @@`,
    `${addedLines}${truncated}`,
  ].join("\n");
}
