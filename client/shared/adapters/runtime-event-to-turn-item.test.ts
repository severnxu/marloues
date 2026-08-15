import { describe, expect, it } from "vitest";
import {
  createTurnItemBuilder,
  isTerminalItemStatus,
} from "./runtime-event-to-turn-item";
import type { RuntimeItemEvent } from "./runtime-event-types";

const TURN_ID = "turn-1";
const SESSION_ID = "session-1";

function makeEvent(partial: Record<string, unknown>): RuntimeItemEvent {
  return {
    sessionId: SESSION_ID,
    turnId: TURN_ID,
    ...partial,
  } as RuntimeItemEvent;
}

const textChunk = (content: string) =>
  makeEvent({ type: "text.chunk", content, index: 0 });
const thinkingChunk = (content: string) =>
  makeEvent({ type: "thinking.chunk", content });
const planDelta = (itemId: string, content: string) =>
  makeEvent({ type: "plan.delta", itemId, content });
const planItem = (itemId: string, content: string) =>
  makeEvent({ type: "plan.item", itemId, content });
const toolStart = (toolId: string, toolName: string, input?: unknown) =>
  makeEvent({ type: "tool.start", toolId, toolName, input: input ?? {} });
const toolComplete = (toolId: string, output: unknown, isError = false) =>
  makeEvent({ type: "tool.complete", toolId, output, isError });
const approvalRequest = (requestId: string, toolName: string, reason: string) =>
  makeEvent({
    type: "approval.request",
    requestId,
    toolName,
    reason,
    timeout: 60_000,
    allowSession: true,
  });
const approvalDecision = (
  requestId: string,
  outcome: "approved" | "denied" | "timed_out" | "canceled",
) =>
  makeEvent({
    type: "approval.decision",
    requestId,
    approved: outcome === "approved",
    outcome,
  });

describe("TurnItemBuilder 同 id 多事件合并（护栏 ①）", () => {
  it("text.chunk 连续追加到同一 agentMessage，id 稳定", () => {
    const builder = createTurnItemBuilder({
      turnId: TURN_ID,
      zone: "workspace",
      refId: "s1",
    });
    builder.ingest(textChunk("Hello "));
    builder.ingest(textChunk("world"));

    const items = builder.items();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: "agentMessage",
      id: `agent-${TURN_ID}`,
      text: "Hello world",
    });
  });

  it("SDK 发全量 chunk（前缀命中）时不做二次拼接", () => {
    const builder = createTurnItemBuilder({
      turnId: TURN_ID,
      zone: "workspace",
      refId: "s1",
    });
    builder.ingest(textChunk("Hello "));
    const second = builder.ingest(textChunk("Hello world"));

    expect(second.changed).toBe(true);
    expect(second.item).toMatchObject({ text: "Hello world" });
    expect(builder.items()[0]).toMatchObject({ text: "Hello world" });
  });

  it("重复 chunk 无变化时 changed=false", () => {
    const builder = createTurnItemBuilder({
      turnId: TURN_ID,
      zone: "workspace",
      refId: "s1",
    });
    builder.ingest(textChunk("Hello"));
    const dup = builder.ingest(textChunk("Hello"));

    expect(dup.changed).toBe(false);
  });

  it("tool.start → tool.complete 状态迁移到同一 item", () => {
    const builder = createTurnItemBuilder({
      turnId: TURN_ID,
      zone: "workspace",
      refId: "s1",
    });
    builder.ingest(toolStart("tool-1", "bash", { command: "ls" }));
    builder.ingest(toolComplete("tool-1", "file.txt"));

    const items = builder.items();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: "mcpToolCall",
      id: "tool-1",
      tool: "bash",
      status: "completed",
      settled: true,
    });
    expect(items[0]).toMatchObject({
      output: { text: "file.txt", truncated: false },
    });
  });

  it("tool.complete 先于 tool.start 到达时兜底创建", () => {
    const builder = createTurnItemBuilder({
      turnId: TURN_ID,
      zone: "workspace",
      refId: "s1",
    });
    builder.ingest(toolComplete("tool-x", "out"));

    expect(builder.items()[0]).toMatchObject({
      type: "mcpToolCall",
      id: "tool-x",
      tool: "tool",
      status: "completed",
    });
  });

  it("plan.delta 追加、plan.item 置终态", () => {
    const builder = createTurnItemBuilder({
      turnId: TURN_ID,
      zone: "workspace",
      refId: "s1",
    });
    builder.ingest(planDelta("plan-1", "1. 调研"));
    builder.ingest(planDelta("plan-1", " 2. 编码"));
    const done = builder.ingest(planItem("plan-1", "1. 调研 2. 编码"));

    expect(done.item).toMatchObject({
      type: "plan",
      text: "1. 调研 2. 编码",
      settled: true,
    });
  });

  it("thinking.chunk 连续追加到同一 reasoning item", () => {
    const builder = createTurnItemBuilder({
      turnId: TURN_ID,
      zone: "workspace",
      refId: "s1",
    });
    builder.ingest(thinkingChunk("先"));
    builder.ingest(thinkingChunk("分析"));

    const items = builder.items();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: "reasoning",
      id: `reasoning-${TURN_ID}-1`,
      summary: "先分析",
    });
  });

  it("agentMessage 分段：文本流中断后新开 agent-<turnId>-<seq>", () => {
    const builder = createTurnItemBuilder({
      turnId: TURN_ID,
      zone: "workspace",
      refId: "s1",
    });
    builder.ingest(textChunk("第一段"));
    builder.ingest(toolStart("t1", "bash"));
    builder.ingest(toolComplete("t1", "ok"));
    builder.ingest(textChunk("第二段"));

    const items = builder.items();
    const agentItems = items.filter((i) => i.type === "agentMessage");
    expect(agentItems.map((i) => i.id)).toEqual([
      `agent-${TURN_ID}`,
      `agent-${TURN_ID}-2`,
    ]);
  });

  it("approval.request → approval.decision 状态映射", () => {
    const builder = createTurnItemBuilder({
      turnId: TURN_ID,
      zone: "workspace",
      refId: "s1",
    });
    builder.ingest(approvalRequest("req-1", "bash", "需要执行命令"));
    const denied = builder.ingest(approvalDecision("req-1", "denied"));

    expect(denied.item).toMatchObject({
      type: "permissionRequest",
      id: "req-1",
      toolName: "bash",
      status: "failed",
      settled: true,
    });
  });
});

