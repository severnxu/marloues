import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { WorkflowMessageBlock } from "../../../../../../../client/shared/adapters/workflow-messages-to-read-thread";
import { WorkflowAssistantTurn } from "../../../../../../../client/renderer/src/components/workflow-chat/turns/AssistantTurn";
import { formatAssistantMessageTime } from "../../../../../../../client/renderer/src/components/workflow-chat/turns/TurnFooterView";
import { WorkflowTurnView } from "../../../../../../../client/renderer/src/components/workflow-chat/turns/TurnView";
import { buildTurnPresentationModel } from "../../../../../../../client/renderer/src/components/workflow-chat/turns/turn-presentation-model";

vi.hoisted(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      marloues: {},
      localStorage: {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
      },
    },
  });
});

describe("WorkflowAssistantTurn actions", () => {
  it("shows Fork instead of retry for a completed assistant response", () => {
    const message: WorkflowMessageBlock = {
      id: "turn-1",
      userMessageId: "user-1",
      user: "Create a branch",
      userContent: [{ type: "text", text: "Create a branch" }],
      status: "completed",
      activity: "done",
      durationMs: 1_000,
      items: [
        {
          type: "agentMessage",
          id: "assistant-1",
          text: "The response is ready.",
        },
      ],
    };
    const model = buildTurnPresentationModel(message, {
      isLastStreaming: false,
    });
    const html = renderToStaticMarkup(
      <WorkflowAssistantTurn
        duration="1s"
        expanded={false}
        model={model}
        onToggle={() => undefined}
        onCopy={() => undefined}
        onFork={() => undefined}
        onDelete={() => undefined}
      />,
    );

    expect(html).toContain('title="创建对话分支"');
    expect(html).toContain(">分支</span>");
    expect(html).not.toContain("重试上一条用户消息");
  });

  it("keeps normal actions, duration, and minute-level time on an interrupted steer fragment", () => {
    const startedAt = new Date(2026, 6, 29, 14, 4).getTime();
    const completedAt = new Date(2026, 6, 29, 14, 5).getTime();
    const message: WorkflowMessageBlock = {
      id: "turn-interrupted",
      userMessageId: "user-interrupted",
      user: "先写一段说明",
      userContent: [{ type: "text", text: "先写一段说明" }],
      status: "completed",
      activity: "done",
      startedAt,
      completedAt,
      durationMs: completedAt - startedAt,
      continuationFragment: true,
      items: [
        {
          type: "agentMessage",
          id: "assistant-interrupted",
          text: "这是引导前已经生成并保留的回复。",
        },
      ],
    };

    const html = renderToStaticMarkup(
      <WorkflowTurnView
        message={message}
        expanded={false}
        isLastStreaming={false}
        onToggle={() => undefined}
        onCopy={() => undefined}
        onFork={() => undefined}
      />,
    );

    expect(html).toContain('title="复制回复"');
    expect(html).toContain('title="创建对话分支"');
    expect(html).toContain(">1分钟</span>");
    expect(html).toContain(
      `>${formatAssistantMessageTime(completedAt)}</time>`,
    );
  });
});
