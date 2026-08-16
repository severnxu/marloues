// 强制使用静态渲染：mock react-dom portal + mock useUpdateStore 让组件变成纯 props-like。
vi.mock("react-dom", async () => {
  const actual = await vi.importActual<typeof import("react-dom")>("react-dom");
  return {
    ...actual,
    createPortal: (node: unknown) => node,
  };
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { useUpdateStore } from "@/stores/update-store";

// useUpdateStore 是一个 zustand hook：抽出状态类型作为测试的 store 形状 fixture。
type UpdateStore = ReturnType<typeof useUpdateStore.getState>;
// 静态渲染测试只需要可读字段，不需要构造完整的 zustand store。
const storeFixture = {
  state: null,
  isChecking: false,
  isDownloading: false,
  applyState: vi.fn(),
  load: vi.fn(),
  check: vi.fn(),
  download: vi.fn(),
  installNow: vi.fn(),
} as unknown as UpdateStore;

vi.mock("@/stores/update-store", () => ({
  useUpdateStore: (selector: (state: UpdateStore) => unknown) =>
    selector(storeFixture),
}));

import {
  readyUpdatePrompt,
  SidebarUpdateBadge,
  stopRunningTasksAndApplyUpdate,
} from "../../../../../../../client/renderer/src/components/workbench/primary-sidebar/SidebarUpdateBadge";

function resetFixture(partial: Partial<UpdateStore> = {}) {
  storeFixture.state = null;
  storeFixture.isChecking = false;
  storeFixture.isDownloading = false;
  Object.assign(storeFixture, partial);
}

describe("SidebarUpdateBadge", () => {
  beforeEach(() => {
    resetFixture();
  });

  it("renders nothing when no update state is known", () => {
    resetFixture();
    const html = renderToStaticMarkup(
      <SidebarUpdateBadge hasRunningTasks={false} />,
    );
    expect(html).toBe("");
  });

  it("shows the progress ring with the current percentage while downloading", () => {
    resetFixture({
      state: {
        status: "downloading",
        version: "2.0.0",
        progress: { percent: 64, transferred: 64, total: 100 },
      },
      isDownloading: true,
    });
    const html = renderToStaticMarkup(
      <SidebarUpdateBadge hasRunningTasks={false} />,
    );
    expect(html).toContain('data-testid="sidebar-update-badge-downloading"');
    expect(html).toContain(">64<");
    expect(html).not.toContain("64%");
    expect(html).toContain("sidebar-update-progress-ring");
  });

  it("caps the displayed download number below 100", () => {
    resetFixture({
      state: {
        status: "downloading",
        version: "2.0.0",
        progress: { percent: 100, transferred: 100, total: 100 },
      },
      isDownloading: true,
    });
    const html = renderToStaticMarkup(
      <SidebarUpdateBadge hasRunningTasks={false} />,
    );
    expect(html).toContain(">99<");
    expect(html).not.toContain(">100<");
    expect(html).not.toContain(">99%<");
    expect(html).not.toContain(">100%<");
  });

  it("renders a stable ready action without an automatic restart countdown", () => {
    resetFixture({
      state: {
        status: "ready",
        version: "2.0.0",
        packageVersion: "2.0.0",
        applyMode: "install-client",
      },
    });
    const html = renderToStaticMarkup(
      <SidebarUpdateBadge hasRunningTasks={false} />,
    );
    expect(html).toContain('data-testid="sidebar-update-badge-ready"');
    expect(html).toContain("安装客户端更新");
    expect(html).not.toContain('data-testid="ring-text"');
  });

  it("renders the error badge with a distinct icon class", () => {
    resetFixture({
      state: {
        status: "error",
        version: "2.0.0",
        error: "ETIMEDOUT",
        errorCode: "network",
      },
    });
    const html = renderToStaticMarkup(
      <SidebarUpdateBadge hasRunningTasks={false} />,
    );
    expect(html).toContain('data-testid="sidebar-update-badge-error"');
    expect(html).toContain("更新失败");
    expect(html).toContain("lucide-triangle-alert"); // <svg> lucide-react class
  });

  it("uses the available variant when the update is fetched", () => {
    resetFixture({
      state: { status: "available", version: "2.0.0" },
    });
    const html = renderToStaticMarkup(
      <SidebarUpdateBadge hasRunningTasks={false} />,
    );
    expect(html).toContain('data-testid="sidebar-update-badge-available"');
    expect(html).toContain("下载可用更新");
    expect(html).not.toContain("新版本可用");
  });

  it("shows a ready action for UI-only updates", () => {
    resetFixture({
      state: {
        status: "ready",
        version: "2.0.0",
        packageVersion: "2.0.0",
        applyMode: "reload-ui",
      },
    });
    const html = renderToStaticMarkup(
      <SidebarUpdateBadge hasRunningTasks={false} />,
    );
    expect(html).toContain("应用界面更新");
    expect(html).toContain("lucide-refresh-ccw");
    expect(html).toContain(">更新</span>");
    expect(html).not.toContain('data-testid="spinner"');
    expect(html).not.toContain("安装客户端更新");
  });

  it("offers immediate update or later when no task is running", () => {
    expect(readyUpdatePrompt("reload-ui", false)).toMatchObject({
      confirmLabel: "立即更新",
      cancelLabel: "稍后",
      variant: "default",
    });
    expect(readyUpdatePrompt("install-client", false).confirmLabel).toBe(
      "立即安装",
    );
  });

  it("offers later or stop-tasks-and-update when a task is running", () => {
    for (const applyMode of ["reload-ui", "install-client"] as const) {
      const prompt = readyUpdatePrompt(applyMode, true);
      expect(prompt.confirmLabel).toBe("停止任务并更新");
      expect(prompt.cancelLabel).toBe("稍后");
      expect(prompt.variant).toBe("warning");
      expect(prompt.message).toContain("当前仍有任务运行");
    }
  });

  it("stops running tasks before applying an update", async () => {
    const calls: string[] = [];

    await stopRunningTasksAndApplyUpdate(
      async () => {
        calls.push("stop");
      },
      async () => {
        calls.push("apply");
      },
    );

    expect(calls).toEqual(["stop", "apply"]);
  });
});
