import { describe, expect, it, vi } from "vitest";
import type { ImPermissionContext } from "@shared/im/im-types";
import {
  ImCommandRouter,
  parseImCommand,
  type ImCommandActions,
} from "../../../../../client/main/im/pipeline/im-command-router";

const ctx: ImPermissionContext = {
  channel: "feishu",
  chatId: "chat-1",
  senderId: "user-1",
  role: "owner",
};

describe("IM command router", () => {
  it("parses /clear as a control-plane command", () => {
    expect(parseImCommand("/clear")).toEqual({
      name: "clear",
      args: undefined,
    });
    expect(parseImCommand("/clear now")).toEqual({
      name: "clear",
      args: "now",
    });
  });

  it("dispatches commands to injected actions instead of the agent runtime", async () => {
    const actions = createActions();
    const router = new ImCommandRouter(actions);

    await expect(router.handle(ctx, { name: "clear" })).resolves.toBe(
      "cleared",
    );

    expect(actions.clear).toHaveBeenCalledWith(ctx);
    expect(actions.newSession).not.toHaveBeenCalled();
  });

  it("turns command action failures into IM receipts", async () => {
    const actions = createActions({
      newSession: vi.fn(async () => {
        throw new Error("runtime unhealthy");
      }),
    });
    const router = new ImCommandRouter(actions);

    await expect(router.handle(ctx, { name: "new" })).resolves.toBe(
      "命令 /new 执行失败：runtime unhealthy",
    );
  });
});

function createActions(
  overrides: Partial<ImCommandActions> = {},
): ImCommandActions {
  return {
    newSession: vi.fn(async () => "new"),
    listSessions: vi.fn(async () => "list"),
    stopTurn: vi.fn(async () => "stopped"),
    compact: vi.fn(async () => "compacted"),
    clear: vi.fn(async () => "cleared"),
    ...overrides,
  };
}
