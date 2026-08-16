import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { WorkflowMessageBlock } from "@shared/adapters/workflow-messages-to-read-thread";
import type { ChatSessionRecord } from "@shared/types";
import type { WorkflowTurnItem } from "@shared/workflow-read-thread-contract";
import { useUnifiedChatStore } from "../../../../../../../client/renderer/src/stores/unified-chat-store";
import { WorkflowTurnView } from "../../../../../../../client/renderer/src/components/workflow-chat/turns/TurnView";

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

describe("long running turn rendering", () => {
  it("keeps mounted activity rows bounded for a very large active turn", () => {
    const itemCount = 20_000;
    const message: WorkflowMessageBlock = {
      id: "stress-turn",
      user: "stress",
      userContent: [{ type: "text", text: "stress" }],
      status: "running",
      activity: "running",
      startedAt: Date.now() - 1_000,
      durationMs: null,
      items: Array.from({ length: itemCount }, (_, index) => ({
        type: "commandExecution" as const,
        id: `command-${index}`,
        command: `echo ${index}`,
        status: index === itemCount - 1 ? "running" : "completed",
        output: { text: `output ${index}` },
      })),
    };

    const html = renderToStaticMarkup(
      <WorkflowTurnView
        message={message}
        expanded
        isLastStreaming
        onToggle={() => undefined}
      />,
    );
    const mountedRows = html.match(/data-kind="activity-row"/g)?.length ?? 0;

    expect(mountedRows).toBeGreaterThan(0);
    expect(mountedRows).toBeLessThanOrEqual(48);
    expect(html).not.toContain("echo 0");
    expect(html).toContain(`echo ${itemCount - 1}`);
  });

  it("keeps the renderer working set bounded while canonical items accumulate", () => {
    const sessionId = "stress-session";
    const turnId = "stress-turn";
    const messageId = `assistant-${turnId}`;
    const now = Date.now();
    const session: ChatSessionRecord = {
      id: sessionId,
      title: "stress",
      createdAt: now,
      updatedAt: now,
      messages: [
        {
          id: messageId,
          role: "assistant",
          content: "",
          blocks: [],
          createdAt: now,
          items: [],
        },
      ],
    };
    const updates: WorkflowTurnItem[] = [
      {
        id: "answer",
        type: "agentMessage",
        text: "partial answer that must stay visible",
        settled: false,
      },
      ...Array.from({ length: 20_000 }, (_, index) => ({
        id: `command-${index}`,
        type: "commandExecution" as const,
        command: `echo ${index}`,
        status: index === 19_999 ? "running" : "completed",
      })),
    ];

    useUnifiedChatStore.setState({
      activeSessionId: sessionId,
      sessions: [session],
      allSessions: [session],
    });
    const sessionTreeSnapshot = useUnifiedChatStore.getState().allSessions;
    useUnifiedChatStore.getState().handleItemEvent({
      type: "items.updated",
      sessionId,
      turnId,
      items: updates,
    });

    const retainedItems =
      useUnifiedChatStore.getState().sessions[0].messages[0].items;
    expect(retainedItems.length).toBeLessThanOrEqual(576);
    expect(retainedItems.some((item) => item.id === "answer")).toBe(true);
    expect(retainedItems.at(-1)?.id).toBe("command-19999");
    expect(useUnifiedChatStore.getState().allSessions).toBe(
      sessionTreeSnapshot,
    );
  });
});
