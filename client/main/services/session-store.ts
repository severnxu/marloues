import { randomUUID } from "node:crypto";
import type { AuditEventRecord } from "@shared/types";
import { getStateDb } from "../core/storage/state-db";
import { redactSensitiveValue } from "../core/security/redaction";

interface AuditEventRow {
  id: string;
  created_at: number;
  workspace_path: string | null;
  session_id: string | null;
  turn_id: string | null;
  endpoint_profile_id: string | null;
  endpoint_profile_name: string | null;
  tool_source: string | null;
  tool_name: string;
  input_summary: string | null;
  output_summary: string | null;
  status: string;
  is_error: number;
}

export interface SessionArtifactInput {
  sessionId: string;
  turnId?: string;
  messageId?: string;
  kind: string;
  title?: string;
  summary?: string;
  contentText?: string;
  contentJson?: unknown;
  byteLength?: number;
  createdAt?: number;
}

export interface SessionCheckpointInput {
  sessionId: string;
  turnId?: string;
  messageId?: string;
  kind: string;
  reason: string;
  model?: string;
  contextWindowTokens?: number;
  beforeTokens?: number;
  afterTokens?: number;
  targetTokens?: number;
  summaryText: string;
  statePack?: unknown;
  artifactRefs?: Array<{ artifactId: string; role?: string }>;
  createdAt?: number;
}

export interface SessionCheckpointRecord {
  id: string;
  sessionId: string;
  turnId?: string;
  messageId?: string;
  kind: string;
  reason: string;
  model?: string;
  contextWindowTokens?: number;
  beforeTokens?: number;
  afterTokens?: number;
  targetTokens?: number;
  summaryText: string;
  statePack?: unknown;
  createdAt: number;
  artifactRefs: Array<{ artifactId: string; role?: string }>;
}

interface SessionCheckpointRow {
  id: string;
  session_id: string;
  turn_id: string | null;
  message_id: string | null;
  kind: string;
  reason: string;
  model: string | null;
  context_window_tokens: number | null;
  before_tokens: number | null;
  after_tokens: number | null;
  target_tokens: number | null;
  summary_text: string;
  state_pack_json: string | null;
  created_at: number;
}

interface CheckpointArtifactRefRow {
  artifact_id: string;
  role: string | null;
}

export interface WorkspaceCheckpointInput {
  sessionId: string;
  turnId?: string;
  messageId?: string;
  workspacePath?: string;
  phase: "turn_start" | "turn_end" | "preflight" | "rewind";
  status?: "pending" | "ready" | "error";
  baselineRef?: string;
  manifest?: unknown;
  createdAt?: number;
  completedAt?: number;
}

export interface WorkspaceFileChangeInput {
  checkpointId: string;
  path: string;
  changeType: string;
  beforeHash?: string;
  afterHash?: string;
  beforeArtifactId?: string;
  afterArtifactId?: string;
  diffArtifactId?: string;
  conflict?: boolean;
  createdAt?: number;
}

export interface SessionRecordInput {
  id: string;
  title: string;
  workspacePath?: string;
  workspaceName?: string;
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
  sdkSessionId?: string;
  archived?: boolean;
  parentSessionId?: string;
  forkedFromMessageId?: string;
}

export function recordAuditEvent(input: Omit<AuditEventRecord, "id" | "createdAt"> & { id?: string; createdAt?: number }): string {
  const event = redactSensitiveValue({
    id: input.id ?? randomUUID(),
    createdAt: input.createdAt ?? Date.now(),
    toolSource: "desktop-ipc",
    ...input,
  }) as AuditEventRecord;

  getStateDb()
    .prepare(
      `
      INSERT OR REPLACE INTO audit_events (
        id,
        created_at,
        workspace_path,
        session_id,
        turn_id,
        endpoint_profile_id,
        endpoint_profile_name,
        tool_source,
        tool_name,
        input_summary,
        output_summary,
        status,
        is_error
      )
      VALUES (
        @id,
        @createdAt,
        @workspacePath,
        @sessionId,
        @turnId,
        @endpointProfileId,
        @endpointProfileName,
        @toolSource,
        @toolName,
        @inputSummary,
        @outputSummary,
        @status,
        @isError
      )
    `,
    )
    .run({
      id: event.id,
      createdAt: event.createdAt,
      workspacePath: event.workspacePath ?? null,
      sessionId: event.sessionId ?? null,
      turnId: event.turnId ?? null,
      endpointProfileId: event.endpointProfileId ?? null,
      endpointProfileName: event.endpointProfileName ?? null,
      toolSource: event.toolSource ?? null,
      toolName: event.toolName,
      inputSummary: event.inputSummary ?? null,
      outputSummary: event.outputSummary ?? null,
      status: event.status,
      isError: event.isError ? 1 : 0,
    });
  return event.id;
}

