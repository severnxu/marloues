import { describe, it, expect } from "vitest";
import { normalizeClaudeMessage } from "../../client/main/core/runtime/claude-normalizer";

const ctx = { turnId: "tu", timestamp: 1000 };

describe("claude-normalizer", () => {
  it("maps text_delta to an in-progress agent_message", () => {
    const items = normalizeClaudeMessage(
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "hi" } } },
      ctx,
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "agent_message", rawType: "text_delta", phase: "updated", text: "hi" });
  });

  it("maps thinking_delta to a reasoning item", () => {
    const items = normalizeClaudeMessage(
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "..." } } },
      ctx,
    );
    expect(items[0]).toMatchObject({ type: "reasoning", phase: "updated", text: "..." });
  });

  it("maps content_block_start tool_use to a started tool call", () => {
    const items = normalizeClaudeMessage(
      {
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "tb_1", name: "Bash", input: {} },
        },
      },
      ctx,
    );
    expect(items[0]).toMatchObject({ type: "mcp_tool_call", phase: "started", tool: "Bash", status: "in_progress" });
  });

  it("maps input_json_delta to an updated tool call", () => {
    const items = normalizeClaudeMessage(
      {
        type: "stream_event",
        event: { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"cmd":"ls"}' } },
      },
      ctx,
    );
    expect(items[0]).toMatchObject({ type: "mcp_tool_call", phase: "updated" });
    expect(items[0].args).toEqual({ cmd: "ls" });
  });

  it("maps full assistant text blocks to completed agent messages", () => {
    const items = normalizeClaudeMessage(
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "full reply" }] } },
      ctx,
    );
    expect(items[0]).toMatchObject({ type: "agent_message", phase: "completed", text: "full reply", status: "completed" });
  });

  it("maps result errors to an error item", () => {
    const items = normalizeClaudeMessage({ type: "result", subtype: "error", is_error: true, result: "boom" }, ctx);
    expect(items[0]?.type).toBe("error");
  });

  it("ignores system init messages", () => {
    expect(normalizeClaudeMessage({ type: "system", subtype: "init" }, ctx)).toHaveLength(0);
  });

  it("ignores unknown message types", () => {
    expect(normalizeClaudeMessage({ type: "unknown_kind" }, ctx)).toHaveLength(0);
  });
});
