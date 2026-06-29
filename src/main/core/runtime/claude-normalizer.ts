/**
 * Claude SDK 事件 → MessageItem 归一化
 *
 * Claude SDK 的 SDKMessage 事件流归一化到稳定 MessageItem 模型，
 * 这样 workflow-chat/ 的统一渲染层可以直接渲染 Claude 的回复。
 *
 * 映射关系：
 *   system subtype=init             → (不发 item，标记 turn 开始)
 *   stream_event text_delta         → agent_message (phase: updated, 追加 text)
 *   stream_event thinking_delta     → reasoning (phase: updated, 追加 text)
 *   stream_event content_block_start tool_use → mcp_tool_call (phase: started)
 *   stream_event input_json_delta   → mcp_tool_call (phase: updated, 追加 args)
 *   user tool_result                → mcp_tool_call (phase: completed, 填充 result)
 *   result subtype=success          → (不发 item，标记 turn 完成)
 *   result subtype=error            → error
 */

import type { MessageItem } from "@shared/workflow-types";

let itemCounter = 0;

function nextId(prefix: string): string {
  itemCounter++;
  return `${prefix}-${itemCounter}-${Date.now()}`;
}

/**
 * 处理单条 SDK 消息，返回 0 或多个 MessageItem（可能是新建或更新已有的）。
 * 调用方负责合并到当前 turn 的 items 列表。
 */
export function normalizeClaudeMessage(
  message: unknown,
  context: { turnId: string; timestamp: number },
): MessageItem[] {
  const msg = message as Record<string, unknown>;
  const items: MessageItem[] = [];
  const ts = context.timestamp;

  // ── stream_event（流式 delta）──
  if (msg.type === "stream_event") {
    const event = msg.event as Record<string, unknown> | undefined;
    if (!event) return items;

    if (event.type === "content_block_delta") {
      const delta = event.delta as Record<string, unknown> | undefined;

      // 文本 delta → agent_message
      if (delta?.type === "text_delta") {
        items.push({
          id: nextId("agent"),
          type: "agent_message",
          rawType: "text_delta",
          phase: "updated",
          text: String(delta.text ?? ""),
          status: "in_progress",
          updatedAt: ts,
        });
      }

      // thinking delta → reasoning
      if (delta?.type === "thinking_delta") {
        items.push({
          id: nextId("reasoning"),
          type: "reasoning",
          rawType: "thinking_delta",
          phase: "updated",
          text: String(delta.thinking ?? ""),
          status: "in_progress",
          updatedAt: ts,
        });
      }
    }

    // content_block_start with tool_use → mcp_tool_call (started)
    if (event.type === "content_block_start") {
      const block = event.content_block as Record<string, unknown> | undefined;
      if (block?.type === "tool_use") {
        items.push({
          id: String(block.id ?? nextId("tool")),
          type: "mcp_tool_call",
          rawType: "tool_use",
          phase: "started",
          tool: String(block.name ?? "unknown"),
          args: {},
          arguments: {},
          status: "in_progress",
          startedAt: ts,
        });
      }
    }

    // content_block_delta input_json_delta → mcp_tool_call (updated)
    if (event.type === "content_block_delta") {
      const delta = event.delta as Record<string, unknown> | undefined;
      if (delta?.type === "input_json_delta") {
        const partialJson = String((delta as Record<string, unknown>).partial_json ?? "");
        const blockIndex = event.index as number | undefined;
        items.push({
          id: `tool-${blockIndex ?? 0}`,
          type: "mcp_tool_call",
          rawType: "input_json_delta",
          phase: "updated",
          tool: "tool",
          args: tryParseJson(partialJson),
          arguments: tryParseJson(partialJson),
          status: "in_progress",
          updatedAt: ts,
        });
      }
    }
    return items;
  }

  // ── assistant 消息（完整内容，非流式回退）──
  if (msg.type === "assistant") {
    const content = msg.message
      ? (msg.message as Record<string, unknown>).content
      : undefined;
    if (Array.isArray(content)) {
      for (const block of content as Array<Record<string, unknown>>) {
        if (block.type === "text" && block.text) {
          items.push({
            id: nextId("agent"),
            type: "agent_message",
            rawType: "assistant_text",
            phase: "completed",
            text: String(block.text),
            status: "completed",
            completedAt: ts,
          });
        }
        if (block.type === "thinking" && block.thinking) {
          items.push({
            id: nextId("reasoning"),
            type: "reasoning",
            rawType: "assistant_thinking",
            phase: "completed",
            text: String(block.thinking),
            status: "completed",
            completedAt: ts,
          });
        }
        if (block.type === "tool_use") {
          items.push({
            id: String(block.id ?? nextId("tool")),
            type: "mcp_tool_call",
            rawType: "tool_use",
            phase: "started",
            tool: String(block.name ?? "unknown"),
            args: block.input ?? {},
            arguments: block.input ?? {},
            status: "in_progress",
            startedAt: ts,
          });
        }
      }
    }
    return items;
  }

  // ── user 消息（工具结果）──
  if (msg.type === "user") {
    const content = msg.message
      ? (msg.message as Record<string, unknown>).content
      : undefined;
    if (Array.isArray(content)) {
      for (const block of content as Array<Record<string, unknown>>) {
        if (block.type === "tool_result") {
          items.push({
            id: String((block as Record<string, unknown>).tool_use_id ?? nextId("tool")),
            type: "mcp_tool_call",
            rawType: "tool_result",
            phase: "completed",
            tool: "tool",
            result: block.content ?? "",
            status: (block as Record<string, unknown>).is_error ? "error" : "completed",
            completedAt: ts,
          });
        }
      }
    }
    return items;
  }

  // ── result 消息（turn 结束）──
  if (msg.type === "result") {
    const isError = Boolean(msg.is_error) ||
      (msg.subtype as string) === "error_during_execution" ||
      (msg.subtype as string) === "error_max_turns";

    if (isError) {
      items.push({
        id: nextId("error"),
        type: "error",
        rawType: "result_error",
        phase: "completed",
        message: String(msg.result ?? "Model response interrupted unexpectedly."),
        error: { message: String(msg.result ?? "Unknown error") },
        status: "error",
        completedAt: ts,
      });
    }
    return items;
  }

  return items;
}