export function listAuditEvents(limit = 100): AuditEventRecord[] {
  const safeLimit = Math.max(1, Math.min(limit, 1000));
  const rows = getStateDb()
    .prepare("SELECT * FROM audit_events ORDER BY created_at DESC LIMIT ?")
    .all(safeLimit) as AuditEventRow[];
  return rows.map(rowToAuditEvent);
}

export function upsertSessionRecord(input: SessionRecordInput): void {
  getStateDb()
    .prepare(
      `
      INSERT INTO sessions (
        id,
        title,
        workspace_path,
        workspace_name,
        created_at,
        updated_at,
        pinned,
        sdk_session_id,
        archived,
        parent_session_id,
        forked_from_message_id
      )
      VALUES (
        @id,
        @title,
        @workspacePath,
        @workspaceName,
        @createdAt,
        @updatedAt,
        @pinned,
        @sdkSessionId,
        @archived,
        @parentSessionId,
        @forkedFromMessageId
      )
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        workspace_path = excluded.workspace_path,
        workspace_name = COALESCE(excluded.workspace_name, sessions.workspace_name),
        updated_at = excluded.updated_at,
        pinned = excluded.pinned,
        sdk_session_id = COALESCE(excluded.sdk_session_id, sessions.sdk_session_id),
        archived = excluded.archived,
        parent_session_id = COALESCE(excluded.parent_session_id, sessions.parent_session_id),
        forked_from_message_id = COALESCE(excluded.forked_from_message_id, sessions.forked_from_message_id)
    `,
    )
    .run({
      id: input.id,
      title: input.title,
      workspacePath: input.workspacePath ?? null,
      workspaceName: input.workspaceName ?? null,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
      pinned: input.pinned ? 1 : 0,
      sdkSessionId: input.sdkSessionId ?? null,
      archived: input.archived ? 1 : 0,
      parentSessionId: input.parentSessionId ?? null,
      forkedFromMessageId: input.forkedFromMessageId ?? null,
    });
}

export function recordSessionArtifact(input: SessionArtifactInput): string {
  const id = randomUUID();
  const contentJson = input.contentJson === undefined ? null : JSON.stringify(input.contentJson);
  const byteLength = input.byteLength ?? calculateArtifactByteLength(input.contentText, contentJson);
  getStateDb()
    .prepare(
      `
      INSERT INTO session_artifacts (
        id,
        session_id,
        turn_id,
        message_id,
        kind,
        title,
        summary,
        content_text,
        content_json,
        byte_length,
        created_at
      )
      VALUES (
        @id,
        @sessionId,
        @turnId,
        @messageId,
        @kind,
        @title,
        @summary,
        @contentText,
        @contentJson,
        @byteLength,
        @createdAt
      )
    `,
    )
    .run({
      id,
      sessionId: input.sessionId,
      turnId: input.turnId ?? null,
      messageId: input.messageId ?? null,
      kind: input.kind,
      title: input.title ?? null,
      summary: input.summary ?? null,
      contentText: input.contentText ?? null,
      contentJson,
      byteLength,
      createdAt: input.createdAt ?? Date.now(),
    });
  return id;
}

