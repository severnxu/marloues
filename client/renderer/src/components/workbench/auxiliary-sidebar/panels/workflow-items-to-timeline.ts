import type { TimelineItem } from "@shared/types";
import type { WorkflowTurn } from "@shared/workflow-read-thread-contract";

/** Projects WorkflowTurnItem[] (snapshot path) into TimelineItem[] so the
 * auxiliary panels keep working with their existing TimelineItem-based
 * builders after liveTurns removal.
 *
 * WorkflowTurnItem carries no per-item timestamp, so each item is anchored
 * to its turn's completion (settled) or start (running), keeping cross-turn
 * ordering and relative-time labels meaningful instead of all sharing one
 * projection instant. */
export function workflowItemsToTimeline(
  turns: readonly WorkflowTurn[],
): TimelineItem[] {
  const out: TimelineItem[] = [];
  for (const turn of turns) {
    const ts = toMs(turn.completedAt) ?? toMs(turn.startedAt) ?? Date.now();
    for (const item of turn.items) {
      switch (item.type) {
        case "dynamicToolCall":
          out.push({
            id: item.id,
            type: "tool_result",
            label: item.tool,
            detail:
              typeof item.output?.text === "string" ? item.output.text : "",
            createdAt: ts,
            status: item.status === "completed" ? "completed" : "running",
            isError: item.success === false,
            toolName: item.tool,
            toolInput: item.arguments,
            toolOutput:
              typeof item.output?.text === "string"
                ? item.output.text
                : undefined,
          });
          break;
        case "fileChange":
          for (const change of item.changes) {
            out.push({
              id: `${item.id}:${change.path}`,
              type: "tool_result",
              label: change.kind || "fileChange",
              detail: change.diff?.text ?? "",
              createdAt: ts,
              status: "completed",
              isError: false,
              toolName: change.kind || "fileChange",
              toolInput: { file_path: change.path },
              toolOutput: change.diff?.text,
            });
          }
          break;
        case "commandExecution":
          out.push({
            id: item.id,
            type: "tool_result",
            label: item.command,
            detail: item.output?.text ?? "",
            createdAt: ts,
            status:
              item.status === "completed"
                ? "completed"
                : item.status === "error" || item.status === "failed"
                  ? "error"
                  : "running",
            isError: item.status === "error" || item.status === "failed",
            toolName: "command",
            toolInput: {
              command: item.command,
              shell: item.shell,
              cwd: item.cwd,
            },
            toolOutput: item.output?.text,
          });
          break;
        case "plan":
          out.push({
            id: item.id,
            type: "tool_start",
            label: "Plan",
            detail: item.text,
            createdAt: ts,
            status: item.settled ? "completed" : "running",
            toolName: "review_plan",
            toolInput: undefined,
          });
          break;
        case "reasoning":
          out.push({
            id: item.id,
            type: "thinking",
            label: "Reasoning",
            detail: item.summary,
            createdAt: ts,
          });
          break;
        case "permissionRequest":
          out.push({
            id: item.id,
            type: "status",
            label: item.toolName,
            detail: item.reason,
            createdAt: ts,
            status:
              item.status === "completed"
                ? "completed"
                : item.status === "failed" || item.status === "error"
                  ? "error"
                  : "running",
          });
          break;
        default:
          break;
      }
    }
  }
  return out;
}

function toMs(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "number") return value;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}
