import { randomUUID } from "node:crypto";
import type {
  ChatSendReceipt,
  ScheduledTaskInput,
  ScheduledTaskMetadata,
  ScheduledTaskRecord,
  ScheduledTaskRunRecord,
  ScheduledTaskRunStatus,
} from "@shared/types";
import { nextRunAfter, parseCron } from "@shared/schedule/cron-parser";
import { nextRunFromMetadata } from "@shared/schedule/schedule-config";
import { getStateDb } from "../core/storage/state-db";

interface ScheduledTaskRow {
  id: string;
  name: string;
  instruction: string;
  workspace_path: string;
  kind: "once" | "cron";
  run_at: number | null;
  cron_expr: string | null;
  enabled: number;
  next_run_at: number | null;
  last_run_at: number | null;
  last_run_status: string | null;
  fail_count: number | null;
  metadata_json: string | null;
  created_at: number;
  updated_at: number;
}

interface ScheduledTaskRunRow {
  id: string;
  task_id: string;
  session_id: string | null;
  status: ScheduledTaskRunStatus;
  started_at: number | null;
  finished_at: number | null;
  error: string | null;
  receipt_json: string | null;
  created_at: number;
}

function parseMetadata(
  value: string | null,
): ScheduledTaskMetadata | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as ScheduledTaskMetadata;
  } catch {
    return undefined;
  }
}

