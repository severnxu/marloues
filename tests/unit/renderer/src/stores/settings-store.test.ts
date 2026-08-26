import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSettings, RuntimeKind, RuntimeState } from "@shared/types";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function settings(activeRuntimeId: RuntimeKind): AgentSettings {
  return {
    activeRuntimeId,
    providers: [],
    defaultModel: { providerId: "provider", modelId: "model" },
  } as AgentSettings;
}

function runtimeState(activeRuntimeId: RuntimeKind): RuntimeState {
  return {
    activeRuntimeId,
    activeRuntimeName: activeRuntimeId,
    runtimes: ["sdk", "binary", "self-built"].map((id) => ({
      id: id as RuntimeKind,
      name: id,
      description: id,
      status: "available" as const,
      capabilities: {
        forkThread: true,
        interruptTurn: true,
        setModel: true,
        setPermissionMode: true,
        registerTool: true,
        cancelTool: true,
        editMessage: true,
        sandbox: true,
      },
    })),
  };
}

async function loadStore(input: {
  getAgentSettings: ReturnType<typeof vi.fn>;
  getRuntimeState: ReturnType<typeof vi.fn>;
  switchRuntime: ReturnType<typeof vi.fn>;
  listModels?: ReturnType<typeof vi.fn>;
}) {
  vi.resetModules();
  (globalThis as typeof globalThis & { window: Window }).window = {
    marloues: {
      config: {
        getAgentSettings: input.getAgentSettings,
      },
      runtime: {
        getState: input.getRuntimeState,
        switch: input.switchRuntime,
        listModels: input.listModels ?? vi.fn().mockResolvedValue([]),
      },
    },
  } as unknown as Window & typeof globalThis;
  return (
    await import("../../../../../client/renderer/src/stores/settings-store")
  ).useSettingsStore;
}

describe("settings store runtime switching", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("loads the authoritative runtime state with settings", async () => {
    const current = runtimeState("sdk");
    const store = await loadStore({
      getAgentSettings: vi.fn().mockResolvedValue(settings("sdk")),
      getRuntimeState: vi.fn().mockResolvedValue(current),
      switchRuntime: vi.fn(),
    });

    await store.getState().load();

    expect(store.getState()).toMatchObject({
      settings: { activeRuntimeId: "sdk" },
      runtimeState: current,
      switchingRuntimeId: null,
    });
  });

  it("keeps switching visible until IPC returns and then refreshes settings", async () => {
    const switched = deferred<RuntimeState>();
    const nextState = runtimeState("self-built");
    const getAgentSettings = vi
      .fn()
      .mockResolvedValueOnce(settings("sdk"))
      .mockResolvedValueOnce(settings("self-built"));
    const store = await loadStore({
      getAgentSettings,
      getRuntimeState: vi.fn().mockResolvedValue(runtimeState("sdk")),
      switchRuntime: vi.fn(() => switched.promise),
    });
    await store.getState().load();

    const switching = store.getState().switchRuntime("self-built");
    expect(store.getState().switchingRuntimeId).toBe("self-built");

    switched.resolve(nextState);
    await switching;

    expect(store.getState()).toMatchObject({
      settings: { activeRuntimeId: "self-built" },
      runtimeState: nextState,
      switchingRuntimeId: null,
    });
  });

  it("clears the pending runtime when switching fails", async () => {
    const store = await loadStore({
      getAgentSettings: vi.fn().mockResolvedValue(settings("sdk")),
      getRuntimeState: vi.fn().mockResolvedValue(runtimeState("sdk")),
      switchRuntime: vi
        .fn()
        .mockRejectedValue(new Error("runtime unavailable")),
    });
    await store.getState().load();

    await expect(store.getState().switchRuntime("binary")).rejects.toThrow(
      "runtime unavailable",
    );
    expect(store.getState().switchingRuntimeId).toBeNull();
    expect(store.getState().runtimeState?.activeRuntimeId).toBe("sdk");
  });
});