export function recordSessionCheckpoint(input: SessionCheckpointInput): string {
  const db = getStateDb();
  const id = randomUUID();
  const createdAt = input.createdAt ?? Date.now();
  const write = db.transaction(() => {
    db.prepare(
      `
      INSERT INTO session_checkpoints (
        id,
        session_id,
        turn_id,
        message_id,
        kind,
        reason,
        model,
        context_window_tokens,
        before_tokens,
        after_tokens,
        target_tokens,
        summary_text,
        state_pack_json,
        created_at
      )
      VALUES (
        @id,
        @sessionId,
        @turnId,
        @messageId,
        @kind,
        @reason,
        @model,
        @contextWindowTokens,
        @beforeTokens,
        @afterTokens,
        @targetTokens,
        @summaryText,
        @statePackJson,
        @createdAt
      )
    `,
    ).run({
      id,
      sessionId: input.sessionId,
      turnId: input.turnId ?? null,
      messageId: input.messageId ?? null,
      kind: input.kind,
      reason: input.reason,
      model: input.model ?? null,
      contextWindowTokens: input.contextWindowTokens ?? null,
      beforeTokens: input.beforeTokens ?? null,
      afterTokens: input.afterTokens ?? null,
      targetTokens: input.targetTokens ?? null,
      summaryText: input.summaryText,
      statePackJson: input.statePack === undefined ? null : JSON.stringify(input.statePack),
      createdAt,
    });

    for (const ref of input.artifactRefs ?? []) {
      db.prepare(
        `
        INSERT OR IGNORE INTO checkpoint_artifact_refs (checkpoint_id, artifact_id, role)
        VALUES (?, ?, ?)
      `,
      ).run(id, ref.artifactId, ref.role ?? null);
    }
  });
  write();
  return id;
}

export function listSessionCheckpoints(sessionId: string, limit = 20): SessionCheckpointRecord[] {
  const safeLimit = Math.max(1, Math.min(Math.trunc(limit) || 20, 100));
  const rows = getStateDb()
    .prepare(
      `
      SELECT *
      FROM session_checkpoints
      WHERE session_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `,
    )
    .all(sessionId, safeLimit) as SessionCheckpointRow[];
  return rows.map((row) => rowToSessionCheckpoint(row, listCheckpointArtifactRefs(row.id)));
}

export function getSessionCheckpoint(checkpointId: string): SessionCheckpointRecord | null {
  const row = getStateDb()
    .prepare(
      `
      SELECT *
      FROM session_checkpoints
      WHERE id = ?
    `,
    )
    .get(checkpointId) as SessionCheckpointRow | undefined;
  return row ? rowToSessionCheckpoint(row, listCheckpointArtifactRefs(row.id)) : null;
}

export function recordWorkspaceCheckpoint(input: WorkspaceCheckpointInput): string {
  const id = randomUUID();
  const createdAt = input.createdAt ?? Date.now();
  getStateDb()
    .prepare(
      `
      INSERT INTO workspace_checkpoints (
        id,
        session_id,
        turn_id,
        message_id,
        workspace_path,
        phase,
        status,
        baseline_ref,
        manifest_json,
        created_at,
        completed_at
      )
      VALUES (
        @id,
        @sessionId,
        @turnId,
        @messageId,
        @workspacePath,
        @phase,
        @status,
        @baselineRef,
        @manifestJson,
        @createdAt,
        @completedAt
      )
    `,
    )
    .run({
      id,
      sessionId: input.sessionId,
      turnId: input.turnId ?? null,
      messageId: input.messageId ?? null,
      workspacePath: input.workspacePath ?? null,
      phase: input.phase,
      status: input.status ?? "pending",
      baselineRef: input.baselineRef ?? null,
      manifestJson: input.manifest === undefined ? null : JSON.stringify(input.manifest),
      createdAt,
      completedAt: input.completedAt ?? null,
    });
  return id;
}

