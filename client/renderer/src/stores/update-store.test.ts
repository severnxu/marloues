import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateState } from "@shared/types";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function loadStore(update: {
  getState: ReturnType<typeof vi.fn>;
  check: ReturnType<typeof vi.fn>;
  download: ReturnType<typeof vi.fn>;
  installNow: ReturnType<typeof vi.fn>;
}) {
  vi.resetModules();
  (globalThis as typeof globalThis & { window: Window }).window = {
    marloues: { update },
  } as unknown as Window & typeof globalThis;
  return (await import("./update-store")).useUpdateStore;
}

describe("update store", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("hydrates authoritative state after a manual check", async () => {
    const checking = deferred();
    const available: UpdateState = { status: "available", version: "2.0.0" };
    const update = {
      getState: vi.fn().mockResolvedValue(available),
      check: vi.fn(() => checking.promise),
      download: vi.fn(),
      installNow: vi.fn(),
    };
    const store = await loadStore(update);

    const checkingPromise = store.getState().check();
    expect(store.getState().isChecking).toBe(true);
    expect(update.check).toHaveBeenCalledTimes(1);

    checking.resolve();
    await checkingPromise;

    expect(store.getState()).toMatchObject({
      state: available,
      isChecking: false,
      isDownloading: false,
    });
  });

  it("turns download failures into a visible error state", async () => {
    const update = {
      getState: vi.fn(),
      check: vi.fn(),
      download: vi.fn().mockRejectedValue(new Error("network unavailable")),
      installNow: vi.fn(),
    };
    const store = await loadStore(update);

    await store.getState().download();

    expect(store.getState()).toMatchObject({
      state: { status: "error", error: "network unavailable" },
      isDownloading: false,
    });
  });

  it("hydrates the ready state after a completed download so the spinner stops", async () => {
    const ready: UpdateState = { status: "ready", version: "2.0.0" };
    const update = {
      getState: vi.fn().mockResolvedValue(ready),
      check: vi.fn(),
      download: vi.fn().mockResolvedValue(undefined),
      installNow: vi.fn(),
    };
    const store = await loadStore(update);

    await store.getState().download();

    expect(update.getState).toHaveBeenCalledTimes(1);
    expect(store.getState()).toMatchObject({
      state: ready,
      isDownloading: false,
    });
  });

  it("keeps the compact control in downloading mode when an IPC state event arrives", async () => {
    const update = {
      getState: vi.fn(),
      check: vi.fn(),
      download: vi.fn(),
      installNow: vi.fn(),
    };
    const store = await loadStore(update);

    store.getState().applyState({
      status: "downloading",
      progress: { percent: 40, transferred: 40, total: 100 },
    });

    expect(store.getState()).toMatchObject({
      state: {
        status: "downloading",
        progress: { percent: 40, transferred: 40, total: 100 },
      },
      isDownloading: true,
    });
  });

  it("passes through errorCode and errorDetail so the popover can show diagnostics", async () => {
    const update = {
      getState: vi.fn(),
      check: vi.fn(),
      download: vi.fn(),
      installNow: vi.fn(),
    };
    const store = await loadStore(update);

    store.getState().applyState({
      status: "error",
      version: "2.0.0",
      packageVersion: "2.0.0",
      error: "ETIMEDOUT",
      errorCode: "network",
      errorDetail: "Error: ETIMEDOUT\n at fetch...",
    });

    expect(store.getState().state).toEqual({
      status: "error",
      version: "2.0.0",
      packageVersion: "2.0.0",
      error: "ETIMEDOUT",
      errorCode: "network",
      errorDetail: "Error: ETIMEDOUT\n at fetch...",
    });
  });
});
