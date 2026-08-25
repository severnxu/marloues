import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: undefined }));

import { CodexAppServerSession } from "../../client/main/codex/session";
import type { CodexTransport } from "../../client/main/codex/transport/connection";
import { JsonRpcClient } from "../../client/main/codex/transport/jsonrpc-client";

function createHarness() {
  const written: Array<Record<string, unknown>> = [];
  let responseHandler: ((message: unknown) => void) | undefined;
  let serverRequestHandler:
    | ((id: string | number, method: string, params: unknown) => void)
    | undefined;
  const stdin = {
    write(chunk: string) {
      const message = JSON.parse(chunk) as Record<string, unknown>;
      written.push(message);
      if (message.method === "initialize") {
        queueMicrotask(() =>
          responseHandler?.({
            jsonrpc: "2.0",
            id: message.id,
            result: {
              userAgent: "codex-test",
              codexHome: "C:\\codex",
              platformFamily: "windows",
              platformOs: "windows",
            },
          }),
        );
      }
      return true;
    },
  } as unknown as CodexTransport["stdin"];
  const transport = {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    isAlive: vi.fn(() => true),
    stdin,
    stdout: {} as CodexTransport["stdout"],
    onNotification: vi.fn(),
    onServerRequest: (
      handler: (id: string | number, method: string, params: unknown) => void,
    ) => {
      serverRequestHandler = handler;
    },
    onResponse: (handler: (message: unknown) => void) => {
      responseHandler = handler;
    },
  } as CodexTransport;
  const rpc = new JsonRpcClient(transport);
  const session = new CodexAppServerSession("session-a", rpc, transport);
  return {
    session,
    written,
    request(id: string | number, method: string, params: unknown) {
      serverRequestHandler?.(id, method, params);
    },
  };
}

describe("Codex app-server approvals", () => {
  it("maps allow-for-task to acceptForSession on command requests", async () => {
    const harness = createHarness();
    const events: Array<{ type: string; id?: string; allowSession?: boolean }> =
      [];
    harness.session.onEvent((event) => events.push(event));
    await harness.session.start();

    expect(harness.written[0]).toMatchObject({
      method: "initialize",
      params: { capabilities: { experimentalApi: true } },
    });

    harness.request(41, "item/commandExecution/requestApproval", {
      threadId: "thread-a",
      turnId: "turn-a",
      command: "echo ok",
      cwd: "C:\\workspace",
      availableDecisions: ["accept", "acceptForSession", "decline"],
    });

    const approval = events.find(
      (event) => event.type === "approval_requested",
    );
    expect(approval?.allowSession).toBe(true);
    await harness.session.respondToApproval(
      approval?.id ?? "missing",
      "approve",
      "session",
    );
    expect(harness.written.at(-1)).toEqual({
      jsonrpc: "2.0",
      id: 41,
      result: { decision: "acceptForSession" },
    });
  });

  it("returns an empty permission subset when the user denies escalation", async () => {
    const harness = createHarness();
    let approvalId = "";
    harness.session.onEvent((event) => {
      if (event.type === "approval_requested") approvalId = event.id;
    });
    await harness.session.start();

    harness.request("permission-9", "item/permissions/requestApproval", {
      threadId: "thread-a",
      permissions: { network: { enabled: true } },
    });
    await harness.session.respondToApproval(approvalId, "deny", "once");
    expect(harness.written.at(-1)).toEqual({
      jsonrpc: "2.0",
      id: "permission-9",
      result: { permissions: {}, scope: "turn" },
    });
  });
});
