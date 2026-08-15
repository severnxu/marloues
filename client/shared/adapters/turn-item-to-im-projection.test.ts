import { describe, expect, it } from "vitest";
import {
  projectTurnItem,
  projectTurnItemWith,
  type ImCapability,
} from "./turn-item-to-im-projection";
import type {
  WorkflowAgentMessageItem,
  WorkflowFileChangeItem,
  WorkflowMcpToolCallItem,
  WorkflowPermissionRequestItem,
  WorkflowReasoningItem,
  WorkflowTurnItem,
} from "../workflow-read-thread-contract";

const TEXT_STREAM: readonly ImCapability[] = ["textStream"];
const FULL: readonly ImCapability[] = [
  "textStream",
  "cardMessage",
  "inlineStatus",
  "approvalCard",
  "fileChangeCard",
  "commandExecutionCard",
];

const agent = (text: string, settled = false): WorkflowAgentMessageItem => ({
  type: "agentMessage",
  id: "agent-1",
  text,
  settled,
});

const reasoning = (settled = false): WorkflowReasoningItem => ({
  type: "reasoning",
  id: "r1",
  summary: "思考内容",
  settled,
});

const runningTool = (): WorkflowMcpToolCallItem => ({
  type: "mcpToolCall",
  id: "t1",
  tool: "bash",
  status: "running",
  settled: false,
});

const doneTool = (isError: boolean): WorkflowMcpToolCallItem => ({
  type: "mcpToolCall",
  id: "t1",
  tool: "bash",
  status: isError ? "error" : "completed",
  settled: true,
  output: { text: "long ".repeat(2000), truncated: false },
});

const fileChange = (): WorkflowFileChangeItem => ({
  type: "fileChange",
  id: "fc1",
  status: "completed",
  changes: [
    { path: "src/a.ts", kind: "edit" },
    { path: "src/b.ts", kind: "create" },
  ],
});

const pendingApproval = (): WorkflowPermissionRequestItem => ({
  type: "permissionRequest",
  id: "req-1",
  toolName: "bash",
  reason: "需要执行命令",
  status: "running",
  timeoutMs: 60_000,
});

describe("projectTurnItem 首帧/增量语义（护栏 ⑤）", () => {
  it("agentMessage 首帧（prevItem 缺失）走全量", () => {
    const [p] = projectTurnItemWith(agent("Hello world"), undefined, FULL);
    expect(p).toEqual({ kind: "textDelta", text: "Hello world", done: false });
  });

  it("agentMessage 增量只追加差异部分", () => {
    const [p] = projectTurnItemWith(agent("Hello world"), agent("Hello"), FULL);
    expect(p).toEqual({ kind: "textDelta", text: " world", done: false });
  });

  it("增量 diff 前缀不匹配时全量兜底", () => {
    const [p] = projectTurnItemWith(agent("X!Y"), agent("Hello"), FULL);
    expect(p).toEqual({ kind: "textDelta", text: "X!Y", done: false });
  });

  it("settled=true 时 textDelta done=true", () => {
    const [p] = projectTurnItemWith(agent("Done", true), agent("Do"), FULL);
    expect(p).toEqual({ kind: "textDelta", text: "ne", done: true });
  });

  it("无增量（重复 chunk）时返回 skip", () => {
    const [p] = projectTurnItemWith(agent("Hi"), agent("Hi"), FULL);
    expect(p).toEqual({ kind: "skip" });
  });

  it("无 textStream 能力时 agentMessage → skip", () => {
    const [p] = projectTurnItemWith(agent("Hi"), undefined, []);
    expect(p).toEqual({ kind: "skip" });
  });
});

describe("projectTurnItem 状态/卡片投影", () => {
  it("reasoning → statusLine（不推思考文本）", () => {
    const [p] = projectTurnItemWith(reasoning(), undefined, FULL);
    expect(p).toEqual({
      kind: "statusLine",
      text: "思考中…",
      state: "running",
    });
  });

  it("工具运行中 → statusLine running", () => {
    const [p] = projectTurnItemWith(runningTool(), undefined, FULL);
    expect(p).toEqual({
      kind: "statusLine",
      text: "调用工具 bash…",
      state: "running",
    });
  });

  it("工具成功完成 → resultCard，长输出截断", () => {
    const [p] = projectTurnItemWith(doneTool(false), runningTool(), FULL);
    expect(p.kind).toBe("resultCard");
    if (p.kind === "resultCard") {
      expect(p.title).toBe("bash");
      expect(p.summary.length).toBeLessThanOrEqual(4001);
      expect(p.summary.endsWith("…")).toBe(true);
    }
  });

  it("工具失败 → errorCard", () => {
    const [p] = projectTurnItemWith(doneTool(true), runningTool(), FULL);
    expect(p).toMatchObject({ kind: "errorCard" });
  });

  it("无 cardMessage 能力时工具完成降级为 statusLine", () => {
    const [p] = projectTurnItemWith(doneTool(false), runningTool(), [
      "inlineStatus",
    ]);
    expect(p).toEqual({
      kind: "statusLine",
      text: "工具 bash 完成",
      state: "done",
    });
  });

  it("fileChange → fileChangeCard 携带完整变更列表", () => {
    const [p] = projectTurnItemWith(fileChange(), undefined, FULL);
    expect(p).toEqual({
      kind: "fileChangeCard",
      changes: [
        { path: "src/a.ts", kind: "edit" },
        { path: "src/b.ts", kind: "create" },
      ],
    });
  });

  it("审批运行中 → approvalCard（需能力）", () => {
    const [p] = projectTurnItemWith(pendingApproval(), undefined, FULL);
    expect(p).toEqual({
      kind: "approvalCard",
      requestId: "req-1",
      toolName: "bash",
      reason: "需要执行命令",
    });
  });

  it("无 approvalCard 能力时审批 → skip", () => {
    const [p] = projectTurnItemWith(pendingApproval(), undefined, TEXT_STREAM);
    expect(p).toEqual({ kind: "skip" });
  });

  it("未知 item → skip", () => {
    const item: WorkflowTurnItem = { type: "unknown", id: "u1", raw: {} };
    const [p] = projectTurnItem(item, undefined, new Set(FULL));
    expect(p).toEqual({ kind: "skip" });
  });
});
