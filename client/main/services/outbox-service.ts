import type Database from "better-sqlite3";
import type {
  OutboxMessageRecord,
  OutboxMessageState,
  OutboxSnapshot,
} from "@shared/types";
import type { WorkflowUserMessageContent } from "@shared/workflow-read-thread-contract";
import { getStateDb } from "../core/storage/state-db";

interface OutboxRow {
  session_id: string;
  message_id: string;
  turn_id: string | null;
  display_content: string;
  user_content_json: string;
  sdk_content: string;
  state: OutboxMessageState;
  position: number;
  attempt_count: number;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

export interface EnqueueOutboxInput {
  sessionId: string;
  messageId: string;
  turnId?: string;
  displayContent: string;
  userContent: WorkflowUserMessageContent[];
  sdkContent: string;
  createdAt?: number;
}

type OutboxListener = (sessionId: string) => void;
const listeners = new Set<OutboxListener>();

export function subscribeOutbox(listener: OutboxListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitOutboxChanged(sessionId: string): void {
  for (const listener of listeners) listener(sessionId);
}

export function enqueueOutboxMessage(
  input: EnqueueOutboxInput,
): { record: OutboxMessageRecord; created: boolean } {
  const database = getStateDb();
  const result = database.transaction(() => {
    const existing = getOutboxMessageWithDb(
      database,
      input.sessionId,
      input.messageId,
    );
    if (existing) return { record: existing, created: false };

    const now = input.createdAt ?? Date.now();
    const positionRow = database
      .prepare(
        `SELECT COALESCE(MAX(position), -1) + 1 AS position
         FROM outbox_messages
         WHERE session_id = ? AND state IN ('queued', 'applying')`,
      )
      .get(input.sessionId) as { position: number };
    database
      .prepare(
        `INSERT INTO outbox_messages (
          session_id, message_id, turn_id, kind, display_content,
          user_content_json, sdk_content, state, position, attempt_count,
          created_at, updated_at
        ) VALUES (?, ?, ?, 'steer', ?, ?, ?, 'queued', ?, 0, ?, ?)`,
      )
      .run(
        input.sessionId,
        input.messageId,
        input.turnId ?? null,
        input.displayContent,
        JSON.stringify(input.userContent),
        input.sdkContent,
        positionRow.position,
        now,
        now,
      );
    bumpRevision(database, input.sessionId);
    const record = getOutboxMessageWithDb(
      database,
      input.sessionId,
      input.messageId,
    );
    if (!record) throw new Error("Outbox insert was not readable after commit.");
    return { record, created: true };
  })();
  if (result.created) emitOutboxChanged(input.sessionId);
  return result;
}

export function getOutboxMessage(
  sessionId: string,
  messageId: string,
): OutboxMessageRecord | null {
  return getOutboxMessageWithDb(getStateDb(), sessionId, messageId);
}

export function listQueuedOutboxMessages(
  sessionId: string,
): OutboxMessageRecord[] {
  return (getStateDb()
    .prepare(
      `SELECT * FROM outbox_messages
       WHERE session_id = ? AND state = 'queued'
       ORDER BY position ASC, created_at ASC`,
    )
    .all(sessionId) as OutboxRow[]).map(rowToRecord);
}

export function listOutboxSnapshots(
  sessionId?: string,
): OutboxSnapshot[] {
  const database = getStateDb();
  const sessionRows = sessionId
    ? [{ session_id: sessionId }]
    : (database
        .prepare(
          `SELECT DISTINCT session_id FROM outbox_messages
           WHERE state IN ('queued', 'applying')
           ORDER BY session_id`,
        )
        .all() as Array<{ session_id: string }>);
  return sessionRows
    .map(({ session_id }) => {
      const items = (database
        .prepare(
          `SELECT * FROM outbox_messages
           WHERE session_id = ? AND state IN ('queued', 'applying')
           ORDER BY position ASC, created_at ASC`,
        )
        .all(session_id) as OutboxRow[]).map(rowToRecord);
      const revision = readRevision(database, session_id);
      return { sessionId: session_id, revision, paused: true, items };
    })
    .filter((snapshot) => snapshot.items.length > 0 || Boolean(sessionId));
}

export function updateOutboxState(
  sessionId: string,
  messageId: string,
  state: OutboxMessageState,
  options: { turnId?: string; lastError?: string | null } = {},
): OutboxMessageRecord | null {
  const database = getStateDb();
  const changed = database.transaction(() => {
    const result = database
      .prepare(
        `UPDATE outbox_messages
         SET state = ?, turn_id = COALESCE(?, turn_id), last_error = ?, updated_at = ?
         WHERE session_id = ? AND message_id = ?`,
      )
      .run(
        state,
        options.turnId ?? null,
        options.lastError ?? null,
        Date.now(),
        sessionId,
        messageId,
      );
    if (result.changes === 0) return false;
    bumpRevision(database, sessionId);
    return true;
  })();
  if (!changed) return null;
  emitOutboxChanged(sessionId);
  return getOutboxMessageWithDb(database, sessionId, messageId);
}

export function attachQueuedOutboxToTurn(
  sessionId: string,
  turnId: string,
  messageIds: string[],
): void {
  if (messageIds.length === 0) return;
  const database = getStateDb();
  const changed = database.transaction(() => {
    const statement = database.prepare(
      `UPDATE outbox_messages SET turn_id = ?, updated_at = ?
       WHERE session_id = ? AND message_id = ? AND state = 'queued'`,
    );
    let count = 0;
    const now = Date.now();
    for (const messageId of messageIds) {
      count += statement.run(turnId, now, sessionId, messageId).changes;
    }
    if (count > 0) bumpRevision(database, sessionId);
    return count;
  })();
  if (changed > 0) emitOutboxChanged(sessionId);
}

export function claimNextOutboxMessage(
  sessionId: string,
  messageId?: string,
): OutboxMessageRecord | null {
  const database = getStateDb();
  const claimed = database.transaction(() => {
    const row = messageId
      ? (database
          .prepare(
            `SELECT * FROM outbox_messages
             WHERE session_id = ? AND message_id = ? AND state = 'queued'
             LIMIT 1`,
          )
          .get(sessionId, messageId) as OutboxRow | undefined)
      : (database
          .prepare(
            `SELECT * FROM outbox_messages
             WHERE session_id = ? AND state = 'queued'
             ORDER BY position ASC, created_at ASC LIMIT 1`,
          )
          .get(sessionId) as OutboxRow | undefined);
    if (!row) return null;
    database
      .prepare(
        `UPDATE outbox_messages
         SET state = 'applying', attempt_count = attempt_count + 1,
             last_error = NULL, updated_at = ?
         WHERE session_id = ? AND message_id = ? AND state = 'queued'`,
      )
      .run(Date.now(), sessionId, row.message_id);
    bumpRevision(database, sessionId);
    return getOutboxMessageWithDb(database, sessionId, row.message_id);
  })();
  if (claimed) emitOutboxChanged(sessionId);
  return claimed;
}

export function cancelSessionOutbox(sessionId: string): number {
  const database = getStateDb();
  const changed = database.transaction(() => {
    const result = database
      .prepare(
        `UPDATE outbox_messages
         SET state = 'canceled', last_error = 'Session deleted', updated_at = ?
         WHERE session_id = ? AND state IN ('queued', 'applying')`,
      )
      .run(Date.now(), sessionId);
    if (result.changes > 0) bumpRevision(database, sessionId);
    return result.changes;
  })();
  if (changed > 0) emitOutboxChanged(sessionId);
  return changed;
}

export function reorderOutboxMessages(
  sessionId: string,
  orderedMessageIds: string[],
): string[] {
  const database = getStateDb();
  const order = database.transaction(() => {
    const current = (database
      .prepare(
        `SELECT message_id FROM outbox_messages
         WHERE session_id = ? AND state = 'queued'
         ORDER BY position ASC, created_at ASC`,
      )
      .all(sessionId) as Array<{ message_id: string }>).map(
      (row) => row.message_id,
    );
    const remaining = new Set(current);
    const next: string[] = [];
    for (const messageId of orderedMessageIds) {
      if (!remaining.delete(messageId)) continue;
      next.push(messageId);
    }
    for (const messageId of current) {
      if (remaining.delete(messageId)) next.push(messageId);
    }
    const update = database.prepare(
      `UPDATE outbox_messages SET position = ?, updated_at = ?
       WHERE session_id = ? AND message_id = ? AND state = 'queued'`,
    );
    const now = Date.now();
    next.forEach((messageId, position) =>
      update.run(position, now, sessionId, messageId),
    );
    if (next.length > 0) bumpRevision(database, sessionId);
    return next;
  })();
  if (order.length > 0) emitOutboxChanged(sessionId);
  return order;
}

export function recoverApplyingOutbox(): string[] {
  const database = getStateDb();
  const sessionIds = (database
    .prepare(
      `SELECT DISTINCT session_id FROM outbox_messages WHERE state = 'applying'`,
    )
    .all() as Array<{ session_id: string }>).map((row) => row.session_id);
  if (sessionIds.length === 0) return [];
  database.transaction(() => {
    const now = Date.now();
    database
      .prepare(
        `UPDATE outbox_messages
         SET state = 'queued', last_error = 'Recovered after process restart', updated_at = ?
         WHERE state = 'applying'`,
      )
      .run(now);
    for (const sessionId of sessionIds) bumpRevision(database, sessionId);
  })();
  sessionIds.forEach(emitOutboxChanged);
  return sessionIds;
}

function getOutboxMessageWithDb(
  database: Database.Database,
  sessionId: string,
  messageId: string,
): OutboxMessageRecord | null {
  const row = database
    .prepare(
      `SELECT * FROM outbox_messages WHERE session_id = ? AND message_id = ?`,
    )
    .get(sessionId, messageId) as OutboxRow | undefined;
  return row ? rowToRecord(row) : null;
}

function bumpRevision(database: Database.Database, sessionId: string): void {
  database
    .prepare(
      `INSERT INTO outbox_revisions (session_id, revision) VALUES (?, 1)
       ON CONFLICT(session_id) DO UPDATE SET revision = revision + 1`,
    )
    .run(sessionId);
}

function readRevision(database: Database.Database, sessionId: string): number {
  const row = database
    .prepare(`SELECT revision FROM outbox_revisions WHERE session_id = ?`)
    .get(sessionId) as { revision: number } | undefined;
  return row?.revision ?? 0;
}

function rowToRecord(row: OutboxRow): OutboxMessageRecord {
  let userContent: WorkflowUserMessageContent[];
  try {
    const parsed = JSON.parse(row.user_content_json) as unknown;
    userContent = Array.isArray(parsed)
      ? (parsed as WorkflowUserMessageContent[])
      : [{ type: "text", text: row.display_content }];
  } catch {
    userContent = [{ type: "text", text: row.display_content }];
  }
  return {
    sessionId: row.session_id,
    messageId: row.message_id,
    turnId: row.turn_id ?? undefined,
    displayContent: row.display_content,
    userContent,
    sdkContent: row.sdk_content,
    state: row.state,
    position: row.position,
    attemptCount: row.attempt_count,
    lastError: row.last_error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
