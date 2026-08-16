import { describe, expect, it } from "vitest";
import type { WorkflowTurnItem } from "../../../../../../../../client/shared/adapters/workflow-messages-to-read-thread";
import {
  finalAssistantTextFromIndexes,
  findFinalAgentMessageIndexes,
} from "../../../../../../../../client/renderer/src/components/workflow-chat/turns/turn-layout/flow-helpers";

describe("final agent message boundaries", () => {
  it("uses app-server final_answer instead of commentary", () => {
    const items: WorkflowTurnItem[] = [
      {
        type: "agentMessage",
        id: "commentary",
        text: "I am checking the configuration.",
        phase: "commentary",
      },
      {
        type: "commandExecution",
        id: "command",
        command: "Get-Content config.toml",
        status: "completed",
      },
      {
        type: "agentMessage",
        id: "answer",
        text: "The provider is missing `env_key`.",
        phase: "final_answer",
      },
    ];

    const indexes = findFinalAgentMessageIndexes(items);

    expect([...indexes]).toEqual([2]);
    expect(finalAssistantTextFromIndexes(items, indexes)).toBe(
      "The provider is missing `env_key`.",
    );
  });

  it("does not promote commentary-only output into a final document", () => {
    const items: WorkflowTurnItem[] = [
      {
        type: "agentMessage",
        id: "commentary",
        text: "Still working…",
        phase: "commentary",
      },
    ];

    expect([...findFinalAgentMessageIndexes(items)]).toEqual([]);
  });

  it("keeps the legacy last-run fallback for runtime lifecycle phases", () => {
    const items: WorkflowTurnItem[] = [
      {
        type: "agentMessage",
        id: "progress",
        text: "First update.",
        phase: "updated",
      },
      {
        type: "commandExecution",
        id: "command",
        command: "echo done",
        status: "completed",
      },
      {
        type: "agentMessage",
        id: "answer",
        text: "Finished.",
        phase: "updated",
      },
    ];

    const indexes = findFinalAgentMessageIndexes(items);

    expect([...indexes]).toEqual([2]);
    expect(finalAssistantTextFromIndexes(items, indexes)).toBe("Finished.");
  });
});
