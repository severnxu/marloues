import type { RuntimeKind } from "@shared/types";

export interface RuntimePresentation {
  label: string;
  shortLabel: string;
  protocol: string;
  description: string;
}

const RUNTIME_PRESENTATION: Record<RuntimeKind, RuntimePresentation> = {
  sdk: {
    label: "Claude SDK",
    shortLabel: "SDK",
    protocol: "Anthropic",
    description: "通过 Anthropic Agent SDK 执行任务",
  },
  binary: {
    label: "Codex CLI",
    shortLabel: "Codex",
    protocol: "OpenAI Responses",
    description: "通过 Codex 二进制执行任务",
  },
  "self-built": {
    label: "Marloues 自研",
    shortLabel: "自研",
    protocol: "OpenAI Chat",
    description: "通过 Marloues Agent Loop 执行任务",
  },
};

export function runtimePresentation(
  runtimeId: RuntimeKind,
): RuntimePresentation {
  return RUNTIME_PRESENTATION[runtimeId];
}
