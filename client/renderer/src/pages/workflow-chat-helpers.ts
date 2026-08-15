/**
 * Pure helper types and functions extracted from WorkflowChatPage.
 */

import type { PendingSteerPreview } from "@/stores/unified-chat-store";
import type { ChatMessageRecord } from "@shared/types";
import type { WorkflowTurnItem } from "@shared/workflow-read-thread-contract";

export interface PendingModelChangeNotice {
  id: string;
  sessionId: string;
  fromModel: string;
  toModel: string;
  beforeUserMessageId?: string;
}

export interface ComposerFileChangeSummary {
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export interface ComposerFileChangeTarget {
  path: string;
  diff: string;
}

export const EMPTY_PENDING_STEERS: PendingSteerPreview[] = [];

export const SESSION_CONTENT_SETTLE_MS = 80;

export function workspaceDisplayName(
  workspace?: { name?: string; path?: string } | null,
): string {
  const name = workspace?.name?.trim();
  if (name) return name;
  const path = workspace?.path?.trim();
  if (!path) return "当前工作空间";
  return path.split(/[\\/]/).filter(Boolean).pop() ?? "当前工作空间";
}

export function genUiId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function addDiffCounts(
  summary: ComposerFileChangeSummary,
  diff?: string,
): void {
  if (!diff) return;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) summary.insertions += 1;
    if (line.startsWith("-")) summary.deletions += 1;
  }
}

export function summarizeWorkflowFileChanges(
  items: WorkflowTurnItem[],
): ComposerFileChangeSummary | undefined {
  const paths = new Set<string>();
  const summary: ComposerFileChangeSummary = {
    filesChanged: 0,
    insertions: 0,
    deletions: 0,
  };
  for (const item of items) {
    if (item.type !== "fileChange") continue;
    for (const change of item.changes) {
      if (change.path) paths.add(change.path);
      addDiffCounts(summary, change.diff?.text);
    }
  }
  if (paths.size === 0) return undefined;
  return { ...summary, filesChanged: paths.size };
}

export function firstWorkflowFileChangeTarget(
  items: WorkflowTurnItem[],
): ComposerFileChangeTarget | undefined {
  for (const item of items) {
    if (item.type !== "fileChange") continue;
    const change = item.changes.find((entry) => Boolean(entry.path));
    if (!change) continue;
    return { path: change.path, diff: change.diff?.text ?? "" };
  }
  return undefined;
}

export function summarizeMessageFileChanges(
  messages: ChatMessageRecord[],
  turnId?: string | null,
): ComposerFileChangeSummary | undefined {
  const paths = new Set<string>();
  const summary: ComposerFileChangeSummary = {
    filesChanged: 0,
    insertions: 0,
    deletions: 0,
  };
  const collectItem = (item: WorkflowTurnItem): void => {
    if (item.type !== "fileChange") return;
    for (const change of item.changes) {
      if (change.path) paths.add(change.path);
      addDiffCounts(summary, change.diff?.text);
    }
  };
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    if (turnId && !message.id.includes(turnId)) continue;
    for (const item of message.items) collectItem(item);
  }
  if (paths.size === 0) return undefined;
  return { ...summary, filesChanged: paths.size };
}

export function inferSendWorkMode(
  text: string,
  explicitMode?: "execute" | "plan",
): "execute" | "plan" {
  if (explicitMode === "plan") return "plan";
  const normalized = text.toLowerCase();
  const asksForExecution =
    /(?:开干|执行|实现|修改|修复|加上|接入|落地|改代码|implement|fix|build|add|change)/i.test(
      normalized,
    );
  if (asksForExecution) return "execute";
  const asksForPlan =
    /(?:先.*(?:计划|规划|方案|设计)|(?:计划|规划|方案|设计)一下|不要改|先别改|plan first|make a plan|design first|proposal)/i.test(
      normalized,
    );
  return asksForPlan ? "plan" : "execute";
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