function rowToTask(row: ScheduledTaskRow): ScheduledTaskRecord {
  return {
    id: row.id,
    name: row.name,
    instruction: row.instruction,
    workspacePath: row.workspace_path,
    kind: row.kind,
    runAt: row.run_at ?? undefined,
    cronExpr: row.cron_expr ?? undefined,
    enabled: row.enabled === 1,
    nextRunAt: row.next_run_at ?? undefined,
    lastRunAt: row.last_run_at ?? undefined,
    lastRunStatus: row.last_run_status ?? undefined,
    failCount: row.fail_count ?? 0,
    metadata: parseMetadata(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToRun(row: ScheduledTaskRunRow): ScheduledTaskRunRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    sessionId: row.session_id ?? undefined,
    status: row.status,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    error: row.error ?? undefined,
    receiptJson: row.receipt_json ?? undefined,
    createdAt: row.created_at,
  };
}

function normalizeInput(input: ScheduledTaskInput): ScheduledTaskInput {
  const name = input.name.trim();
  const instruction = input.instruction.trim();
  const workspacePath = input.workspacePath.trim();
  if (!name) throw new Error("任务名称不能为空");
  if (!instruction) throw new Error("执行指令不能为空");
  if (!workspacePath) throw new Error("工作区路径不能为空");
  if (input.kind === "once" && typeof input.runAt !== "number") {
    throw new Error("一次性任务缺少执行时间");
  }
  if (
    input.kind === "cron" &&
    !input.metadata &&
    !parseCron(input.cronExpr ?? "")
  ) {
    throw new Error("Cron 表达式无效");
  }
  return { ...input, name, instruction, workspacePath };
}

function computeNextRunAt(
  input: Pick<ScheduledTaskRecord, "kind" | "runAt" | "cronExpr" | "metadata">,
  after = Date.now(),
): number | undefined {
  if (input.metadata) {
    return nextRunFromMetadata(input.metadata, after) ?? undefined;
  }
  if (input.kind === "once") {
    return typeof input.runAt === "number" && input.runAt > after
      ? input.runAt
      : undefined;
  }
  const schedule = parseCron(input.cronExpr ?? "");
  return schedule
    ? (nextRunAfter(schedule, new Date(after))?.getTime() ?? undefined)
    : undefined;
}

export function scheduledSessionId(taskId: string): string {
  return `scheduled-${taskId}`;
}

export function listScheduledTasks(): ScheduledTaskRecord[] {
  const rows = getStateDb()
    .prepare("SELECT * FROM scheduled_tasks ORDER BY created_at ASC")
    .all() as ScheduledTaskRow[];
  return rows.map(rowToTask);
}

export function getScheduledTask(taskId: string): ScheduledTaskRecord | null {
  const row = getStateDb()
    .prepare("SELECT * FROM scheduled_tasks WHERE id = ?")
    .get(taskId) as ScheduledTaskRow | undefined;
  return row ? rowToTask(row) : null;
}

export function createScheduledTask(
  input: ScheduledTaskInput,
): ScheduledTaskRecord {
  const normalized = normalizeInput(input);
  const now = Date.now();
  const record: ScheduledTaskRecord = {
    id: randomUUID(),
    name: normalized.name,
    instruction: normalized.instruction,
    workspacePath: normalized.workspacePath,
    kind: normalized.kind,
    runAt: normalized.runAt,
    cronExpr: normalized.cronExpr,
    enabled: true,
    metadata: normalized.metadata,
    createdAt: now,
    updatedAt: now,
  };
  record.nextRunAt = computeNextRunAt(record, now);

  getStateDb()
    .prepare(
      `
      INSERT INTO scheduled_tasks (
        id, name, instruction, workspace_path, kind, run_at, cron_expr, enabled,
        next_run_at, last_run_at, last_run_status, fail_count, metadata_json,
        created_at, updated_at
      )
      VALUES (
        @id, @name, @instruction, @workspacePath, @kind, @runAt, @cronExpr, @enabled,
        @nextRunAt, @lastRunAt, @lastRunStatus, @failCount, @metadataJson,
        @createdAt, @updatedAt
      )
    `,
    )
    .run({
      ...record,
      enabled: 1,
      runAt: record.runAt ?? null,
      cronExpr: record.cronExpr ?? null,
      nextRunAt: record.nextRunAt ?? null,
      lastRunAt: null,
      lastRunStatus: null,
      failCount: 0,
      metadataJson: record.metadata ? JSON.stringify(record.metadata) : null,
    });
  return record;
}

export function updateScheduledTask(
  taskId: string,
  input: Partial<ScheduledTaskInput>,
): ScheduledTaskRecord {
  const existing = getScheduledTask(taskId);
  if (!existing) throw new Error("定时任务不存在");
  const merged = normalizeInput({
    name: input.name ?? existing.name,
    instruction: input.instruction ?? existing.instruction,
    workspacePath: input.workspacePath ?? existing.workspacePath,
    kind: input.kind ?? existing.kind,
    runAt: input.runAt ?? existing.runAt,
    cronExpr: input.cronExpr ?? existing.cronExpr,
    metadata: input.metadata ?? existing.metadata,
  });
  const now = Date.now();
  const next: ScheduledTaskRecord = {
    ...existing,
    ...merged,
    updatedAt: now,
  };
  next.nextRunAt = next.enabled ? computeNextRunAt(next, now) : undefined;

  getStateDb()
    .prepare(
      `
      UPDATE scheduled_tasks
      SET name = @name,
          instruction = @instruction,
          workspace_path = @workspacePath,
          kind = @kind,
          run_at = @runAt,
          cron_expr = @cronExpr,
          next_run_at = @nextRunAt,
          metadata_json = @metadataJson,
          updated_at = @updatedAt
      WHERE id = @id
    `,
    )
    .run({
      id: taskId,
      name: next.name,
      instruction: next.instruction,
      workspacePath: next.workspacePath,
      kind: next.kind,
      runAt: next.runAt ?? null,
      cronExpr: next.cronExpr ?? null,
      nextRunAt: next.nextRunAt ?? null,
      metadataJson: next.metadata ? JSON.stringify(next.metadata) : null,
      updatedAt: now,
    });
  return next;
}

export function removeScheduledTask(
  taskId: string,
): ScheduledTaskRecord | null {
  const existing = getScheduledTask(taskId);
  if (!existing) return null;
  getStateDb().prepare("DELETE FROM scheduled_tasks WHERE id = ?").run(taskId);
  return existing;
}

export function toggleScheduledTask(taskId: string): ScheduledTaskRecord {
  const existing = getScheduledTask(taskId);
  if (!existing) throw new Error("定时任务不存在");
  const now = Date.now();
  const enabled = !existing.enabled;
  const nextRunAt = enabled ? computeNextRunAt(existing, now) : undefined;
  getStateDb()
    .prepare(
      `
      UPDATE scheduled_tasks
      SET enabled = @enabled,
          next_run_at = @nextRunAt,
          updated_at = @updatedAt
      WHERE id = @id
    `,
    )
    .run({
      id: taskId,
      enabled: enabled ? 1 : 0,
      nextRunAt: nextRunAt ?? null,
      updatedAt: now,
    });
  return { ...existing, enabled, nextRunAt, updatedAt: now };
}

export function listDueScheduledTasks(now = Date.now()): ScheduledTaskRecord[] {
  const rows = getStateDb()
    .prepare(
      `
      SELECT * FROM scheduled_tasks
      WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?
      ORDER BY next_run_at ASC
    `,
    )
    .all(now) as ScheduledTaskRow[];
  return rows.map(rowToTask);
}

export function listScheduledTaskRuns(
  taskId: string,
  limit = 50,
): ScheduledTaskRunRecord[] {
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), 200));
  const rows = getStateDb()
    .prepare(
      `
      SELECT * FROM scheduled_task_runs
      WHERE task_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `,
    )
    .all(taskId, safeLimit) as ScheduledTaskRunRow[];
  return rows.map(rowToRun);
}

