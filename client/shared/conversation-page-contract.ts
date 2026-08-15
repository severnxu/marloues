/** Source-derived presentation contract for the middle conversation surface. */
export const CONVERSATION_PAGE_CONTRACT = {
  source: "codex-desktop",
  sourceVersion: "26.803.10989",
  readThreadSchemaVersion: 2,
  userMessageMaxWidthPercent: 77,
  userMessageCollapsedLines: 20,
  activityExpandedMaxHeightPx: 224,
  bottomLockThresholdPx: 24,
  activityCollapseDurationMs: 220,
  activityCollapseReducedMotionMs: 120,
  threadSummary: {
    widthPx: 300,
    surfaceRadiusPx: 24,
    sectionHeaderHeightPx: 28,
    sectionAutoCollapseMs: 30_000,
    initialVisibleItems: 6,
    revealBatchSize: 50,
    expansionStateKeyPrefix: "thread-summary-panel-section-expanded-",
  },
  scrollbar: {
    widthPx: 8,
    minThumbLengthPx: 40,
    revealOnHover: true,
    revealWhileScrolling: true,
    hideDelayMs: 900,
  },
  composer: {
    commandTrigger: "/",
    skillTrigger: "$",
    mentionTrigger: "@",
    placeholder: "随心输入",
    surfaceRadiusPx: 24,
    toolbarButtonSizePx: 28,
    textareaMinHeightPx: 56,
    textareaMaxHeightPx: 150,
    maxAttachments: 6,
    maxImageBytes: 8 * 1024 * 1024,
    maxTextFileBytes: 256 * 1024,
  },
} as const;

export const USER_MESSAGE_VISUAL_CATEGORY_ORDER = [
  "images",
  "parent-context",
  "prior-conversation",
  "mcp-app-context",
  "filesystem-attachments",
  "pull-request-merge",
  "pull-request-checks",
  "pull-request-conflict",
  "response-annotations",
  "comments",
  "selected-text",
  "message",
  "metadata-actions",
] as const;

export type ComposerSuggestionKind = "command" | "skill" | "mention" | null;

export function composerSuggestionKind(
  valueBeforeCaret: string,
): ComposerSuggestionKind {
  const token = valueBeforeCaret.match(
    /(?:^|\s)([$@/])([\p{L}\p{N}\p{M}.:_/\\-]*)$/u,
  );
  if (!token) return null;
  if (token[1] === "$") return "skill";
  if (token[1] === "@") return "mention";
  return "command";
}

export function directScrollInputBreaksBottomLock(input: {
  kind: "wheel" | "touch" | "keyboard" | "scrollbar" | "programmatic";
  deltaY?: number;
}): boolean {
  if (input.kind === "programmatic") return false;
  if (input.kind === "wheel") return (input.deltaY ?? 0) < 0;
  return true;
}
