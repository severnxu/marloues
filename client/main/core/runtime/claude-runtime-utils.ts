/**
 * claude-runtime 的纯工具函数（marloues 版）。
 * 不持有模块级状态。steer-queue 只依赖 genId / now。
 */

import type { AgentSettings } from "@shared/types";
import { resolveModelProvider } from "../config/model-provider";

export function genId(): string {
  return crypto.randomUUID();
}

export function now(): number {
  return Date.now();
}

export function modelSnapshotFromSettings(settings: AgentSettings): {
  modelId: string;
  modelName: string;
} {
  const modelProvider = resolveModelProvider(settings);
  const modelId = modelProvider.selection.modelId || modelProvider.model;
  const model = modelProvider.provider?.models.find(
    (item) => item.id === modelId,
  );
  return {
    modelId,
    modelName: model?.label || modelId,
  };
}
