import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ChatRewindResult } from "@shared/types";
import { logWarn } from "../core/logging/app-logger";
import { getStateDb } from "../core/storage/state-db";
import { recordSessionArtifact, recordWorkspaceCheckpoint, recordWorkspaceFileChange } from "./session-store";

const execFileAsync = promisify(execFile);

interface WorkspaceCheckpointRow {
  id: string;
  workspace_path: string | null;
  baseline_ref: string | null;
}

interface WorkspaceFileChangeRow {
  path: string;
  change_type: string;
  diff_artifact_id: string | null;
}

interface SessionArtifactRow {
  content_text: string | null;
}

export async function captureWorkspaceCheckpoint(params: {
  sessionId: string;
  turnId?: string;
  messageId?: string;
  workspacePath?: string;
  phase: "turn_start" | "turn_end" | "preflight" | "rewind";
}): Promise<string | null> {
  if (!params.workspacePath) return null;
  try {
    const snapshot = await readGitSnapshot(params.workspacePath);
    const checkpointId = recordWorkspaceCheckpoint({
      sessionId: params.sessionId,
      turnId: params.turnId,
      messageId: params.messageId,
      workspacePath: params.workspacePath,
      phase: params.phase,
      status: "ready",
      baselineRef: snapshot.head,
      manifest: {
        strategy: snapshot.isGit ? "git-status" : "no-git",
        gitRoot: snapshot.gitRoot,
        head: snapshot.head,
        changedFiles: snapshot.files,
      },
      createdAt: Date.now(),
      completedAt: Date.now(),
    });

    for (const file of snapshot.files) {
      recordWorkspaceFileChange({
        checkpointId,
        path: file.path,
        changeType: file.status,
        createdAt: Date.now(),
      });
    }

    if (snapshot.diff.trim()) {
      const artifactId = recordSessionArtifact({
        sessionId: params.sessionId,
        turnId: params.turnId,
        messageId: params.messageId,
        kind: "workspace_diff",
        title: `${params.phase} diff`,
        summary: snapshot.diff.slice(0, 500),
        contentText: snapshot.diff,
        createdAt: Date.now(),
      });
      for (const file of snapshot.files) {
        recordWorkspaceFileChange({
          checkpointId,
          path: file.path,
          changeType: `${file.status}:diff`,
          diffArtifactId: artifactId,
          createdAt: Date.now(),
        });
      }
    }
    return checkpointId;
  } catch (error) {
    logWarn("workspace.checkpoint.failed", {
      sessionId: params.sessionId,
      turnId: params.turnId,
      phase: params.phase,
      error: error instanceof Error ? error.message : String(error),
    });
    try {
      return recordWorkspaceCheckpoint({
        sessionId: params.sessionId,
        turnId: params.turnId,
        messageId: params.messageId,
        workspacePath: params.workspacePath,
        phase: params.phase,
        status: "error",
        manifest: { error: error instanceof Error ? error.message : String(error) },
        createdAt: Date.now(),
        completedAt: Date.now(),
      });
    } catch (recordError) {
      logWarn("workspace.checkpoint.errorRecordFailed", {
        sessionId: params.sessionId,
        turnId: params.turnId,
        phase: params.phase,
        error: recordError instanceof Error ? recordError.message : String(recordError),
      });
      return null;
    }
  }
}

export function previewWorkspaceRewind(params: {
  sessionId: string;
  targetMessageId: string;
}): ChatRewindResult {
  const checkpoint = findTurnStartCheckpoint(params.sessionId, params.targetMessageId);
  if (!checkpoint?.workspace_path) {
    return {
      canRewind: false,
      error: "没有找到这轮开始前的工作区检查点，暂时无法预览回滚。",
      filesChanged: [],
    };
  }
  const filesChanged = findCheckpointFiles(checkpoint.id).map((file) => file.path);
  return {
    canRewind: true,
    filesChanged: unique(filesChanged),
    raw: {
      strategy: "marloues-git-diff-preview",
      checkpointId: checkpoint.id,
      baselineRef: checkpoint.baseline_ref,
      note: "Preview only. Applying file rewinds is intentionally disabled until deletion-sensitive operations are handled one file at a time.",
    },
  };
}

