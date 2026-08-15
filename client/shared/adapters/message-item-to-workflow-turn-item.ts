/**
 * Converts a legacy MessageItem (Claude SDK normalized shape) into the
 * canonical WorkflowTurnItem contract (schema v2). Used at the legacy
 * main-process boundary so that item events and stored messages expose the
 * same shape the renderer workflow-chat consumes.
 */

import type { MessageItem } from "../workflow-types";
import type { WorkflowTurnItem } from "../workflow-read-thread-contract";

function textOutput(
  value: unknown,
): { text: string; truncated: false } | undefined {
  if (typeof value !== "string" || !value) return undefined;
  return { text: value, truncated: false };
}

export function messageItemToWorkflowTurnItem(
  item: MessageItem,
): WorkflowTurnItem {
  const settled =
    item.status === "completed" ||
    item.status === "error" ||
    item.status === "failed" ||
    item.status === "denied";

  switch (item.type) {
    case "agent_message":
      return {
        type: "agentMessage",
        id: item.id,
        text: item.text ?? "",
        phase: item.phase ?? "updated",
        settled,
      };
    case "reasoning":
      return {
        type: "reasoning",
        id: item.id,
        summary: item.text ?? "",
        ...(item.text
          ? { content: [{ text: item.text, truncated: false }] }
          : {}),
        settled,
      };
    case "mcp_tool_call":
      return {
        type: "mcpToolCall",
        id: item.id,
        tool: item.toolName ?? item.tool ?? "tool",
        server: item.server,
        arguments: item.args ?? item.arguments,
        status: workflowStatus(item.status),
        ...(textOutput(item.result) ? { output: textOutput(item.result) } : {}),
        settled,
      };
    case "web_search":
      return {
        type: "webSearch",
        id: item.id,
        query: item.query,
        settled,
      };
    case "command_execution":
      return {
        type: "commandExecution",
        id: item.id,
        command: item.command ?? "",
        shell: item.shell,
        status: workflowStatus(item.status),
        exitCode: item.exit_code ?? null,
        ...(textOutput(item.aggregated_output)
          ? { output: textOutput(item.aggregated_output) }
          : {}),
        settled,
      };
    case "file_change":
      return {
        type: "fileChange",
        id: item.id,
        status: workflowStatus(item.status),
        changes: (item.changes ?? []).map((change) => ({
          path: change.path,
          kind: change.kind,
        })),
        settled,
      };
    case "permission_request":
      return {
        type: "permissionRequest",
        id: item.id,
        toolName: item.toolName ?? item.tool ?? "tool",
        reason: item.reason ?? item.message ?? "",
        status: workflowStatus(
          item.status ?? (item.phase === "completed" ? "completed" : "running"),
        ),
        timeoutMs: item.timeoutMs ?? null,
        settled,
      };
    default:
      return {
        type: "unknown",
        id: item.id,
        rawType: item.rawType ?? String(item.type),
        raw: item,
        settled,
      };
  }
}

function workflowStatus(status: MessageItem["status"] | undefined): string {
  const value = status ?? "running";
  return value === "in_progress" || value === "pending" ? "running" : value;
}
