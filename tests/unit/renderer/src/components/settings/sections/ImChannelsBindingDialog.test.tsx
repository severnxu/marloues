import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ImChannelsBindingDialog } from "../../../../../../../client/renderer/src/components/settings/sections/ImChannelsBindingDialog";

describe("ImChannelsBindingDialog", () => {
  it("starts from quick binding and keeps manual configuration available", () => {
    const html = renderToStaticMarkup(
      <ImChannelsBindingDialog
        channel="wecom"
        onClose={() => {}}
        onManualSave={() => {}}
      />,
    );

    expect(html).toContain("配置企业微信");
    expect(html).toContain("<svg");
    expect(html).toContain("快捷绑定（推荐）");
    expect(html).toContain("手动配置");
    expect(html).toContain("二维码生成中");
    expect(html).toContain("正在向渠道服务生成二维码");
    expect(html).toContain("二维码生成后将显示有效期");
    expect(html).not.toContain("二维码 60 秒后过期");
    expect(html).toContain("刷新二维码");
    expect(html).not.toContain("待后端接线");
    expect(html).not.toContain("Webhook");
  });

  it("renders feishu quick binding copy", () => {
    const html = renderToStaticMarkup(
      <ImChannelsBindingDialog
        channel="feishu"
        onClose={() => {}}
        onManualSave={() => {}}
      />,
    );

    expect(html).toContain("配置飞书");
    expect(html).toContain("快捷绑定（推荐）");
    expect(html).toContain("二维码生成中");
    expect(html).toContain("正在向渠道服务生成二维码");
    expect(html).toContain("二维码生成后将显示有效期");
    expect(html).not.toContain("二维码 60 秒后过期");
    expect(html).toContain("刷新二维码");
  });
});
