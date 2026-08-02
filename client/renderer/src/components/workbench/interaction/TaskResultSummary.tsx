import { openAuxiliaryPanel } from "../events";
import type { TaskResultSummaryData } from "./types";

export function TaskResultSummary({
  summary,
}: {
  summary: TaskResultSummaryData;
}) {
  return (
    <button
      type="button"
      className="task-result-summary"
      onClick={() => openAuxiliaryPanel("changes")}
      aria-label={`${summary.fileCount} 个文件已更改，新增 ${summary.additions} 行，删除 ${summary.deletions} 行`}
    >
      <span>{summary.fileCount} 个文件已更改</span>
      <strong className="is-addition">+{summary.additions}</strong>
      <strong className="is-deletion">−{summary.deletions}</strong>
    </button>
  );
}