export function recordWorkspaceFileChange(input: WorkspaceFileChangeInput): string {
  const id = randomUUID();
  getStateDb()
    .prepare(
      `
      INSERT INTO workspace_file_changes (
        id,
        checkpoint_id,
        path,
        change_type,
        before_hash,
        after_hash,
        before_artifact_id,
        after_artifact_id,
        diff_artifact_id,
        conflict,
        created_at
      )
      VALUES (
        @id,
        @checkpointId,
        @path,
        @changeType,
        @beforeHash,
        @afterHash,
        @beforeArtifactId,
        @afterArtifactId,
        @diffArtifactId,
        @conflict,
        @createdAt
      )
    `,
    )
    .run({
      id,
      checkpointId: input.checkpointId,
      path: input.path,
      changeType: input.changeType,
      beforeHash: input.beforeHash ?? null,
      afterHash: input.afterHash ?? null,
      beforeArtifactId: input.beforeArtifactId ?? null,
      afterArtifactId: input.afterArtifactId ?? null,
      diffArtifactId: input.diffArtifactId ?? null,
      conflict: input.conflict ? 1 : 0,
      createdAt: input.createdAt ?? Date.now(),
    });
  return id;
}


export function recordWorkspaceRewindEvent(input: {
  sessionId: string;
  targetMessageId: string;
  dryRun: boolean;
  status: string;
  files?: string[];
  result?: unknown;
  createdAt?: number;
}): string {
  const id = randomUUID();
  getStateDb()
    .prepare(
      `
      INSERT INTO workspace_rewind_events (
        id,
        session_id,
        target_message_id,
        dry_run,
        status,
        files_json,
        result_json,
        created_at
      )
      VALUES (
        @id,
        @sessionId,
        @targetMessageId,
        @dryRun,
        @status,
        @filesJson,
        @resultJson,
        @createdAt
      )
    `,
    )
    .run({
      id,
      sessionId: input.sessionId,
      targetMessageId: input.targetMessageId,
      dryRun: input.dryRun ? 1 : 0,
      status: input.status,
      filesJson: input.files ? JSON.stringify(input.files) : null,
      resultJson: input.result === undefined ? null : JSON.stringify(input.result),
      createdAt: input.createdAt ?? Date.now(),
    });
  return id;
}
function calculateArtifactByteLength(contentText: string | undefined, contentJson: string | null): number {
  if (contentText !== undefined) return Buffer.byteLength(contentText, "utf8");
  if (contentJson !== null) return Buffer.byteLength(contentJson, "utf8");
  return 0;
}
function listCheckpointArtifactRefs(checkpointId: string): Array<{ artifactId: string; role?: string }> {
  const rows = getStateDb()
    .prepare(
      `
      SELECT artifact_id, role
      FROM checkpoint_artifact_refs
      WHERE checkpoint_id = ?
      ORDER BY role ASC, artifact_id ASC
    `,
    )
    .all(checkpointId) as CheckpointArtifactRefRow[];
  return rows.map((row) => ({
    artifactId: row.artifact_id,
    role: row.role ?? undefined,
  }));
}

function rowToSessionCheckpoint(
  row: SessionCheckpointRow,
  artifactRefs: Array<{ artifactId: string; role?: string }>,
): SessionCheckpointRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    turnId: row.turn_id ?? undefined,
    messageId: row.message_id ?? undefined,
    kind: row.kind,
    reason: row.reason,
    model: row.model ?? undefined,
    contextWindowTokens: row.context_window_tokens ?? undefined,
    beforeTokens: row.before_tokens ?? undefined,
    afterTokens: row.after_tokens ?? undefined,
    targetTokens: row.target_tokens ?? undefined,
    summaryText: row.summary_text,
    statePack: deserializeJson(row.state_pack_json),
    createdAt: row.created_at,
    artifactRefs,
  };
}

function deserializeJson(payload: string | null): unknown | undefined {
  if (!payload) return undefined;
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return undefined;
  }
}

function rowToAuditEvent(row: AuditEventRow): AuditEventRecord {
  return {
    id: row.id,
    createdAt: row.created_at,
    workspacePath: row.workspace_path ?? undefined,
    sessionId: row.session_id ?? undefined,
    turnId: row.turn_id ?? undefined,
    endpointProfileId: row.endpoint_profile_id ?? undefined,
    endpointProfileName: row.endpoint_profile_name ?? undefined,
    toolSource: row.tool_source ?? undefined,
    toolName: row.tool_name,
    inputSummary: row.input_summary ?? undefined,
    outputSummary: row.output_summary ?? undefined,
    status: row.status,
    isError: Boolean(row.is_error),
  };
}
