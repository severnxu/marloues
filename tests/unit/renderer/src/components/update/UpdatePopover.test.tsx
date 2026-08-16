// Mock react-dom portal so we can render popover DOM statically without jsdom.
// 同时给 UpdatePopover 一个最小 document.body 桩，让 SSR 渲染能产出 markup。
vi.mock("react-dom", async () => {
  const actual = await vi.importActual<typeof import("react-dom")>("react-dom");
  return {
    ...actual,
    createPortal: (node: unknown) => node,
  };
});

// 在 node 环境下塞一个最小的 document.body（UpdatePopover 内部访问 createPortal 第二参数）
// 在 happy-dom/jsdom 环境下走真实 globalThis.document 即可。
if (typeof (globalThis as { document?: unknown }).document === "undefined") {
  (globalThis as { document: unknown }).document = {
    body: {},
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
}

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { UpdatePopover } from "../../../../../../client/renderer/src/components/update/UpdatePopover";

const noop = () => undefined;

function renderPopover(
  state: Parameters<typeof UpdatePopover>[0]["state"],
  opts: Partial<Parameters<typeof UpdatePopover>[0]> = {},
) {
  return renderToStaticMarkup(
    <UpdatePopover
      state={state}
      isChecking={false}
      isDownloading={false}
      hasRunningTasks={false}
      anchorRect={null}
      onClose={noop}
      onCheck={noop}
      onDownload={noop}
      onInstallNow={noop}
      onCancelAutoInstall={noop}
      {...opts}
    />,
  );
}

describe("UpdatePopover", () => {
  it("renders release notes and a download button when an update is available", () => {
    const html = renderPopover({
      status: "available",
      version: "2.0.0",
      releaseNotes: "## Release Notes\n\n- Cool stuff",
    });
    expect(html).toContain("新版本可用 · v2.0.0");
    expect(html).toContain("立即下载");
    expect(html).toContain("Release Notes");
    expect(html).toContain("Cool stuff");
  });

  it("renders percentage and bytes during the downloading state", () => {
    const html = renderPopover({
      status: "downloading",
      version: "2.0.0",
      progress: { percent: 47, transferred: 47, total: 100 },
    });
    expect(html).toContain("正在下载 v2.0.0");
    expect(html).toContain("47%");
    expect(html).toContain('role="progressbar"');
  });

  it("renders install/later actions in the ready state", () => {
    const html = renderPopover(
      {
        status: "ready",
        updateKind: "client",
        applyMode: "install-client",
        version: "2.0.0",
        packageVersion: "2.0.0",
      },
      { hasRunningTasks: true },
    );
    expect(html).toContain("已下载 v2.0.0");
    expect(html).toContain("安装并重启");
    expect(html).toContain("稍后再说");
  });

  it("renders error reason, code, detail and retry actions", () => {
    const html = renderPopover({
      status: "error",
      version: "2.0.0",
      packageVersion: "2.0.0",
      error: "ETIMEDOUT",
      errorCode: "network",
      errorDetail: "Error: ETIMEDOUT\n at fetch (/Users/xuzong/x.js:1:1)",
    });
    expect(html).toContain("更新失败");
    expect(html).toContain("ETIMEDOUT");
    expect(html).toContain("<code>network</code>");
    expect(html).toContain("Error: ETIMEDOUT");
    expect(html).toContain("重试检查");
  });

  it("renders the manual check panel when idle", () => {
    const html = renderPopover({ status: "idle" });
    expect(html).toContain("检查更新");
    expect(html).toContain("当前已是最新版本");
  });
});
