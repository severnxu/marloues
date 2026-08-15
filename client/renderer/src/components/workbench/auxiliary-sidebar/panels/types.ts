export interface FileChange {
  path: string;
  operation: "read" | "write" | "edit" | "search" | "other";
  operationLabel: string;
  insertions: number;
  deletions: number;
  rawDiff?: string;
}
