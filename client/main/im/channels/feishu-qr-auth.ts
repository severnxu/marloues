/**
 * Feishu QR Auth — 飞书「扫码自动创建应用」
 *
 * 基于 @larksuiteoapi/node-sdk 内置的 registerApp（扫码创建自建应用）：
 *  - onQRCodeReady：拿到授权页 url（渲染二维码）
 *  - onStatusChange：授权状态变更（等待扫码/已扫码待确认/成功）
 *  - 成功后返回 { client_id, client_secret, user_info: { open_id, tenant_brand } }
 *
 * 对齐 Proma feishu-bridge 的 registerApp 用法（同 SDK 内置能力）。
 */

import * as lark from "@larksuiteoapi/node-sdk";
import { logInfo, logWarn } from "../../core/logging/app-logger";

export interface FeishuQrCodeInfo {
  url: string;
  expireIn?: number;
}

export interface FeishuQrStatusInfo {
  status: string;
  interval?: number;
}

export interface FeishuRegisterResult {
  appId: string;
  appSecret: string;
  operatorOpenId?: string;
  tenantBrand?: string;
  /** 流程被取消（用户关闭弹窗/新流程顶替）时置 true，调用方应忽略 */
  canceled?: boolean;
}

export type FeishuRegisterOutcome = FeishuRegisterResult | { canceled: true };

export interface FeishuRegisterController {
  cancel(): void;
}

/**
 * 启动飞书扫码建应用流程。
 * 返回 controller（可取消）与 Promise<FeishuRegisterOutcome>。
 * 用户主动取消时 resolve { canceled: true }（非错误）。
 */
export function startFeishuRegisterApp(options: {
  source?: string;
  /** 预填的应用信息（应用名等） */
  appName?: string;
  onQRCodeReady: (info: FeishuQrCodeInfo) => void;
  onStatusChange?: (info: FeishuQrStatusInfo) => void;
}): {
  controller: FeishuRegisterController;
  promise: Promise<FeishuRegisterOutcome>;
} {
  const abort = new AbortController();
  logInfo("im.feishu.qrRegisterStarted", {
    source: options.source ?? "marloues",
  });

  const promise = lark
    .registerApp({
      source: options.source ?? "marloues",
      signal: abort.signal,
      onQRCodeReady: (info) => {
        options.onQRCodeReady({ url: info.url, expireIn: info.expireIn });
      },
      onStatusChange: (info) => {
        options.onStatusChange?.({
          status: info.status,
          interval: info.interval,
        });
      },
      appPreset: options.appName ? { name: options.appName } : undefined,
    })
    .then((result): FeishuRegisterResult => ({
      appId: result.client_id,
      appSecret: result.client_secret,
      operatorOpenId: result.user_info?.open_id,
      tenantBrand: result.user_info?.tenant_brand,
    }))
    .catch((error: unknown) => {
      if (abort.signal.aborted) {
        // 取消不是错误：resolve 一个 canceled 标记，避免 IPC handler 抛错刷屏
        logInfo("im.feishu.qrRegisterCanceled", {});
        return { canceled: true as const };
      }
      logWarn("im.feishu.qrRegisterFailed", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    });

  return {
    controller: { cancel: () => abort.abort() },
    promise,
  };
}