/**
 * 将一组 Claude SDK 消息归一化为完整的 MessageItem 列表（聚合 delta）。
 * 用于把整个 turn 的事件流一次性转成 items。
 */
export function normalizeClaudeTurn(
  sdkMessages: unknown[],
  turnId: string,
): MessageItem[] {
  const items = new Map<string, MessageItem>();
  let agentText = "";
  let reasoningText = "";
  let lastAgentId = "";
  let lastReasoningId = "";

  for (const sdkMsg of sdkMessages) {
    const newItems = normalizeClaudeMessage(sdkMsg, { turnId, timestamp: Date.now() });

    for (const item of newItems) {
      // agent_message: 追加 text
      if (item.type === "agent_message" && item.phase === "updated") {
        agentText += item.text ?? "";
        if (!lastAgentId) {
          lastAgentId = item.id;
          items.set(item.id, { ...item, text: agentText });
        } else {
          items.set(lastAgentId, { ...items.get(lastAgentId)!, text: agentText, updatedAt: item.updatedAt });
        }
        continue;
      }

      // reasoning: 追加 text
      if (item.type === "reasoning" && item.phase === "updated") {
        reasoningText += item.text ?? "";
        if (!lastReasoningId) {
          lastReasoningId = item.id;
          items.set(item.id, { ...item, text: reasoningText });
        } else {
          items.set(lastReasoningId, { ...items.get(lastReasoningId)!, text: reasoningText, updatedAt: item.updatedAt });
        }
        continue;
      }

      // mcp_tool_call: 合并
      if (item.type === "mcp_tool_call") {
        const existing = items.get(item.id);
        if (existing) {
          items.set(item.id, {
            ...existing,
            ...item,
            args: item.args && Object.keys(item.args as object).length > 0 ? item.args : existing.args,
            arguments: item.arguments && Object.keys(item.arguments as object).length > 0 ? item.arguments : existing.arguments,
            result: item.result ?? existing.result,
            status: item.status ?? existing.status,
          });
        } else {
          items.set(item.id, item);
        }
        continue;
      }

      // error / 其他
      items.set(item.id, item);
    }
  }

  return Array.from(items.values());
}

function tryParseJson(text: string): unknown {
  if (!text || text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}
