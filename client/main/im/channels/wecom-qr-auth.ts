/**
 * Wecom QR Auth — 企微智能机器人「扫码快捷绑定」
 *
 * 协议来源：企微官方授权接口（QoderWork / 腾讯云快捷配置同款）：
 *   ① GET https://work.weixin.qq.com/ai/qc/generate?source=<产品>&plat=<平台码>
 *      → { data: { scode, auth_url } }
 *   ② GET https://work.weixin.qq.com/ai/qc/query_result?scode=<scode>
 *      → status="success" 时 { data: { bot_info: { botid, secret } } }
 *
 * 用户用企微扫码 → 手机端「一键创建智能机器人」→ 自动拿到 botid/secret。
 */

import { logInfo } from "../../core/logging/app-logger";

const QR_GENERATE_URL = "https://work.weixin.qq.com/ai/qc/generate";
const QR_QUERY_URL = "https://work.weixin.qq.com/ai/qc/query_result";
const REQUEST_TIMEOUT_MS = 10_000;

/** 平台码（协议约定） */
function getPlatCode(): number {
  switch (process.platform) {
    case "darwin":
      return 1;
    case "win32":
      return 2;
    case "linux":
      return 3;
    default:
      return 0;
  }
}

function assertJsonContentType(resp: Response, label: string): void {
  const contentType = resp.headers.get("content-type") ?? "";
  if (
    !contentType.includes("application/json") &&
    !contentType.includes("text/json")
  ) {
    throw new Error(
      `${label}: expected JSON response but got content-type "${contentType}" (HTTP ${resp.status})`,
    );
  }
}

export interface WecomQrGenerateResult {
  /** 轮询凭证 */
  scode: string;
  /** 授权页地址（渲染二维码用） */
  authUrl: string;
  /** 二维码有效期秒数；企微当前响应可能不返回，调用方需按 undefined 处理 */
  expireIn?: number;
}

/** 生成授权二维码（source 标识产品名，如 "marloues"） */
export async function generateWecomBotQRCode(
  source: string,
): Promise<WecomQrGenerateResult> {
  const url = `${QR_GENERATE_URL}?source=${encodeURIComponent(source)}&plat=${getPlatCode()}`;
  const resp = await fetch(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!resp.ok) {
    throw new Error(`二维码生成失败：HTTP ${resp.status}`);
  }
  assertJsonContentType(resp, "二维码生成失败");
  const data = (await resp.json()) as {
    data?: {
      scode?: string;
      auth_url?: string;
      expire_in?: number | string;
      expires_in?: number | string;
      expireIn?: number | string;
    };
  };
  const payload = data?.data;
  if (!payload?.scode || !payload?.auth_url) {
    throw new Error("二维码生成失败：响应格式异常");
  }
  const expireIn = parseOptionalSeconds(
    payload.expireIn ?? payload.expire_in ?? payload.expires_in,
  );
  logInfo("im.wecom.qrGenerated", { hasScode: true, hasExpireIn: !!expireIn });
  return {
    scode: payload.scode,
    authUrl: payload.auth_url,
    ...(expireIn ? { expireIn } : {}),
  };
}

export interface WecomQrPollResult {
  status: "success" | "pending";
  botId?: string;
  secret?: string;
}

/** 轮询授权结果（返回 success 时携带 botId/secret） */
export async function pollWecomBotQRResult(
  scode: string,
): Promise<WecomQrPollResult> {
  const url = `${QR_QUERY_URL}?scode=${encodeURIComponent(scode)}`;
  const resp = await fetch(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!resp.ok) {
    throw new Error(`授权状态查询失败：HTTP ${resp.status}`);
  }
  assertJsonContentType(resp, "授权状态查询失败");
  const data = (await resp.json()) as {
    data?: {
      status?: string;
      bot_info?: { botid?: string; secret?: string };
    };
  };
  if (data?.data?.status === "success") {
    const botInfo = data.data.bot_info;
    // 打印完整响应，确认 API 是否返回了用户身份信息
    logInfo("im.wecom.qrResponseRaw", { data: JSON.stringify(data.data) });
    if (!botInfo?.botid || !botInfo?.secret) {
      throw new Error("扫码成功但缺少机器人凭证");
    }
    logInfo("im.wecom.qrBound", { botId: botInfo.botid.slice(0, 8) });
    return { status: "success", botId: botInfo.botid, secret: botInfo.secret };
  }
  return { status: "pending" };
}

function parseOptionalSeconds(
  value: number | string | undefined,
): number | undefined {
  if (value == null) return undefined;
  const seconds = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return Math.floor(seconds);
}
