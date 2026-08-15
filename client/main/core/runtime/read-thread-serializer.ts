import {
  WORKFLOW_READ_THREAD_SCHEMA_VERSION,
  type WorkflowReadThreadResponse,
  type WorkflowThreadInfo,
  type WorkflowTurn,
  type WorkflowTurnError,
  type WorkflowTurnItem,
  type WorkflowTurnStatus,
} from "../../../shared/workflow-read-thread-contract";
import type { WorkflowReadThreadInput } from "../../../shared/workflow-thread-data-source";
import type { TokenUsage } from "../../../shared/types";

export interface WorkflowThreadStoreItem {
  item: WorkflowTurnItem;
}

export interface WorkflowThreadStoreTurn {
  id: string;
  status: WorkflowTurnStatus;
  error: WorkflowTurnError | null;
  startedAt?: number | string | null;
  completedAt?: number | string | null;
  durationMs?: number | null;
  modelId?: string | null;
  modelName?: string | null;
  usage?: TokenUsage;
  itemOrder: string[];
  items: Map<string, WorkflowThreadStoreItem>;
}

export interface WorkflowThreadStoreThread {
  id: string;
  title: string;
  preview: string;
  status: WorkflowThreadInfo["status"];
  cwd?: string | null;
  createdAt?: number | string | null;
  updatedAt?: number | string | null;
  turnOrder: string[];
  turns: Map<string, WorkflowThreadStoreTurn>;
}

export function serializeWorkflowThread(
  thread: WorkflowThreadStoreThread,
  input: WorkflowReadThreadInput = {},
): WorkflowReadThreadResponse {
  const limit = Math.max(1, input.limit ?? 100);
  const offset = parseCursor(input.cursor);
  const newestFirstTurns = [...thread.turnOrder]
    .reverse()
    .map((turnId) => thread.turns.get(turnId))
    .filter((turn): turn is WorkflowThreadStoreTurn => Boolean(turn));
  const pageTurns = newestFirstTurns.slice(offset, offset + limit);
  const nextOffset = offset + pageTurns.length;

  return {
    schemaVersion: WORKFLOW_READ_THREAD_SCHEMA_VERSION,
    thread: {
      id: thread.id,
      title: thread.title,
      preview: thread.preview,
      status: thread.status,
      cwd: thread.cwd ?? null,
      createdAt: thread.createdAt ?? null,
      updatedAt: thread.updatedAt ?? null,
    },
    page: {
      order: "newest_first",
      limit,
      nextCursor:
        nextOffset < newestFirstTurns.length ? String(nextOffset) : null,
      hasMore: nextOffset < newestFirstTurns.length,
    },
    turns: pageTurns.map(serializeTurn),
  };
}

function serializeTurn(turn: WorkflowThreadStoreTurn): WorkflowTurn {
  return {
    id: turn.id,
    zone: "workspace",
    status: turn.status,
    error: turn.error,
    startedAt: turn.startedAt ?? null,
    completedAt: turn.completedAt ?? null,
    durationMs: turn.durationMs ?? null,
    modelId: turn.modelId ?? null,
    modelName: turn.modelName ?? null,
    usage: turn.usage,
    items: turn.itemOrder
      .map((itemId) => turn.items.get(itemId)?.item)
      .filter((item): item is WorkflowTurnItem => Boolean(item)),
  };
}

function parseCursor(cursor: string | null | undefined): number {
  if (!cursor) return 0;
  const parsed = Number.parseInt(cursor, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
