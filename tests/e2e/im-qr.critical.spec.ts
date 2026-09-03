import {
  expect,
  test,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as QRCode from "qrcode";

const repoRoot = join(__dirname, "..", "..");
const mainEntry = join(repoRoot, "client", "out", "main", "index.js");

let testHome: string;
let fakeQrDataUrl: string;

test.beforeAll(async () => {
  testHome = mkdtempSync(join(tmpdir(), "marloues-im-e2e-"));
  const workspaceDir = join(testHome, "workspace");
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(join(testHome, "config"), { recursive: true });
  writeFileSync(
    join(testHome, "config", "workspaces.json"),
    JSON.stringify({
      currentWorkspaceId: "im-e2e-workspace",
      workspaces: [
        {
          id: "im-e2e-workspace",
          name: "im-e2e",
          path: workspaceDir,
          lastOpenedAt: Date.now(),
        },
      ],
    }),
    "utf-8",
  );
  fakeQrDataUrl = await QRCode.toDataURL(
    "https://work.weixin.qq.com/ai/qc/c?s=e2e-success",
    {
      width: 220,
      margin: 2,
      errorCorrectionLevel: "M",
    },
  );
});

async function launchApp() {
  const executablePath = process.env.MARLOUES_E2E_EXECUTABLE;
  const app = await electron.launch({
    ...(executablePath ? { executablePath, args: [] } : { args: [mainEntry] }),
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      MARLOUES_HOME: testHome,
      MARLOUES_REMOTE_DEBUGGING_PORT: "0",
    },
  });
  const window = await app.firstWindow();
  return { app, window };
}

async function completeOnboarding(
  window: Awaited<ReturnType<typeof launchApp>>["window"],
): Promise<void> {
  await expect(
    window.locator(".onboarding-view, .app-shell").first(),
  ).toBeVisible();
  const overlay = window.getByRole("dialog", { name: "marloues 初次设置" });
  if (!(await overlay.isVisible().catch(() => false))) return;
  const start = overlay.getByRole("button", { name: "开始使用" });
  await expect(start).toBeEnabled();
  await start.click();
  await expect(overlay).toBeHidden();
}

async function openImSettings(window: Page): Promise<void> {
  await completeOnboarding(window);
  await expect(window.locator(".app-shell")).toBeVisible();

  await window.getByTitle("用户信息").click();
  await window
    .getByRole("dialog", { name: "用户信息" })
    .getByRole("button", { name: "设置" })
    .click();

  const settings = window.getByRole("dialog", { name: "设置" });
  await settings
    .getByRole("navigation", { name: "设置分组" })
    .getByRole("button", { name: "IM 渠道" })
    .click();
  await expect(window.locator(".im-channels-page")).toBeVisible();
}

async function mockSuccessfulWecomBinding(
  app: ElectronApplication,
): Promise<void> {
  await app.evaluate(({ ipcMain }, qrDataUrl) => {
    for (const channel of [
      "im:get-config",
      "im:save-config",
      "im:test-channel",
      "im:wecom-qr-generate",
      "im:wecom-qr-poll",
    ]) {
      ipcMain.removeHandler(channel);
    }

    ipcMain.handle("im:get-config", async () => ({}));
    ipcMain.handle("im:save-config", async () => undefined);
    ipcMain.handle("im:test-channel", async (_event, channel: string) => ({
      channel,
      success: true,
      latencyMs: 1,
    }));
    ipcMain.handle("im:wecom-qr-generate", async () => ({
      scode: "e2e-success",
      authUrl: "https://work.weixin.qq.com/ai/qc/c?s=e2e-success",
      dataUrl: qrDataUrl,
    }));
    ipcMain.handle("im:wecom-qr-poll", async () => ({
      status: "success",
      botId: "e2e-bot-id",
      secret: "e2e-secret",
    }));
  }, fakeQrDataUrl);
}

test("IM settings renders a real WeCom QR code", async () => {
  const { app, window } = await launchApp();
  try {
    await openImSettings(window);

    await window.getByRole("button", { name: /扫码绑定企业微信/ }).click();
    const bindingDialog = window.getByRole("dialog", {
      name: "配置企业微信",
    });
    await expect(bindingDialog).toBeVisible();

    const qrImage = bindingDialog.getByAltText("IM 绑定二维码");
    await expect(qrImage).toBeVisible({ timeout: 20_000 });
    await expect(qrImage).toHaveJSProperty("complete", true);

    const metrics = await qrImage.evaluate((image) => {
      const img = image as HTMLImageElement;
      const rect = img.getBoundingClientRect();
      const canvas = document.createElement("canvas");
      const sampleSize = 128;
      canvas.width = sampleSize;
      canvas.height = sampleSize;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas context is unavailable");
      context.drawImage(img, 0, 0, sampleSize, sampleSize);
      const pixels = context.getImageData(0, 0, sampleSize, sampleSize).data;
      let darkPixels = 0;
      let lightPixels = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        const alpha = pixels[index + 3] ?? 0;
        if (alpha < 128) continue;
        const luminance =
          ((pixels[index] ?? 0) +
            (pixels[index + 1] ?? 0) +
            (pixels[index + 2] ?? 0)) /
          3;
        if (luminance < 80) darkPixels += 1;
        if (luminance > 220) lightPixels += 1;
      }
      return {
        src: img.currentSrc || img.src,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        renderedWidth: rect.width,
        renderedHeight: rect.height,
        darkPixels,
        lightPixels,
        totalPixels: sampleSize * sampleSize,
      };
    });
    expect(metrics.src).toMatch(/^data:image\/png;base64,/);
    expect(metrics.naturalWidth).toBeGreaterThan(100);
    expect(metrics.naturalHeight).toBeGreaterThan(100);
    expect(metrics.renderedWidth).toBeGreaterThan(150);
    expect(metrics.renderedHeight).toBeGreaterThan(150);
    expect(metrics.darkPixels / metrics.totalPixels).toBeGreaterThan(0.08);
    expect(metrics.lightPixels / metrics.totalPixels).toBeGreaterThan(0.35);
    await expect(
      bindingDialog.getByText(/有效期以企业微信页面为准/),
    ).toBeVisible();
    await expect(bindingDialog.getByText(/二维码 60 秒后过期/)).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test("IM settings shows feedback after a successful WeCom scan", async () => {
  const { app, window } = await launchApp();
  try {
    await mockSuccessfulWecomBinding(app);
    await openImSettings(window);

    await window.getByRole("button", { name: /扫码绑定企业微信/ }).click();
    const bindingDialog = window.getByRole("dialog", {
      name: "配置企业微信",
    });
    await expect(bindingDialog).toBeVisible();
    await expect(bindingDialog.getByAltText("IM 绑定二维码")).toBeVisible();

    await expect(bindingDialog.getByText("绑定成功")).toBeVisible({
      timeout: 6_000,
    });
    await expect(
      bindingDialog.getByText("企业微信机器人已保存并通过连接测试"),
    ).toBeVisible();
    await expect(bindingDialog).toBeHidden({ timeout: 3_000 });
    await expect(window.getByText("企业微信机器人已绑定")).toBeVisible();
    const settings = window.getByRole("dialog", { name: "设置" });
    await settings
      .getByRole("navigation", { name: "设置分组" })
      .getByRole("button", { name: "机器人实例" })
      .click();
    await expect(window.getByText("企业微信机器人 1")).toBeVisible();
  } finally {
    await app.close();
  }
});
