import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { WorkflowMessageBlock } from "../../../../../../../client/shared/adapters/workflow-messages-to-read-thread";
import { WorkflowAssistantTurn } from "../../../../../../../client/renderer/src/components/workflow-chat/turns/AssistantTurn";
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

describe("TurnPresentationBlocks", () => {
  it("renders the final document once and keeps result cards separate", () => {
    const html = render(
      turn({
        items: [
          { type: "webSearch", id: "search", query: "Codex app-server" },
          { type: "agentMessage", id: "answer", text: "Implemented once." },
        ],
      }),
    );

    expect(html).toContain('data-block-kind="document"');
    expect(html).toContain('data-block-kind="results"');
    expect(html.match(/Implemented once\./g)).toHaveLength(1);
    expect(html).toContain('data-result-kind="preview"');
  });

  it("renders running tools and approvals only in the process block", () => {
    const html = render(
      turn({
        status: "running",
        activity: "running",
        completedAt: undefined,
        durationMs: null,
        items: [
          {
            type: "commandExecution",
            id: "command",
            command: "npm test",
            status: "running",
          },
          {
            type: "permissionRequest",
            id: "approval",
            toolName: "shell_command",
            reason: "Run the test suite",
            status: "pending",
          },
        ],
      }),
      true,
    );

    expect(html).toContain('data-block-kind="process"');
    expect(html).not.toContain('data-block-kind="document"');
    expect(html).not.toContain('data-block-kind="results"');
    expect(html).toContain('data-kind="activity-row"');
  });

  it("renders failed output through the error document", () => {
    const html = render(
      turn({
        status: "failed",
        activity: "failed",
        items: [
          {
            type: "agentMessage",
            id: "error",
            text: "Process exited with code 1",
          },
        ],
      }),
    );

    expect(html).toContain('data-block-kind="document"');
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('data-kind="assistant-answer"');
  });
});

function render(message: WorkflowMessageBlock, isLastStreaming = false) {
  const model = buildTurnPresentationModel(message, { isLastStreaming });
  return renderToStaticMarkup(
    <WorkflowAssistantTurn
      model={model}
      duration="1s"
      expanded
      onToggle={() => undefined}
    />,
  );
}

function turn(patch: Partial<WorkflowMessageBlock> = {}): WorkflowMessageBlock {
  return {
    id: "turn-1",
    userMessageId: "user-1",
    user: "Implement it",
    userContent: [{ type: "text", text: "Implement it" }],
    status: "completed",
    activity: "done",
    startedAt: 100,
    completedAt: 1_100,
    durationMs: 1_000,
    items: [],
    ...patch,
  };
}
