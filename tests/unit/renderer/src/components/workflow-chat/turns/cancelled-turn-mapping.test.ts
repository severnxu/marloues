/**
 * 验证 cancelled turn（Esc 中断）在渲染模型中的映射：
 * 不显示"处理中"/计时，显示 footer 元数据，状态标签为"已取消"。
 */
import { describe, expect, it } from "vitest";
import { workflowTurnToWorkflowMessage } from "../../../../../../../client/shared/adapters/workflow-messages-to-read-thread";
import { workflowTurnStatusLabel } from "../../../../../../../client/renderer/src/components/workflow-chat/turns/turn-status";
import type { WorkflowTurn } from "../../../../../../../client/shared/workflow-read-thread-contract";

function cancelledTurn(): WorkflowTurn {
  return {
    id: "turn-cancelled-1",
    status: "cancelled",
    error: null,
    startedAt: 1000,
    completedAt: 2000,
    durationMs: 1000,
    modelId: "model-x",
    modelName: "Model X",
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    items: [
      {
        type: "userMessage",
        id: "user-1",
        content: [{ type: "text", text: "/code-review" }],
      },
      {
        type: "agentMessage",
        id: "agent-1",
        text: "部分输出，被用户中断…",
        phase: "updated",
      },
    ],
  } as unknown as WorkflowTurn;
}

describe("cancelled turn 的渲染映射", () => {
  it("status 保留 cancelled，activity 归为 done（终态）", () => {
    const block = workflowTurnToWorkflowMessage(cancelledTurn());
    expect(block.status).toBe("cancelled");
    expect(block.activity).toBe("done");
  });

  it("不会命中 TurnView 的 running 条件（处理中 + 计时）", () => {
    const block = workflowTurnToWorkflowMessage(cancelledTurn());
    // 与 TurnView 保持同一表达式（isLastStreaming = false）
    const isLastStreaming = false;
    const running =
      isLastStreaming ||
      block.status === "running" ||
      block.activity === "thinking" ||
      block.activity === "running" ||
      block.activity === "responding";
    expect(running).toBe(false);
  });

  it("状态标签显示「已取消」而非「处理中」", () => {
    const block = workflowTurnToWorkflowMessage(cancelledTurn());
    expect(workflowTurnStatusLabel(block)).toBe("已取消");
    expect(workflowTurnStatusLabel(block)).not.toBe("处理中");
  });

  it("completed/failed/running 的既有映射不受影响", () => {
    const base = cancelledTurn();
    expect(
      workflowTurnToWorkflowMessage({ ...base, status: "completed" }).activity,
    ).toBe("done");
    expect(
      workflowTurnToWorkflowMessage({ ...base, status: "failed" }).activity,
    ).toBe("failed");
    const running = workflowTurnToWorkflowMessage({
      ...base,
      status: "running",
    });
    expect(running.status).toBe("running");
    expect(running.activity).toBe("responding"); // 有 agentMessage 文本
    expect(workflowTurnStatusLabel(running)).toBe("处理中");
  });
});
