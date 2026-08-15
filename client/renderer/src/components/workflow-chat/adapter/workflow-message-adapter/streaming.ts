import type { Message } from "./types";
import type { WorkflowTurnItem } from "@shared/adapters/workflow-messages-to-read-thread";
import { stripThinkTags } from "./shared-helpers";

/**
 * 双路径归一化已删除（Phase 2）：message.items 已是 WorkflowTurnItem[]，
 * 直接透传 + compact 去重，不再从 rawEvents 或旧格式派生。
 */
export function itemsFromAssistantMessage(
  message: Message,
): WorkflowTurnItem[] {
  return compactItems(message.items);
}

export function compactItems(items: WorkflowTurnItem[]): WorkflowTurnItem[] {
  const compacted: WorkflowTurnItem[] = [];
  const seenText = new Set<string>();

  // Pre-collect normalized agentMessage texts so we can detect when a later
  // agentMessage (created after a tool boundary) subsumes an earlier one.
  // In cumulative streaming the text.chunk after a tool carries the FULL
  // text so far, so the new agentMessage starts with the previous one's text.
  // We drop the earlier item because the later one fully contains it.
  const agentTextKeys: string[] = [];
  for (const item of items) {
    if (item.type === "agentMessage") {
      const text = stripThinkTags(item.text);
      agentTextKeys.push(text.replace(/\s+/g, " ").trim());
    }
  }
  let agentCursor = 0;

  for (const item of items) {
    if (item.type === "agentMessage") {
      const text = stripThinkTags(item.text);
      const key = text.replace(/\s+/g, " ").trim();
      const currentIndex = agentCursor;
      agentCursor += 1;
      if (!key || seenText.has(key)) continue;

      // Skip if a later agentMessage's text starts with this one's text —
      // the later item carries all of this item's content (cumulative stream).
      const subsumedByLater = agentTextKeys.some(
        (laterKey, laterIndex) =>
          laterIndex > currentIndex &&
          laterKey !== key &&
          laterKey.startsWith(key),
      );
      if (subsumedByLater) continue;

      seenText.add(key);
      compacted.push({ ...item, text });
      continue;
    }

    if (item.type === "reasoning") {
      const key = `${item.summary}|${item.encrypted ? "encrypted" : "plain"}`;
      if (seenText.has(key)) continue;
      seenText.add(key);
      compacted.push({ ...item });
      continue;
    }

    compacted.push({ ...item });
  }

  return compacted;
}
