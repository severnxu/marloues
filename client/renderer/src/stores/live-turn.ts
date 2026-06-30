import type { MessageBlock, TimelineItem, TokenUsage } from "@shared/types";

export type ChatLiveTurn = {
  turnId: string | null;
  status: ChatLiveTurnStatus;
  startedAt: number;
  content: string;
  blocks: MessageBlock[];
  timeline: TimelineItem[];
  compactionActive?: boolean;
  compactionSettled?: boolean;
  contextBlocked?: boolean;
  usage?: TokenUsage;
};

export type ChatLiveTurnStatus = "pending" | "running" | "completed" | "error" | "aborted";

export interface LiveTurnPresentation {
  blocks: MessageBlock[];
  showInitialThinking: boolean;
  showStatusLine: boolean;
  showThinkingPlaceholder: boolean;
  renderLiveMessage: boolean;
  thinkingActive: boolean;
  hasThinkingContent: boolean;
}

export type ToolResult = Extract<MessageBlock, { type: "tool_result" }>["result"];

export type MarkdownBlock =
  | { type: "paragraph"; text: string }
  | { type: "code"; text: string }
  | { type: "list"; items: string[] };

export function fallbackLiveBlocks(liveTurn: ChatLiveTurn): MessageBlock[] {
  if (liveTurn.blocks.length > 0) return liveTurn.blocks;
  const text = liveTurn.content || (liveTurn.status === "aborted" ? "Stopped by user." : "");
  return text ? [{ id: "pending", type: "text", text }] : [];
}

export function deriveLiveTurnPresentation(liveTurn: ChatLiveTurn, now: number): LiveTurnPresentation {
  const blocks = fallbackLiveBlocks(liveTurn);
  const hasThinkingContent = blocks.some((block) => block.type === "thinking" && block.text.trim());
  const hasProcessEvidence = liveTurn.timeline.length > 0 || blocks.length > 0 || Boolean(liveTurn.compactionActive);
  const suppressLiveChrome = liveTurn.compactionActive || liveTurn.compactionSettled || liveTurn.status === "completed";
  const showInitialThinking = !suppressLiveChrome && blocks.length === 0 && now - liveTurn.startedAt < 700;
  const showPendingWait = !suppressLiveChrome && blocks.length === 0 && liveTurn.status === "pending";
  const thinkingActive = liveTurn.status === "pending" || liveTurn.status === "running";
  const processingStarted =
    !showInitialThinking &&
    (liveTurn.status !== "completed"
      ? liveTurn.status !== "pending" || Boolean(liveTurn.turnId) || hasProcessEvidence
      : hasProcessEvidence);

  return {
    blocks,
    showInitialThinking,
    showStatusLine:
      !liveTurn.compactionActive && !liveTurn.compactionSettled && processingStarted && !hasThinkingContent,
    showThinkingPlaceholder:
      !showInitialThinking && blocks.length === 0 && (showPendingWait || (!suppressLiveChrome && processingStarted)),
    renderLiveMessage: blocks.length > 0,
    thinkingActive,
    hasThinkingContent,
  };
}

export function mergeLiveTurnRuntimeStatus(
  current: ChatLiveTurnStatus,
  incoming: ChatLiveTurnStatus,
): ChatLiveTurnStatus {
  if (current === "completed" || current === "error" || current === "aborted") return current;
  return incoming;
}

export function textFromBlocks(blocks: MessageBlock[], fallback: string): string {
  const text = blocks
    .filter((block): block is Extract<MessageBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("\n\n")
    .trim();
  return text || fallback;
}

export function toolResultsById(blocks: MessageBlock[]): Map<string, ToolResult> {
  const results = new Map<string, ToolResult>();
  for (const block of blocks) {
    if (block.type === "tool_result") results.set(block.result.id, block.result);
  }
  return results;
}

export function formatUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value ?? {}, null, 2);
}

export function stripThinkingTags(text: string): string {
  return text
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim();
}

export function splitMarkdownBlocks(text: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const parts = text.split(/```(?:\w+)?\n?/);

  parts.forEach((part, index) => {
    const value = part.trim();
    if (!value) return;
    if (index % 2 === 1) {
      blocks.push({ type: "code", text: value });
      return;
    }

    for (const paragraph of value.split(/\n{2,}/)) {
      const lines = paragraph
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      if (lines.length > 0 && lines.every((line) => /^[-*]\s+/.test(line))) {
        blocks.push({ type: "list", items: lines.map((line) => line.replace(/^[-*]\s+/, "")) });
      } else {
        blocks.push({ type: "paragraph", text: paragraph.trim() });
      }
    }
  });

  return blocks.length ? blocks : [{ type: "paragraph", text }];
}
