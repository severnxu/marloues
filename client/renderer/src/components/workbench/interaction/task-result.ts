import type { WorkflowReadThreadResponse } from "@shared/workflow-read-thread-contract";
import type { TaskResultSummaryData } from "./types";

export function taskResultSummaryFromThread(
  readThread: WorkflowReadThreadResponse | null,
): TaskResultSummaryData | null {
  if (!readThread) return null;
  const turn = readThread.turns.find(
    (candidate) =>
      candidate.status === "completed" &&
      candidate.items.some(
        (item) => item.type === "fileChange" && item.changes.length > 0,
      ),
  );
  if (!turn) return null;

  const filePaths = new Set<string>();
  let additions = 0;
  let deletions = 0;
  for (const item of turn.items) {
    if (item.type !== "fileChange") continue;
    for (const change of item.changes) {
      filePaths.add(change.path);
      const diffText = change.diff?.text ?? "";
      for (const line of diffText.split(/\r?\n/)) {
        if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
        if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
      }
    }
  }

  return filePaths.size > 0
    ? { fileCount: filePaths.size, additions, deletions }
    : null;
}
