// 与 SidebarUpdateBadge.test.tsx 相同的模式：mock useUpdateStore 让组件变成纯 props-like，
// 用 renderToStaticMarkup 断言各更新状态下的渲染结果（useEffect 在静态渲染中不会执行，
// load() 由 mock 吸收，不会触发真实 IPC）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AppVersionInfo, UpdatePreferences } from "@shared/hot-update";
import { useUpdateStore } from "@/stores/update-store";

type UpdateStore = ReturnType<typeof useUpdateStore.getState>;
const storeFixture = {
  state: null,
  versionInfo: null,
  preferences: null,
  isChecking: false,
  isDownloading: false,
  applyState: vi.fn(),
  load: vi.fn(),
  savePreferences: vi.fn(),
  ignoreVersion: vi.fn(),
  check: vi.fn(),
  download: vi.fn(),
  installNow: vi.fn(),
} as unknown as UpdateStore;

vi.mock("@/stores/update-store", () => ({
  useUpdateStore: (selector: (state: UpdateStore) => unknown) =>
    selector(storeFixture),
}));

import { UpdateSettings } from "./UpdateSettings";

const PACKAGED_VERSION: AppVersionInfo = {
  clientVersion: "0.1.1",
  uiVersion: "0.1.1",
  buildEnv: "production",
  protocolVersion: "1.0",
  capabilities: [],
  packaged: true,
  clientUpdateConfigured: true,
  hotUpdateConfigured: true,
  trustedKeyIds: ["official-2026-01"],
};

const DEV_VERSION: AppVersionInfo = {
  ...PACKAGED_VERSION,
  buildEnv: "dev",
  packaged: false,
};

const DEFAULT_PREFERENCES: UpdatePreferences = {
  channel: "stable",
  autoCheck: true,
  autoDownload: false,
  autoApplyUi: false,
};

function resetFixture(partial: Partial<UpdateStore> = {}) {
  storeFixture.state = null;
  storeFixture.versionInfo = null;
  storeFixture.preferences = null;
  storeFixture.isChecking = false;
  storeFixture.isDownloading = false;
  Object.assign(storeFixture, partial);
}

describe("UpdateSettings", () => {
  beforeEach(() => {
    resetFixture();
  });

  it("renders all management cards alongside version info", () => {
    resetFixture({
      versionInfo: PACKAGED_VERSION,
      preferences: DEFAULT_PREFERENCES,
    });
    const html = renderToStaticMarkup(<UpdateSettings />);

    expect(html).toContain("版本信息");
    expect(html).toContain("更新状态");
    expect(html).toContain("更新通道");
    expect(html).toContain("自动化");
    expect(html).toContain("签名信任");
    expect(html).toContain("v0.1.1");
  });

  it("disables the check action and hints dev HMR when not packaged", () => {
    resetFixture({ versionInfo: DEV_VERSION });
    const html = renderToStaticMarkup(<UpdateSettings />);

    expect(html).toContain("开发模式使用 Vite HMR");
    expect(html).toContain("检查更新");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>/);
  });

  it("shows download + ignore actions when an update is available", () => {
    resetFixture({
      state: { status: "available", version: "0.2.0", updateKind: "ui" },
      versionInfo: PACKAGED_VERSION,
      preferences: DEFAULT_PREFERENCES,
    });
    const html = renderToStaticMarkup(<UpdateSettings />);

    expect(html).toContain("发现可用更新");
    expect(html).toContain("目标版本 0.2.0");
    expect(html).toContain("下载更新");
    expect(html).toContain("忽略此版本");
    expect(html).toContain("这是界面更新");
  });

  it("renders the download progress while downloading", () => {
    resetFixture({
      state: {
        status: "downloading",
        version: "0.2.0",
        progress: { percent: 42, transferred: 420, total: 1000 },
      },
      versionInfo: PACKAGED_VERSION,
      preferences: DEFAULT_PREFERENCES,
      isDownloading: true,
    });
    const html = renderToStaticMarkup(<UpdateSettings />);

    expect(html).toContain("正在下载更新");
    expect(html).toContain("update-progress");
    expect(html).toContain("42%");
    expect(html).toContain("420 B");
    expect(html).toContain("1000 B");
  });

  it("offers install-and-restart for client updates in ready state", () => {
    resetFixture({
      state: {
        status: "ready",
        version: "0.2.0",
        applyMode: "install-client",
        updateKind: "client",
      },
      versionInfo: PACKAGED_VERSION,
      preferences: DEFAULT_PREFERENCES,
    });
    const html = renderToStaticMarkup(<UpdateSettings />);

    expect(html).toContain("更新已准备就绪");
    expect(html).toContain("安装并重启");
    expect(html).toContain("这是完整客户端更新");
  });

  it("offers reload-ui action for UI-only updates in ready state", () => {
    resetFixture({
      state: {
        status: "ready",
        version: "0.2.1",
        applyMode: "reload-ui",
        updateKind: "ui",
      },
      versionInfo: PACKAGED_VERSION,
      preferences: DEFAULT_PREFERENCES,
    });
    const html = renderToStaticMarkup(<UpdateSettings />);

    expect(html).toContain("应用并刷新界面");
    expect(html).not.toContain("安装并重启");
  });

  it("surfaces update errors in the status panel", () => {
    resetFixture({
      state: { status: "error", error: "ETIMEDOUT" },
      versionInfo: PACKAGED_VERSION,
      preferences: DEFAULT_PREFERENCES,
    });
    const html = renderToStaticMarkup(<UpdateSettings />);

    expect(html).toContain("更新检查失败");
    expect(html).toContain("update-error");
    expect(html).toContain("ETIMEDOUT");
  });

  it("reflects preferences: active channel, toggles, and trusted keys", () => {
    resetFixture({
      versionInfo: PACKAGED_VERSION,
      preferences: {
        channel: "beta",
        autoCheck: true,
        autoDownload: true,
        autoApplyUi: true,
      },
    });
    const html = renderToStaticMarkup(<UpdateSettings />);

    // beta 通道对应的「测试版」分段按钮处于激活态（active 按钮紧跟对勾图标 + 测试版文案）
    const activeIdx = html.indexOf('class="active"');
    expect(activeIdx).toBeGreaterThan(-1);
    expect(html.slice(activeIdx, activeIdx + 500)).toContain("测试版");
    expect(html).toContain("已配置可信密钥：official-2026-01");
    expect(html).toContain("已启用");
  });

  it("keeps automation toggles disabled until preferences load", () => {
    resetFixture({ versionInfo: PACKAGED_VERSION });
    const html = renderToStaticMarkup(<UpdateSettings />);

    // preferences 尚未加载完成时，自动化开关全部禁用，避免用默认值覆盖已存配置
    expect(html).toMatch(/class="settings-switch[^"]*"[^>]*disabled/);
  });
});
