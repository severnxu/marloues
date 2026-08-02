import type { UserMessageContent } from "@/types";

export interface TaskResultSummaryData {
  fileCount: number;
  additions: number;
  deletions: number;
}

export interface SteerItem {
  id: string;
  text: string;
  attachments: UserMessageContent[];
}
