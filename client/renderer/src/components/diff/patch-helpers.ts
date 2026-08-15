/**
 * Diff 补丁归一化与共享样式。
 *
 * `normalizePatchForDiffs` 把 apply_patch 格式（或纯 +/- 片段）转成
 * `@pierre/diffs` 期望的 unified diff 文本；`DIFF_VIEW_SCROLL_CSS`
 * 注入到 PatchDiff shadow DOM 中统一滚动条样式。
 * 被 FileChangeRow 的对话内 diff 卡片和右侧审核面板共用。
 */

export const DIFF_VIEW_SCROLL_CSS = `
[data-diff] {
  overflow: auto !important;
  max-width: 100% !important;
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

function extractPatchPath(lines: string[]): string {
  for (const line of lines) {
    const match = line.match(/^\*\*\*\s+(?:Add|Update|Delete) File:\s+(.+)$/);
    if (match?.[1]) return match[1].trim();
  }
  return "";
}

export function normalizePatchForDiffs(
  patch: string,
  fallbackPath: string,
): string {
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