export function startScheduledTaskRun(
  taskId: string,
  sessionId: string,
): ScheduledTaskRunRecord {
  const now = Date.now();
  const run: ScheduledTaskRunRecord = {
    id: randomUUID(),
    taskId,
    sessionId,
    status: "running",
    startedAt: now,
    createdAt: now,
  };
  getStateDb()
    .prepare(
      `
      INSERT INTO scheduled_task_runs (
        id, task_id, session_id, status, started_at, finished_at, error,
        receipt_json, created_at
      )
      VALUES (
        @id, @taskId, @sessionId, @status, @startedAt, @finishedAt, @error,
        @receiptJson, @createdAt
      )
    `,
    )
    .run({
      ...run,
      finishedAt: null,
      error: null,
      receiptJson: null,
    });
  return run;
}

export function finishScheduledTaskRun(
  runId: string,
  status: ScheduledTaskRunStatus,
  options: { error?: string; receipt?: ChatSendReceipt } = {},
): ScheduledTaskRunRecord {
  const finishedAt = Date.now();
  getStateDb()
    .prepare(
      `
      UPDATE scheduled_task_runs
      SET status = @status,
          finished_at = @finishedAt,
          error = @error,
          receipt_json = @receiptJson
      WHERE id = @id
    `,
    )
    .run({
      id: runId,
      status,
      finishedAt,
      error: options.error ?? null,
      receiptJson: options.receipt ? JSON.stringify(options.receipt) : null,
    });
  const row = getStateDb()
    .prepare("SELECT * FROM scheduled_task_runs WHERE id = ?")
    .get(runId) as ScheduledTaskRunRow | undefined;
  if (!row) throw new Error("定时任务执行记录不存在");
  return rowToRun(row);
}

export function markScheduledTaskAfterRun(
  task: ScheduledTaskRecord,
  status: ScheduledTaskRunStatus,
  finishedAt = Date.now(),
): ScheduledTaskRecord {
  const failed = status === "failed" || status === "no_window";
  const failCount = failed ? (task.failCount ?? 0) + 1 : 0;
  const enabled = task.kind === "once" ? false : task.enabled && failCount < 5;
  const nextRunAt = enabled ? computeNextRunAt(task, finishedAt) : undefined;
  const updatedAt = finishedAt;
  getStateDb()
    .prepare(
      `
      UPDATE scheduled_tasks
      SET enabled = @enabled,
          next_run_at = @nextRunAt,
          last_run_at = @lastRunAt,
          last_run_status = @lastRunStatus,
          fail_count = @failCount,
          updated_at = @updatedAt
      WHERE id = @id
    `,
    )
    .run({
      id: task.id,
      enabled: enabled ? 1 : 0,
      nextRunAt: nextRunAt ?? null,
      lastRunAt: finishedAt,
      lastRunStatus: status,
      failCount,
      updatedAt,
    });
  return {
    ...task,
    enabled,
    nextRunAt,
    lastRunAt: finishedAt,
    lastRunStatus: status,
    failCount,
    updatedAt,
  };
}
