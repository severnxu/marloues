import {
  HOT_UPDATE_CAPABILITY,
  HOT_UPDATE_PROTOCOL_VERSION,
  type RendererReadyInfo,
  type RendererReadyReceipt,
} from "@shared/hot-update";

export function validateRendererReady(
  payload: unknown,
  expectedVersion: string,
): RendererReadyReceipt {
  if (!payload || typeof payload !== "object") {
    return { accepted: false, reason: "invalid_payload" };
  }
  const info = payload as Partial<RendererReadyInfo>;
  if (
    typeof info.uiVersion !== "string" ||
    typeof info.protocolVersion !== "string" ||
    !Array.isArray(info.capabilities) ||
    !info.capabilities.every((value) => typeof value === "string")
  ) {
    return { accepted: false, reason: "invalid_payload" };
  }
  if (info.uiVersion !== expectedVersion) {
    return { accepted: false, reason: "version_mismatch" };
  }
  if (info.protocolVersion !== HOT_UPDATE_PROTOCOL_VERSION) {
    return { accepted: false, reason: "protocol_mismatch" };
  }
  if (!info.capabilities.includes(HOT_UPDATE_CAPABILITY)) {
    return { accepted: false, reason: "capability_mismatch" };
  }
  return { accepted: true };
}