describe("prevItem 快照语义（护栏 ②）", () => {
  it("新建 item / 首帧时 prevItem === undefined", () => {
    const builder = createTurnItemBuilder({
      turnId: TURN_ID,
      zone: "workspace",
      refId: "s1",
    });
    const first = builder.ingest(textChunk("Hello"));

    expect(first.prevItem).toBeUndefined();
    expect(first.changed).toBe(true);
  });

  it("prevItem 是 mutation 前 clone，不被后续变更污染", () => {
    const builder = createTurnItemBuilder({
      turnId: TURN_ID,
      zone: "workspace",
      refId: "s1",
    });
    builder.ingest(textChunk("Hello "));
    const second = builder.ingest(textChunk("world"));

    expect(second.prevItem).toMatchObject({ text: "Hello " });
    // prevItem 是独立快照：修改它不影响 builder 内状态
    if (second.prevItem) {
      (second.prevItem as { text: string }).text = "篡改";
    }
    expect(builder.getItem(`agent-${TURN_ID}`)).toMatchObject({
      text: "Hello world",
    });
  });

  it("后续事件仍能拿到每次 mutation 前的最新快照", () => {
    const builder = createTurnItemBuilder({
      turnId: TURN_ID,
      zone: "workspace",
      refId: "s1",
    });
    builder.ingest(textChunk("a"));
    const mid = builder.ingest(textChunk("ab"));
    const last = builder.ingest(textChunk("abc"));

    expect(mid.prevItem).toMatchObject({ text: "a" });
    expect(last.prevItem).toMatchObject({ text: "ab" });
  });
});

describe("settled/status 不变量（护栏 ③）", () => {
  it("running → settled=false；completed/failed/cancelled → settled=true", () => {
    expect(isTerminalItemStatus("running")).toBe(false);
    expect(isTerminalItemStatus("pending")).toBe(false);
    expect(isTerminalItemStatus("completed")).toBe(true);
    expect(isTerminalItemStatus("failed")).toBe(true);
    expect(isTerminalItemStatus("cancelled")).toBe(true);
    expect(isTerminalItemStatus("error")).toBe(true);
    expect(isTerminalItemStatus("timed_out")).toBe(true);
  });

  it("agentMessage 在 chunk 期间 settled=false", () => {
    const builder = createTurnItemBuilder({
      turnId: TURN_ID,
      zone: "workspace",
      refId: "s1",
    });
    builder.ingest(textChunk("Hi"));

    expect(builder.items()[0]).toMatchObject({ settled: false });
  });

  it("finalizeStreamingItems 后 agentMessage/reasoning settled=true", () => {
    const builder = createTurnItemBuilder({
      turnId: TURN_ID,
      zone: "workspace",
      refId: "s1",
    });
    builder.ingest(textChunk("Hi"));
    builder.ingest(thinkingChunk("想"));

    const finalized = builder.finalizeStreamingItems();
    expect(finalized).toHaveLength(2);
    for (const { item, prevItem } of finalized) {
      expect(item).toMatchObject({ settled: true });
      expect(prevItem).toMatchObject({ settled: false });
    }
  });

  it("finalizeStreamingItems 幂等：再次调用无变更", () => {
    const builder = createTurnItemBuilder({
      turnId: TURN_ID,
      zone: "workspace",
      refId: "s1",
    });
    builder.ingest(textChunk("Hi"));
    builder.finalizeStreamingItems();

    const again = builder.finalizeStreamingItems();
    expect(again).toHaveLength(0);
  });

  it("已终态的工具 item 不受 finalize 影响", () => {
    const builder = createTurnItemBuilder({
      turnId: TURN_ID,
      zone: "workspace",
      refId: "s1",
    });
    builder.ingest(toolStart("t1", "bash"));
    builder.ingest(toolComplete("t1", "ok"));

    const finalized = builder.finalizeStreamingItems();
    expect(finalized).toHaveLength(0);
  });
});

describe("zone 归属（护栏 ⑨）", () => {
  it("builder 携带创建时锁定的 zone/refId", () => {
    const builder = createTurnItemBuilder({
      turnId: TURN_ID,
      zone: "feishu",
      refId: "chat-42",
    });

    expect(builder.zone).toBe("feishu");
    expect(builder.refId).toBe("chat-42");
    expect(builder.turnId).toBe(TURN_ID);
  });
});
