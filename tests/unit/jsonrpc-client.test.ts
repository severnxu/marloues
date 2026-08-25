import { describe, it, expect, vi } from "vitest";

vi.mock("electron", () => ({ app: undefined }));

import { JsonRpcClient } from "../../client/main/codex/transport/jsonrpc-client";
import type { CodexTransport } from "../../client/main/codex/transport/connection";

interface FakeTransportHarness {
  transport: CodexTransport;
  emit: (msg: unknown) => void;
  written: string[];
}

function makeTransport(): FakeTransportHarness {
  let handler: ((msg: unknown) => void) | undefined;
  const written: string[] = [];
  const transport = {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    isAlive: vi.fn(() => true),
    stdin: {
      write: (chunk: string) => {
        written.push(chunk);
        return true;
      },
    } as unknown as CodexTransport["stdin"],
    stdout: {} as unknown as CodexTransport["stdout"],
    onNotification: vi.fn(),
    onResponse: (h: (msg: unknown) => void) => {
      handler = h;
    },
  } as unknown as CodexTransport;
  return { transport, emit: (msg) => handler?.(msg), written };
}

describe("jsonrpc-client", () => {
  it("resolves a request when a matching response arrives", async () => {
    const { transport, emit } = makeTransport();
    const client = new JsonRpcClient(transport);
    const promise = client.request("tools/list");
    emit({ jsonrpc: "2.0", id: 1, result: { tools: [] } });
    await expect(promise).resolves.toEqual({ tools: [] });
  });

  it("rejects when the response carries an error", async () => {
    const { transport, emit, written } = makeTransport();
    const client = new JsonRpcClient(transport);
    const promise = client.request("initialize");
    const id = JSON.parse(written[0]).id as number;
    emit({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: "method not found" },
    });
    await expect(promise).rejects.toThrow("method not found");
  });

  it("ignores responses with unknown ids", async () => {
    const { transport, emit, written } = makeTransport();
    const client = new JsonRpcClient(transport);
    const promise = client.request("x");
    let settled = false;
    void promise.finally(() => {
      settled = true;
    });
    const id = JSON.parse(written[0]).id as number;
    emit({ jsonrpc: "2.0", id: 999, result: "wrong" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    emit({ jsonrpc: "2.0", id, result: "ok" });
    await expect(promise).resolves.toBe("ok");
  });

  it("increments request ids across calls", async () => {
    const { transport, emit, written } = makeTransport();
    const client = new JsonRpcClient(transport);
    void client.request("a");
    emit({ jsonrpc: "2.0", id: 1, result: 1 });
    void client.request("b");
    emit({ jsonrpc: "2.0", id: 2, result: 2 });
    expect(JSON.parse(written[0]).id).toBeGreaterThan(0);
    expect(JSON.parse(written[1]).id).toBe(JSON.parse(written[0]).id + 1);
  });

  it("notify writes a message without an id field", () => {
    const { transport, written } = makeTransport();
    const client = new JsonRpcClient(transport);
    client.notify("notifications/initialized", {});
    expect(written[0]).toContain("notifications/initialized");
    expect(written[0]).not.toContain('"id"');
  });

  it("responds to a server-initiated request using the original id", () => {
    const { transport, written } = makeTransport();
    const client = new JsonRpcClient(transport);
    client.respond("server-7", { decision: "acceptForSession" });
    expect(JSON.parse(written[0])).toEqual({
      jsonrpc: "2.0",
      id: "server-7",
      result: { decision: "acceptForSession" },
    });
  });

  it("isOpen reflects transport liveness", () => {
    const { transport } = makeTransport();
    const client = new JsonRpcClient(transport);
    expect(client.isOpen()).toBe(true);
    vi.mocked(transport.isAlive).mockReturnValue(false);
    expect(client.isOpen()).toBe(false);
  });
});
