import type { ExecutionTaskRecord } from "@/stores/unified-chat-store";
import type {
  AgentSecurityMode,
  WorkspaceGitContext,
  WorkspaceInfo,
} from "@shared/types";
import type {
  WorkflowReadThreadResponse,
  WorkflowTurn,
  WorkflowTurnItem,
} from "@shared/workflow-read-thread-contract";
import {
  firstWorkflowFileChangeTarget,
  summarizeWorkflowFileChanges,
  type ComposerFileChangeTarget,
} from "@/pages/workflow-chat-helpers";

export interface TaskPresentationModel {
  sessionId: string | null;
  hasData: boolean;
  workspace: (WorkspaceInfo & { git: WorkspaceGitContext | null }) | null;
  changes: {
    filesChanged: number;
    insertions: number;
    deletions: number;
    reviewTarget?: ComposerFileChangeTarget;
  } | null;
  modelName?: string;
  securityMode?: AgentSecurityMode;
  tasks: ExecutionTaskRecord[];
  processes: Array<{
    id: string;
    command: string;
    cwd?: string;
    status: string;
  }>;
  sources: Array<{
    id: string;
    kind: "web" | "mcp";
    label: string;
    detail?: string;
    count: number;
  }>;
}

export function buildTaskPresentationModel({
  sessionId,
  readThread,
  workspace,
  gitContext,
  tasks = [],
  securityMode,
  fallbackModelName,
}: {
  sessionId: string | null;
  readThread?: WorkflowReadThreadResponse;
  workspace?: WorkspaceInfo | null;
  gitContext?: WorkspaceGitContext | null;
  tasks?: ExecutionTaskRecord[];
  securityMode?: AgentSecurityMode;
  fallbackModelName?: string;
}): TaskPresentationModel {
  const focusTurn = taskFocusTurn(readThread);
  const scopedTasks = tasks
    .filter(
      (task) => !focusTurn || !task.turnId || task.turnId === focusTurn.id,
    )
    .sort((left, right) => left.ordinal - right.ordinal);
  const hasData = Boolean(sessionId && (focusTurn || scopedTasks.length));

  return {
    sessionId,
    hasData,
    workspace:
      hasData && workspace ? { ...workspace, git: gitContext ?? null } : null,
    changes:
      hasData && focusTurn ? taskChangeSummary(focusTurn, gitContext) : null,
    modelName: focusTurn?.modelName ?? focusTurn?.modelId ?? fallbackModelName,
    securityMode,
    tasks: hasData ? scopedTasks : [],
    processes: hasData && focusTurn ? runningProcesses(focusTurn.items) : [],
    sources: hasData && focusTurn ? taskSources(focusTurn.items) : [],
  };
}

export function taskFocusTurn(
  readThread?: WorkflowReadThreadResponse,
): WorkflowTurn | undefined {
  if (!readThread?.turns.length) return undefined;
  const newestFirst =
    readThread.page.order === "newest_first"
      ? readThread.turns
      : [...readThread.turns].reverse();
  return (
    newestFirst.find((turn) => turn.status === "running") ?? newestFirst[0]
  );
}

function taskChangeSummary(
  turn: WorkflowTurn,
  gitContext?: WorkspaceGitContext | null,
): TaskPresentationModel["changes"] {
  const eventSummary = summarizeWorkflowFileChanges(turn.items);
  const reviewTarget = firstWorkflowFileChangeTarget(turn.items);
  const gitSummary =
    gitContext && gitContext.changedFiles > 0
      ? {
          filesChanged: gitContext.changedFiles,
          insertions: gitContext.insertions,
          deletions: gitContext.deletions,
        }
      : undefined;
  const summary = gitSummary ?? eventSummary;
  return summary ? { ...summary, reviewTarget } : null;
}

function runningProcesses(
  items: WorkflowTurnItem[],
): TaskPresentationModel["processes"] {
  return items
    .filter(
      (item): item is Extract<WorkflowTurnItem, { type: "commandExecution" }> =>
        item.type === "commandExecution" && isRunning(item.status),
    )
    .slice(-6)
    .map((item) => ({
      id: item.id,
      command: item.command.split(/\r?\n/, 1)[0]?.trim() || "命令",
      cwd: item.cwd,
      status: item.status,
    }));
}

function taskSources(
  items: WorkflowTurnItem[],
): TaskPresentationModel["sources"] {
  const webQueries = items
    .filter(
      (item): item is Extract<WorkflowTurnItem, { type: "webSearch" }> =>
        item.type === "webSearch",
    )
    .map((item) => item.query?.trim())
    .filter((query): query is string => Boolean(query));
  const sources: TaskPresentationModel["sources"] = [];
  if (webQueries.length) {
    sources.push({
      id: "web-search",
      kind: "web",
      label: "网页搜索",
      detail: webQueries.at(-1),
      count: webQueries.length,
    });
  }

  const mcpCounts = new Map<string, number>();
  for (const item of items) {
    if (item.type !== "mcpToolCall") continue;
    const label = item.server?.trim() || item.tool;
    mcpCounts.set(label, (mcpCounts.get(label) ?? 0) + 1);
  }
  for (const [label, count] of mcpCounts) {
    sources.push({ id: `mcp:${label}`, kind: "mcp", label, count });
  }
  return sources;
}

function isRunning(status: string): boolean {
  const value = status.toLowerCase();
  return value === "running" || value === "pending" || value === "in_progress";
}
