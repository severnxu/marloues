import type { WorkflowTurnItem } from "../../../../../../shared/adapters/workflow-messages-to-read-thread";

export type ToolCallRowItem = Extract<
  WorkflowTurnItem,
  {
    type:
      | "plan"
      | "mcpToolCall"
      | "dynamicToolCall"
      | "webSearch"
      | "imageGeneration";
  }
>;

export type PlanStep = { step: string; status: string };
export type ToolSearchDetailData = {
  query: string;
  limit?: number;
  tools: string[];
};
export type WebSearchDetailData = {
  type: string;
  query: string;
  url: string;
  queries: string[];
};
export type ImageGenerationDetailData = {
  prompt: string;
  status: string;
  hasResult: boolean;
  resultBytes?: number;
};
export type UsageDetailData = {
  totalTokens?: number;
  lastTokens?: number;
  contextWindow?: number;
  primaryPercent?: number;
  secondaryPercent?: number;
  planType?: string;
};
