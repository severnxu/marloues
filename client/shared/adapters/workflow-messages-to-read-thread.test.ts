import { describe, expect, it } from "vitest";
import { workflowItemToWorkflowTurnItem } from "./workflow-messages-to-read-thread";
import type {
  WorkflowHookPromptItem,
  WorkflowMcpToolCallItem,
  WorkflowReasoningItem,
  WorkflowWebSearchItem,
} from "./workflow-messages-to-read-thread";

/**
 * 行为锁定：workflowItemToWorkflowTurnItem 是有损投影（adapter 扩展字段 →
 * contract 基字段）。Phase 2 评估是否保留前，先锁定当前行为作为基线。
 */

describe("workflowItemToWorkflowTurnItem 有损投影（行为锁定）", () => {
  it("webSearch：strip status/output 扩展字段，保留 query/action", () => {
    const input: WorkflowWebSearchItem = {
      type: "webSearch",
      id: "ws-1",
      query: "hello",
      action: { kind: "search" },
      status: "completed",
      output: { text: "结果", truncated: false },
    };
    expect(workflowItemToWorkflowTurnItem(input)).toEqual({
      type: "webSearch",
      id: "ws-1",
      query: "hello",
      action: { kind: "search" },
    });
  });

  it("hookPrompt：strip fragments 扩展字段，保留 fragmentCount", () => {
    const input: WorkflowHookPromptItem = {
      type: "hookPrompt",
      id: "hp-1",
      fragmentCount: 3,
      fragments: ["a", "b", "c"],
    };
    expect(workflowItemToWorkflowTurnItem(input)).toEqual({
      type: "hookPrompt",
      id: "hp-1",
      fragmentCount: 3,
    });
  });

  it("mcpToolCall：strip output/modelOutput，保留核心字段", () => {
    const input: WorkflowMcpToolCallItem = {
      type: "mcpToolCall",
      id: "mc-1",
      server: "fs",
      tool: "read",
      arguments: { path: "/a" },
      status: "completed",
      durationMs: 12,
      output: { text: "内容", truncated: false },
      modelOutput: { text: "模型输出", truncated: false },
    };
    expect(workflowItemToWorkflowTurnItem(input)).toEqual({
      type: "mcpToolCall",
      id: "mc-1",
      server: "fs",
      tool: "read",
      arguments: { path: "/a" },
      status: "completed",
      durationMs: 12,
    });
  });

  it("reasoning：strip encrypted，保留 summary/content", () => {
    const input: WorkflowReasoningItem = {
      type: "reasoning",
      id: "r-1",
      summary: "思考",
      content: [{ text: "详细", truncated: false }],
      encrypted: true,
    };
    expect(workflowItemToWorkflowTurnItem(input)).toEqual({
      type: "reasoning",
      id: "r-1",
      summary: "思考",
      content: [{ text: "详细", truncated: false }],
    });
  });

  it("无扩展字段的普通 item 原样返回", () => {
    const input = {
      type: "agentMessage" as const,
      id: "a-1",
      text: "hi",
    };
    expect(workflowItemToWorkflowTurnItem(input)).toEqual(input);
  });
});
