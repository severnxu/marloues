import { describe, expect, it } from "vitest";

import { resolveGatewayTarget } from "../../client/main/gateway";
import { encodeAnthropicRequest } from "../../client/main/gateway/protocol/from-internal/anthropic";
import { encodeOpenAIChatRequest } from "../../client/main/gateway/protocol/from-internal/openai-chat";
import { OpenAIResponsesSseFormatter } from "../../client/main/gateway/protocol/stream/responses-formatter";
import { decodeOpenAIResponsesRequest } from "../../client/main/gateway/protocol/to-internal/responses";

describe("Responses gateway tool conversion", () => {
  it("keeps function/custom tools and omits hosted tools without proxy semantics", () => {
    const request = decodeOpenAIResponsesRequest(
      {
        model: "codex-model",
        input: [{ type: "text", text: "run a command" }],
        tools: [
          {
            type: "function",
            name: "exec_command",
            description: "Execute a command",
            parameters: {
              type: "object",
              properties: { cmd: { type: "string" } },
              required: ["cmd"],
            },
          },
          {
            type: "custom",
            name: "apply_patch",
            description: "Apply a patch",
            format: { type: "grammar", syntax: "lark" },
          },
          { type: "web_search" },
        ],
      },
      "request-1",
    );

    expect(request.tools?.map((tool) => [tool.name, tool.kind])).toEqual([
      ["exec_command", "function"],
      ["apply_patch", "custom"],
    ]);

    const anthropic = encodeAnthropicRequest(request);
    expect(anthropic.tools?.map((tool) => tool.name)).toEqual([
      "exec_command",
      "apply_patch",
    ]);
    expect(anthropic.tools?.[1].input_schema).toMatchObject({
      type: "object",
      properties: { input: { type: "string" } },
      required: ["input"],
      additionalProperties: false,
    });
    expect(anthropic.tools?.every((tool) => Boolean(tool.name))).toBe(true);
  });

  it("restores proxied custom calls to Codex Responses events", () => {
    const formatter = new OpenAIResponsesSseFormatter(
      "request-2",
      "codex-model",
      new Set(["apply_patch"]),
    );

    const stream =
      formatter.formatDeltas([
        {
          type: "tool_call_start",
          index: 0,
          id: "call-patch",
          name: "apply_patch",
        },
        {
          type: "tool_call_delta",
          index: 0,
          arguments: '{"input":"*** Begin Patch\\n*** End Patch"}',
        },
      ]) + formatter.done();

    expect(stream.indexOf("response.created")).toBeLessThan(
      stream.indexOf("response.output_item.added"),
    );
    expect(stream).toContain('"type":"custom_tool_call"');
    expect(stream).toContain('"call_id":"call-patch"');
    expect(stream).toContain('"input":"*** Begin Patch\\n*** End Patch"');
    expect(stream).not.toContain("response.function_call_arguments.delta");
  });

  it("continues emitting ordinary function calls", () => {
    const formatter = new OpenAIResponsesSseFormatter(
      "request-3",
      "codex-model",
    );
    const stream =
      formatter.formatDeltas([
        {
          type: "tool_call_start",
          index: 0,
          id: "call-exec",
          name: "exec_command",
        },
        {
          type: "tool_call_delta",
          index: 0,
          arguments: '{"cmd":"pwd"}',
        },
      ]) + formatter.done();

    expect(stream).toContain("response.function_call_arguments.delta");
    expect(stream).toContain('"type":"function_call"');
    expect(stream).toContain('"arguments":"{\\"cmd\\":\\"pwd\\"}"');
    expect(stream).not.toContain('"type":"message"');
  });

  it("preserves function and custom tool history on later model rounds", () => {
    const request = decodeOpenAIResponsesRequest(
      {
        model: "codex-model",
        input: [
          {
            type: "function_call",
            call_id: "call-exec",
            name: "exec_command",
            arguments: '{"cmd":"pwd"}',
          },
          {
            type: "function_call_output",
            call_id: "call-exec",
            output: "exit 0",
          },
          {
            type: "custom_tool_call",
            call_id: "call-patch",
            name: "apply_patch",
            input: "*** Begin Patch",
          },
          {
            type: "custom_tool_call_output",
            call_id: "call-patch",
            output: [{ type: "output_text", text: "Done" }],
          },
        ],
      },
      "request-4",
    );
    const chat = encodeOpenAIChatRequest(request);

    expect(chat.messages).toMatchObject([
      {
        role: "assistant",
        tool_calls: [
          {
            id: "call-exec",
            function: { name: "exec_command", arguments: '{"cmd":"pwd"}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "call-exec", content: "exit 0" },
      {
        role: "assistant",
        tool_calls: [
          {
            id: "call-patch",
            function: {
              name: "apply_patch",
              arguments: '{"input":"*** Begin Patch"}',
            },
          },
        ],
      },
      { role: "tool", tool_call_id: "call-patch", content: "Done" },
    ]);
  });

  it("folds Codex assistant text into its pending tool-call message", () => {
    const request = decodeOpenAIResponsesRequest(
      {
        model: "codex-model",
        input: [
          {
            type: "function_call",
            call_id: "call-permissions",
            name: "request_permissions",
            arguments:
              '{"permissions":{"file_system":{"write":["C:/outside.txt"]}}}',
          },
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "" }],
          },
          {
            type: "function_call_output",
            call_id: "call-permissions",
            output: '{"scope":"session"}',
          },
          {
            type: "function_call",
            call_id: "call-exec",
            name: "exec_command",
            arguments: '{"cmd":"Set-Content C:/outside.txt ok"}',
          },
          {
            type: "message",
            role: "assistant",
            content: [
              { type: "output_text", text: "权限已获得，现在执行命令。" },
            ],
          },
          {
            type: "function_call_output",
            call_id: "call-exec",
            output: "exit 0",
          },
        ],
      },
      "request-interleaved",
    );
    const chat = encodeOpenAIChatRequest(request);

    expect(chat.messages).toHaveLength(4);
    expect(chat.messages).toMatchObject([
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "call-permissions" }],
      },
      { role: "tool", tool_call_id: "call-permissions" },
      {
        role: "assistant",
        content: "权限已获得，现在执行命令。",
        tool_calls: [{ id: "call-exec" }],
      },
      { role: "tool", tool_call_id: "call-exec" },
    ]);
  });

  it("uses DeepSeek's OpenAI endpoint for cc-switch Anthropic URLs", () => {
    expect(resolveGatewayTarget("https://api.deepseek.com/anthropic")).toEqual({
      baseUrl: "https://api.deepseek.com",
      protocol: "openai-chat",
    });
    expect(resolveGatewayTarget("https://proxy.example/v1/anthropic")).toEqual({
      baseUrl: "https://proxy.example/v1/anthropic",
      protocol: "anthropic",
    });
  });
});
