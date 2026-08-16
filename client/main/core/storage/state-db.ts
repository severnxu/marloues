import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getDevStateDbPathForImport, getStateDbPath } from "../../app-paths";
import { logInfo } from "../logging/app-logger";

let db: Database.Database | null = null;

export function getStateDb(): Database.Database {
  if (db) return db;
  const dbPath = getStateDbPath();
  mkdirSync(dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  importDevStateIfAvailable(db);
  return db;
}

export function closeStateDbForTests(): void {
  if (!db) return;
  db.close();
  db = null;
}


function importDevStateIfAvailable(database: Database.Database): void {
  const sourcePath = getDevStateDbPathForImport();
  if (!sourcePath || !existsSync(sourcePath) || sourcePath === getStateDbPath()) return;

  try {
    database.prepare("ATTACH DATABASE ? AS dev_state").run(sourcePath);
    importTableRows(database, "sessions", "dev_state.sessions");
    const importedArtifacts = importTableRows(database, "session_artifacts", "dev_state.session_artifacts");
    const importedAuditEvents = importTableRows(database, "audit_events", "dev_state.audit_events");
    importTableRows(database, "session_checkpoints", "dev_state.session_checkpoints");
    importTableRows(database, "checkpoint_artifact_refs", "dev_state.checkpoint_artifact_refs");
    importTableRows(database, "workspace_checkpoints", "dev_state.workspace_checkpoints");
    importTableRows(database, "workspace_file_changes", "dev_state.workspace_file_changes");
    importTableRows(database, "workspace_rewind_events", "dev_state.workspace_rewind_events");

    if (importedArtifacts > 0 || importedAuditEvents > 0) {
      logInfo("stateDb.devStateImported", {
        sourcePath,
        importedArtifacts,
        importedAuditEvents,
      });
    }
  } catch (error) {
    logInfo("stateDb.devStateImportSkipped", {
      sourcePath,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    try {
      database.prepare("DETACH DATABASE dev_state").run();
    } catch {
      // The database may not have been attached if the import failed early.
    }
  }
}

function importTableRows(database: Database.Database, targetTable: string, sourceTable: string): number {
  const targetColumns = listTableColumns(database, targetTable);
  const sourceColumns = listTableColumns(database, sourceTable);
  const columns = targetColumns.filter((column) => sourceColumns.includes(column));
  if (!columns.length) return 0;

  const columnList = columns.map(quoteIdentifier).join(", ");
  const before = readTableCount(database, targetTable);
  database
    .prepare(
      `INSERT OR IGNORE INTO ${quoteIdentifier(targetTable)} (${columnList}) SELECT ${columnList} FROM ${sourceTable}`,
    )
    .run();
  return Math.max(0, readTableCount(database, targetTable) - before);
}

function readTableCount(database: Database.Database, tableName: string): number {
  try {
    const row = database.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(tableName)}`).get() as { count: number };
    return row.count;
  } catch {
    return 0;
  }
}

function listTableColumns(database: Database.Database, tableName: string): string[] {
  try {
    const [schemaName, rawTableName] = tableName.includes(".") ? tableName.split(".", 2) : [undefined, tableName];
    const pragma = schemaName
      ? `PRAGMA ${quoteIdentifier(schemaName)}.table_info(${quoteIdentifier(rawTableName)})`
      : `PRAGMA table_info(${quoteIdentifier(rawTableName)})`;
    const rows = database.prepare(pragma).all() as Array<{ name: string }>;
    return rows.map((row) => row.name);
  } catch {
    return [];
  }
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}
function migrate(database: Database.Database): void {
  const version = database.pragma("user_version", { simple: true }) as number;
  if (version < 1) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        workspace_path TEXT,
        session_id TEXT,
        turn_id TEXT,
        endpoint_profile_id TEXT,
        endpoint_profile_name TEXT,
        tool_source TEXT,
        tool_name TEXT NOT NULL,
        input_summary TEXT,
        output_summary TEXT,
        status TEXT NOT NULL,
        is_error INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_events_session ON audit_events(session_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_events_tool ON audit_events(tool_name, created_at DESC);
      PRAGMA user_version = 1;
    `);
    logInfo("stateDb.migrated", { version: 1, dbPath: getStateDbPath() });
  }

  const afterAuditVersion = database.pragma("user_version", { simple: true }) as number;
  if (afterAuditVersion < 2) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS session_artifacts (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        turn_id TEXT,
        message_id TEXT,
        kind TEXT NOT NULL,
        title TEXT,
        summary TEXT,
        content_text TEXT,
        content_json TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workspace_checkpoints (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        turn_id TEXT,
        message_id TEXT,
        workspace_path TEXT,
        phase TEXT NOT NULL,
        status TEXT NOT NULL,
        baseline_ref TEXT,
        manifest_json TEXT,
        created_at INTEGER NOT NULL,
        completed_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS workspace_file_changes (
        id TEXT PRIMARY KEY,
        checkpoint_id TEXT NOT NULL REFERENCES workspace_checkpoints(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        change_type TEXT NOT NULL,
        before_hash TEXT,
        after_hash TEXT,
        before_artifact_id TEXT,
        after_artifact_id TEXT,
        diff_artifact_id TEXT,
        conflict INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_session_artifacts_session ON session_artifacts(session_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_workspace_checkpoints_session ON workspace_checkpoints(session_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_workspace_file_changes_checkpoint ON workspace_file_changes(checkpoint_id);
      PRAGMA user_version = 2;
    `);
    logInfo("stateDb.migrated", { version: 2, dbPath: getStateDbPath() });
  }

  const afterArtifactVersion = database.pragma("user_version", { simple: true }) as number;
  if (afterArtifactVersion < 3) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS session_checkpoints (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        turn_id TEXT,
        message_id TEXT,
        kind TEXT NOT NULL,
        reason TEXT NOT NULL,
        model TEXT,
        context_window_tokens INTEGER,
        before_tokens INTEGER,
        after_tokens INTEGER,
        target_tokens INTEGER,
        summary_text TEXT NOT NULL,
        state_pack_json TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS checkpoint_artifact_refs (
        checkpoint_id TEXT NOT NULL REFERENCES session_checkpoints(id) ON DELETE CASCADE,
        artifact_id TEXT NOT NULL REFERENCES session_artifacts(id) ON DELETE CASCADE,
        role TEXT,
        PRIMARY KEY (checkpoint_id, artifact_id)
      );

      CREATE INDEX IF NOT EXISTS idx_session_checkpoints_session ON session_checkpoints(session_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_checkpoint_artifact_refs_artifact ON checkpoint_artifact_refs(artifact_id);
      PRAGMA user_version = 3;
    `);
    logInfo("stateDb.migrated", { version: 3, dbPath: getStateDbPath() });
  }

  const afterCheckpointVersion = database.pragma("user_version", { simple: true }) as number;
  if (afterCheckpointVersion < 4) {
    if (!tableHasColumn(database, "session_artifacts", "byte_length")) {
      database.exec("ALTER TABLE session_artifacts ADD COLUMN byte_length INTEGER NOT NULL DEFAULT 0;");
    }
    database.pragma("user_version = 4");
    logInfo("stateDb.migrated", { version: 4, dbPath: getStateDbPath() });
  }
  const afterArtifactByteLengthVersion = database.pragma("user_version", { simple: true }) as number;
  if (afterArtifactByteLengthVersion < 5) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS workspace_rewind_events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        target_message_id TEXT NOT NULL,
        dry_run INTEGER NOT NULL,
        status TEXT NOT NULL,
        files_json TEXT,
        result_json TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_rewind_events_session_created ON workspace_rewind_events(session_id, created_at DESC);
      PRAGMA user_version = 5;
    `);
    logInfo("stateDb.migrated", { version: 5, dbPath: getStateDbPath() });
  }

  const afterWorkspaceRewindVersion = database.pragma("user_version", { simple: true }) as number;
  if (afterWorkspaceRewindVersion < 6) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        workspace_path TEXT,
        workspace_name TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0,
        sdk_session_id TEXT,
        archived INTEGER NOT NULL DEFAULT 0,
        parent_session_id TEXT,
        forked_from_message_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspace_path, updated_at DESC);
      PRAGMA user_version = 6;
    `);
    logInfo("stateDb.migrated", { version: 6, dbPath: getStateDbPath() });
  }

  const afterSessionsVersion = database.pragma("user_version", { simple: true }) as number;
  if (afterSessionsVersion < 7) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS outbox_messages (
        session_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        turn_id TEXT,
        kind TEXT NOT NULL DEFAULT 'steer',
        display_content TEXT NOT NULL,
        user_content_json TEXT NOT NULL,
        sdk_content TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'queued',
        position INTEGER NOT NULL DEFAULT 0,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (session_id, message_id)
      );

      CREATE INDEX IF NOT EXISTS idx_outbox_session_state_position
        ON outbox_messages(session_id, state, position);
      CREATE INDEX IF NOT EXISTS idx_outbox_updated
        ON outbox_messages(updated_at DESC);

      CREATE TABLE IF NOT EXISTS outbox_revisions (
        session_id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL DEFAULT 0
      );
      PRAGMA user_version = 7;
    `);
    logInfo("stateDb.migrated", { version: 7, dbPath: getStateDbPath() });
  }
}

function tableHasColumn(database: Database.Database, tableName: string, columnName: string): boolean {
  const rows = database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === columnName);
}
