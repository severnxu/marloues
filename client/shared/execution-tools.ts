/** Tool-name classification used by both the runtime and the renderer. */

function normalizedToolName(toolName: string): string {
  return toolName
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

/** Tools that start a worker whose transcript belongs in the subagent view. */
export function isSubagentDelegationToolName(toolName: string): boolean {
  const normalized = normalizedToolName(toolName);
  return normalized === "agent" || normalized === "task";
}

/** SDK task-management tools whose state belongs in the task list. */
export function isTaskManagementToolName(toolName: string): boolean {
  const normalized = normalizedToolName(toolName);
  return (
    normalized === "taskcreate" ||
    normalized === "task_create" ||
    normalized === "taskupdate" ||
    normalized === "task_update" ||
    normalized === "taskget" ||
    normalized === "task_get" ||
    normalized === "tasklist" ||
    normalized === "task_list" ||
    normalized === "taskstop" ||
    normalized === "task_stop"
  );
}

export function isTaskCreateToolName(toolName: string): boolean {
  const normalized = normalizedToolName(toolName);
  return normalized === "taskcreate" || normalized === "task_create";
}

export function isTaskUpdateToolName(toolName: string): boolean {
  const normalized = normalizedToolName(toolName);
  return normalized === "taskupdate" || normalized === "task_update";
}

export function isTaskGetToolName(toolName: string): boolean {
  const normalized = normalizedToolName(toolName);
  return normalized === "taskget" || normalized === "task_get";
}

export function isTaskListToolName(toolName: string): boolean {
  const normalized = normalizedToolName(toolName);
  return normalized === "tasklist" || normalized === "task_list";
}

export function isTaskStopToolName(toolName: string): boolean {
  const normalized = normalizedToolName(toolName);
  return normalized === "taskstop" || normalized === "task_stop";
}