export async function applyWorkspaceRewind(params: {
  sessionId: string;
  targetMessageId: string;
  confirmedFiles: string[];
}): Promise<ChatRewindResult> {
  const preview = previewWorkspaceRewind(params);
  if (!preview.canRewind) return preview;

  const checkpoint = findTurnStartCheckpoint(params.sessionId, params.targetMessageId);
  if (!checkpoint?.workspace_path) return preview;

  const confirmedFiles = unique(params.confirmedFiles);
  if (!confirmedFiles.length) {
    return {
      ...preview,
      canRewind: false,
      error: "No files were confirmed for rewind.",
    };
  }

  const allowedFiles = new Set(preview.filesChanged ?? []);
  const outsideCheckpoint = confirmedFiles.filter((file) => !allowedFiles.has(file));
  if (outsideCheckpoint.length) {
    return {
      ...preview,
      canRewind: false,
      error: `Confirmed files are not part of the checkpoint: ${outsideCheckpoint.join(", ")}`,
    };
  }

  const currentSnapshot = await readGitSnapshot(checkpoint.workspace_path);
  if (!currentSnapshot.isGit) {
    return {
      ...preview,
      canRewind: false,
      error: "Current workspace is not a Git repository.",
    };
  }

  const currentUntracked = currentSnapshot.files.filter((file) => file.status === "??").map((file) => file.path);
  if (currentUntracked.length) {
    return {
      ...preview,
      canRewind: false,
      error: `Untracked files exist; handle them manually before rewind: ${currentUntracked.slice(0, 20).join(", ")}`,
      filesChanged: currentSnapshot.files.map((file) => file.path),
    };
  }

  const targetDiff = readCheckpointDiff(checkpoint.id);
  const appliedFiles: string[] = [];
  for (const filePath of confirmedFiles) {
    const currentPatch = await runGit(checkpoint.workspace_path, ["diff", "--", filePath]).catch(() => "");
    const targetPatch = extractFilePatch(targetDiff, filePath);

    const unsafePatch = [currentPatch, targetPatch].find((patch) => patch && patchHasUnsafeFileOperation(patch));
    if (unsafePatch) {
      return {
        ...preview,
        canRewind: false,
        error: `Rewind for ${filePath} would create, delete, or rename a file. Handle that file manually first.`,
        filesChanged: confirmedFiles,
      };
    }

    try {
      if (currentPatch.trim()) {
        await gitApply(checkpoint.workspace_path, ["apply", "--check", "--reverse", "--whitespace=nowarn", "-"], currentPatch);
      }
      if (targetPatch.trim()) {
        await gitApply(checkpoint.workspace_path, ["apply", "--check", "--whitespace=nowarn", "-"], targetPatch);
      }
    } catch (error) {
      return {
        ...preview,
        canRewind: false,
        error: `Rewind check failed for ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
        filesChanged: confirmedFiles,
      };
    }
  }

  for (const filePath of confirmedFiles) {
    const currentPatch = await runGit(checkpoint.workspace_path, ["diff", "--", filePath]).catch(() => "");
    const targetPatch = extractFilePatch(targetDiff, filePath);
    if (currentPatch.trim()) {
      await gitApply(checkpoint.workspace_path, ["apply", "--reverse", "--whitespace=nowarn", "-"], currentPatch);
    }
    if (targetPatch.trim()) {
      await gitApply(checkpoint.workspace_path, ["apply", "--whitespace=nowarn", "-"], targetPatch);
    }
    appliedFiles.push(filePath);
  }

  await captureWorkspaceCheckpoint({
    sessionId: params.sessionId,
    messageId: params.targetMessageId,
    workspacePath: checkpoint.workspace_path,
    phase: "rewind",
  });

  return {
    canRewind: true,
    filesChanged: appliedFiles,
    raw: {
      strategy: "marloues-git-diff-per-file",
      checkpointId: checkpoint.id,
      baselineRef: checkpoint.baseline_ref,
      appliedFiles,
    },
  };
}

async function readGitSnapshot(workspacePath: string): Promise<{
  isGit: boolean;
  gitRoot?: string;
  head?: string;
  files: Array<{ path: string; status: string }>;
  diff: string;
}> {
  const gitRoot = await runGit(workspacePath, ["rev-parse", "--show-toplevel"])
    .then((value) => value.trim())
    .catch(() => "");
  if (!gitRoot) {
    return { isGit: false, files: [], diff: "" };
  }
  const head = await runGit(workspacePath, ["rev-parse", "HEAD"])
    .then((value) => value.trim())
    .catch(() => undefined);
  const status = await runGit(workspacePath, ["status", "--porcelain=v1", "-z"]).catch(() => "");
  const diff = await runGit(workspacePath, ["diff", "--", "."]).catch(() => "");
  return {
    isGit: true,
    gitRoot,
    head,
    files: parsePorcelainStatus(status),
    diff,
  };
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout;
}

async function gitApply(cwd: string, args: string[], input: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = execFile(
      "git",
      ["-C", cwd, ...args],
      {
        encoding: "utf8",
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, _stdout, stderr) => {
        if (error) {
          reject(new Error((stderr || error.message).trim()));
          return;
        }
        resolve();
      },
    );
    child.stdin?.end(input, "utf8");
  });
}

function findTurnStartCheckpoint(sessionId: string, targetMessageId: string): WorkspaceCheckpointRow | null {
  return (
    (getStateDb()
      .prepare(
        `
        SELECT id, workspace_path, baseline_ref
        FROM workspace_checkpoints
        WHERE session_id = ? AND message_id = ? AND phase = 'turn_start' AND status = 'ready'
        ORDER BY created_at DESC
        LIMIT 1
      `,
      )
      .get(sessionId, targetMessageId) as WorkspaceCheckpointRow | undefined) ?? null
  );
}

function findCheckpointFiles(checkpointId: string): WorkspaceFileChangeRow[] {
  return getStateDb()
    .prepare(
      `
      SELECT path, change_type, diff_artifact_id
      FROM workspace_file_changes
      WHERE checkpoint_id = ?
    `,
    )
    .all(checkpointId) as WorkspaceFileChangeRow[];
}

function readCheckpointDiff(checkpointId: string): string {
  const diffArtifactId = findCheckpointFiles(checkpointId).find((file) => file.diff_artifact_id)?.diff_artifact_id;
  if (!diffArtifactId) return "";
  const row = getStateDb().prepare("SELECT content_text FROM session_artifacts WHERE id = ?").get(diffArtifactId) as
    | SessionArtifactRow
    | undefined;
  return row?.content_text ?? "";
}

function extractFilePatch(diff: string, filePath: string): string {
  if (!diff.trim()) return "";
  const lines = diff.split("\n");
  const chunks: string[] = [];
  let active = false;
  let current: string[] = [];

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      if (active && current.length) chunks.push(current.join("\n"));
      current = [line];
      active = diffHeaderMatchesPath(line, filePath);
      continue;
    }
    if (current.length) current.push(line);
  }
  if (active && current.length) chunks.push(current.join("\n"));
  return chunks.length ? `${chunks.join("\n")}\n` : "";
}

function diffHeaderMatchesPath(header: string, filePath: string): boolean {
  const normalized = normalizeDiffPath(filePath);
  return header.includes(` a/${normalized} `) || header.endsWith(` a/${normalized}`) || header.includes(` b/${normalized}`);
}

function normalizeDiffPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\/+/, "");
}

function patchHasUnsafeFileOperation(patch: string): boolean {
  return /^(new file mode|deleted file mode|rename from|rename to|copy from|copy to)\b/m.test(patch);
}

function parsePorcelainStatus(value: string): Array<{ path: string; status: string }> {
  if (!value) return [];
  const parts = value.split("\0").filter(Boolean);
  const files: Array<{ path: string; status: string }> = [];
  for (let index = 0; index < parts.length; index += 1) {
    const entry = parts[index];
    const status = entry.slice(0, 2).trim() || "modified";
    const path = entry.slice(3);
    if (!path) continue;
    files.push({ path, status });
    if (status.startsWith("R") || status.startsWith("C")) index += 1;
  }
  return files;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
