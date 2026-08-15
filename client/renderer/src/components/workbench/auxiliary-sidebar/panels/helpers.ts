import type { TimelineItem } from "@shared/types";

export function compactText(value: string, maxLength: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > maxLength
    ? `${text.slice(0, maxLength)}...`
    : text || "空内容";
}

export function joinWorkspacePath(parent: string, name: string): string {
  return parent === "." ? name : `${parent}/${name}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

export function languageFromPath(path: string): string {
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

export async function copyToClipboard(text: string): Promise<void> {
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

export function readTimelineDetailArray(
  item: TimelineItem,
): Array<Record<string, unknown>> {
  if (!item.detail) return [];
  try {
    const value = JSON.parse(item.detail) as unknown;
    return Array.isArray(value)
      ? value.filter(
          (entry): entry is Record<string, unknown> =>
            Boolean(entry) && typeof entry === "object",
        )
      : [];
  } catch {
    return [];
  }
}
