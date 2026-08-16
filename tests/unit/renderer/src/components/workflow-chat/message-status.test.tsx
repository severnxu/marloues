import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageStatusRow } from "@/components/workflow-chat/message-view";

describe("MessageStatusRow elapsed clock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders elapsed time from the running turn start", () => {
    const startedAt = Date.now() - 5_000;
    const html = renderToStaticMarkup(<MessageStatusRow startedAt={startedAt} />);
    expect(html).toContain("5秒");
  });

  it("recomputes elapsed from the wall clock at render time", () => {
    const startedAt = Date.now() - 5_000;
    // 第一次渲染：5 秒
    expect(renderToStaticMarkup(<MessageStatusRow startedAt={startedAt} />)).toContain("5秒");
    // 主线程被流式渲染阻塞 4 秒后重渲染：显示 9 秒（实时计算，不依赖 interval 是否按时跑）
    vi.advanceTimersByTime(4_000);
    expect(renderToStaticMarkup(<MessageStatusRow startedAt={startedAt} />)).toContain("9秒");
  });

  it("hides the clock when no startedAt is provided", () => {
    const html = renderToStaticMarkup(<MessageStatusRow />);
    expect(html).not.toContain("秒");
    expect(html).toContain("正在思考");
  });
});
