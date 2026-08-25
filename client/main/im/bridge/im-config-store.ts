/**
 * Im Config Store — IM 渠道配置的加密落盘与读取
 *
 * 存储位置：settings.json 顶层 `imChannelSecrets` 字段（与 agentSettings/theme 平级）。
 * 密钥字段（wecom.secret / feishu.appSecret）走
 * safeStorage 加密（encryptSecret），值形如 `enc:safe:v1:...`。
 *
 * 设计要点：
 * - 保存时与已存密文一致则保持原密文（避免反复加密产生新密文）
 * - 读取时 decryptSecret 幂等兜底（已是明文的旧配置直接透传）
 * - 最小侵入：独立读写函数，不改 config-service 的 StoreShape
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { getSettingsPath } from "../../app-paths";
import {
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
} from "../../services/secure-storage.service";
import { logInfo, logWarn } from "../../core/logging/app-logger";
import type {
  FeishuImConfig,
  ImChannelId,
  ImChannelSecretsConfig,
  WecomImConfig,
} from "@shared/im/im-types";

const IM_CHANNEL_SECRETS_KEY = "imChannelSecrets";

/** 各渠道需要加密的密钥字段 */
const ENCRYPTED_FIELDS: Record<ImChannelId, string[]> = {
  wecom: ["secret"],
  feishu: ["appSecret"],
};

function readRawSettings(): Record<string, unknown> {
  try {
    const raw = readFileSync(getSettingsPath(), "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeRawSettings(patch: Record<string, unknown>): void {
  const settingsPath = getSettingsPath();
  try {
    mkdirSync(dirname(settingsPath), { recursive: true });
    // Preserve sibling top-level fields (agentSettings / theme ...)
    const forDisk = { ...readRawSettings(), ...patch };
    writeFileSync(settingsPath, JSON.stringify(forDisk, null, 2), "utf-8");
  } catch (error) {
    logWarn("im.config.writeFailed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function encryptFields<T extends object>(obj: T, fields: string[]): T {
  const out: Record<string, unknown> = {
    ...(obj as unknown as Record<string, unknown>),
  };
  for (const field of fields) {
    const value = out[field];
    if (typeof value === "string" && value.length > 0) {
      out[field] = encryptSecret(value);
    }
  }
  return out as T;
}

function decryptFields<T extends object>(obj: T, fields: string[]): T {
  const out: Record<string, unknown> = {
    ...(obj as unknown as Record<string, unknown>),
  };
  for (const field of fields) {
    const value = out[field];
    if (typeof value === "string" && isEncryptedSecret(value)) {
      out[field] = decryptSecret(value) ?? value;
    }
  }
  return out as T;
}

/**
 * 读取渠道配置（已解密密钥）。
 * 不存在的渠道返回 undefined；未启用返回 disabled 配置。
 */
export function getImChannelSecretsConfig(): ImChannelSecretsConfig {
  const raw = readRawSettings()[IM_CHANNEL_SECRETS_KEY];
  if (!raw || typeof raw !== "object") return {};
  const channels = raw as ImChannelSecretsConfig;
  const result: ImChannelSecretsConfig = {};
  if (channels.wecom && typeof channels.wecom === "object") {
    result.wecom = decryptFields<WecomImConfig>(
      channels.wecom as WecomImConfig,
      ENCRYPTED_FIELDS.wecom,
    );
  }
  if (channels.feishu && typeof channels.feishu === "object") {
    result.feishu = decryptFields<FeishuImConfig>(
      channels.feishu as FeishuImConfig,
      ENCRYPTED_FIELDS.feishu,
    );
  }
  return result;
}

/**
 * 保存渠道配置（密钥加密落盘）。
 * 若某密钥字段的新值与已存密文一致（未改动），保持原密文避免反复加密。
 */
export function saveImChannelSecretsConfig(
  config: ImChannelSecretsConfig,
): void {
  const previous = getImChannelSecretsConfig();
  const forDisk: ImChannelSecretsConfig = {};

  if (config.wecom) {
    const prevWecom = previous.wecom;
    forDisk.wecom = encryptFields<WecomImConfig>(
      { ...config.wecom },
      ENCRYPTED_FIELDS.wecom,
    );
    // 保持未改动的密文：把加密结果与旧密文比对，一致则回填旧密文
    for (const field of ENCRYPTED_FIELDS.wecom) {
      const rawField = field as keyof WecomImConfig;
      const prevValue = prevWecom?.[rawField as keyof WecomImConfig];
      const newValue = config.wecom[rawField as keyof WecomImConfig];
      if (
        typeof prevValue === "string" &&
        isEncryptedSecret(prevValue) &&
        typeof newValue === "string" &&
        newValue.length > 0 &&
        prevValue !== newValue &&
        decryptSecret(prevValue) === newValue
      ) {
        (forDisk.wecom as unknown as Record<string, unknown>)[field] =
          prevValue;
      }
    }
  }
  if (config.feishu) {
    const prevFeishu = previous.feishu;
    forDisk.feishu = encryptFields<FeishuImConfig>(
      { ...config.feishu },
      ENCRYPTED_FIELDS.feishu,
    );
    for (const field of ENCRYPTED_FIELDS.feishu) {
      const rawField = field as keyof FeishuImConfig;
      const prevValue = prevFeishu?.[rawField as keyof FeishuImConfig];
      const newValue = config.feishu[rawField as keyof FeishuImConfig];
      if (
        typeof prevValue === "string" &&
        isEncryptedSecret(prevValue) &&
        typeof newValue === "string" &&
        newValue.length > 0 &&
        prevValue !== newValue &&
        decryptSecret(prevValue) === newValue
      ) {
        (forDisk.feishu as unknown as Record<string, unknown>)[field] =
          prevValue;
      }
    }
  }

  writeRawSettings({ [IM_CHANNEL_SECRETS_KEY]: forDisk });
  logInfo("im.config.saved", {
    wecom: Boolean(config.wecom),
    feishu: Boolean(config.feishu),
  });
}

/** 某渠道是否已启用（存在配置且 enabled=true） */
export function isImChannelEnabled(
  config: ImChannelSecretsConfig,
  channel: ImChannelId,
): boolean {
  const entry = config[channel];
  return Boolean(entry?.enabled);
}

/** 渠道测试连通性的最小校验：必要字段是否齐全 */
export function validateChannelConfig(
  channel: ImChannelId,
  config: ImChannelSecretsConfig,
): string | null {
  if (channel === "wecom") {
    const c = config.wecom;
    if (!c) return "企微渠道未配置";
    if (!c.botId.trim()) return "机器人 botId 未填写";
    if (!c.secret.trim()) return "机器人 secret 未填写";
    return null;
  }
  const c = config.feishu;
  if (!c) return "飞书渠道未配置";
  if (!c.appId.trim()) return "App ID 未填写";
  if (!c.appSecret.trim()) return "App Secret 未填写";
  return null;
}
